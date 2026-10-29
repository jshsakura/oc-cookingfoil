#!/usr/bin/env python3
"""Publish edge decisions to CookingFoil and notify the existing operator chat.

Run as a systemd oneshot every 15 seconds. The config contains data_dir,
download_host, telegram_env and lang. No credentials or addresses are logged.
The security database is opened read-only. Never infer a proven identity from
a User-Agent, a client-supplied device header, or an address match alone.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import urllib.request
from urllib.parse import unquote


def timestamp(value):
    return int(dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def duration(value):
    sign = -1 if value.startswith("-") else 1
    return sign * sum(float(n) * {"h": 3600000, "m": 60000, "s": 1000}[unit]
                      for n, unit in re.findall(r"(\d+(?:\.\d+)?)(h|m|s)", value))


def cscli(*args):
    result = subprocess.run(["cscli", *args, "-o", "json"], capture_output=True, text=True, timeout=20, check=True)
    return json.loads(result.stdout) or []


def records(data):
    with sqlite3.connect((data / "security/security.db").as_uri() + "?mode=ro", uri=True) as db:
        rows = db.execute("SELECT kind, id, data FROM records WHERE kind IN ('device', 'device-activity', 'google-account')")
        result = {"device": {}, "device-activity": {}, "google-account": {}}
        for kind, ident, body in rows:
            result[kind][ident] = json.loads(body)
        return result


def access_records(data):
    result = []
    for suffix in (".1", ""):
        file = data / ("access-log.jsonl" + suffix)
        if file.exists():
            for line in file.read_text().splitlines():
                try:
                    result.append(json.loads(line))
                except (ValueError, TypeError):
                    continue
    return result


def identities(alert, access, state):
    ip = alert.get("source", {}).get("value")
    start, end = timestamp(alert["start_at"]), timestamp(alert["stop_at"])
    paths = {unquote(dict((m["key"], m["value"]) for m in e.get("meta", [])).get("http_path", "").split("?")[0]) for e in alert.get("events", [])}
    devices = state["device"]
    found = {}
    for row in access:
        if row.get("route") != "direct" or row.get("status") not in (200, 206):
            continue
        try:
            at = timestamp(row["t"])
        except (KeyError, ValueError):
            continue
        if not start - 5000 <= at <= end + 5000 or row.get("path") not in paths:
            continue
        prefix = str(row.get("dev") or "").lower()
        matches = [key for key in devices if prefix and key.lower().startswith(prefix)]
        if len(matches) != 1:
            continue
        key = matches[0]
        activity = state["device-activity"].get(key, {})
        # Old logs lack the client field. Only use their time/path match when
        # approved-console activity independently confirms the same address.
        day = alert["start_at"][:10]
        historical_ip = ip in activity.get("days", {}).get(day, {}).get("ips", {})
        if row.get("client") == ip or (not row.get("client") and (activity.get("lastIp") == ip or historical_ip)):
            found[key] = "request"
    for key, activity in state["device-activity"].items():
        if key in devices and activity.get("lastIp") == ip and abs(activity.get("lastSeenAt", 0) - end) < 86400000:
            found.setdefault(key, "recent-address")
    result = []
    for key, match in found.items():
        dev = devices[key]
        owner = dev.get("addedBy", "")
        if owner in ("admin", "auto", "telegram"):
            owner = ""
        elif owner.startswith("google:"):
            account = state["google-account"].get(owner[7:], {})
            email = account.get("email", "")
            local, sep, domain = email.partition("@")
            owner = f"{local[:min(2, max(1, len(local) - 1))]}***@{domain}" if sep else "Google"
        result.append({"device": key[:8].lower(), "label": dev.get("label", ""), "owner": owner, "match": match})
    return result[:10]


def reconcile(alert, live, previous, users, now):
    decisions = live.get(str(alert["id"]), [])
    if decisions:
        action = "blocked"
        until = max(now + duration(d["duration"]) for d in decisions)
    elif previous and previous["action"] == "blocked":
        action = "expired" if (previous.get("until") or now + 1) <= now else "released"
        until = None
    elif previous and previous["action"] in ("released", "expired"):
        action, until = previous["action"], None
    elif alert.get("decisions"):
        action = "released" if any(duration(d.get("duration", "0s")) > 0 for d in alert["decisions"]) else "expired"
        until = None
    else:
        action, until = "detected", None
    changed = not previous or previous["action"] != action
    return {**(previous or {}), "id": str(alert["id"]), "at": timestamp(alert["created_at"]),
            "updatedAt": now if changed else previous["updatedAt"], "action": action,
            "until": until, "reason": alert["scenario"], "count": alert.get("events_count", 0), "users": users}


WORDS = {
    "ko": ["다운로드 보안 알림", "자동 차단", "차단 해제", "차단 만료", "탐지, 차단 없음", "사용자·기기", "확인되지 않았습니다", "같은 주소의 최근 사용자, 요청자 미확인", "사유", "관련 요청", "차단 종료"],
    "en": ["Download security alert", "Automatically blocked", "Block removed", "Block expired", "Detected, not blocked", "User and console", "Unidentified", "recent user of this address, requester unconfirmed", "Reason", "Related requests", "Block ends"],
    "ja": ["ダウンロードのセキュリティ通知", "自動遮断", "遮断解除", "遮断期限終了", "検知、遮断なし", "利用者・本体", "未確認です", "同じアドレスの最近の利用者、リクエスト元は未確認", "理由", "関連リクエスト", "遮断終了"],
    "zh": ["下载安全通知", "自动阻止", "阻止已解除", "阻止已到期", "已检测，未阻止", "用户与主机", "无法确认", "此地址的近期用户，尚未确认请求者", "原因", "相关请求", "阻止结束"],
}


def notification(event, lang):
    w = WORDS.get(lang, WORDS["ko"])
    action = w[{"blocked": 1, "released": 2, "expired": 3, "detected": 4}[event["action"]]]
    people = []
    for user in event["users"]:
        name = " / ".join(str(user[k]) for k in ("owner", "label", "device") if user.get(k))
        people.append(name if user["match"] == "request" else f"{name} ({w[7]})")
    until = dt.datetime.fromtimestamp(event["until"] / 1000, dt.timezone.utc).isoformat() if event["until"] else "-"
    return f"{w[0]}: {action}\n{w[5]}: {', '.join(people) or w[6]}\n{w[8]}: {event['reason']}\n{w[9]}: {event['count']}\n{w[10]}: {until}"


def send(config, text):
    env = {}
    for line in Path(config["telegram_env"]).read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("\"'")
    token, chat = env.get("COOK_TELEGRAM_BOT_TOKEN"), env.get("COOK_TELEGRAM_CHAT_ID")
    if not token or not chat:
        return False
    body = json.dumps({"chat_id": chat, "text": text, "disable_web_page_preview": True}).encode()
    req = urllib.request.Request("https://api.telegram.org/bot" + token + "/sendMessage", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response).get("ok") is True


def publish(file, events):
    file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = file.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": 1, "events": events}, ensure_ascii=False))
    os.chmod(tmp, 0o600)
    parent = file.parent.stat()
    os.chown(tmp, parent.st_uid, parent.st_gid)
    tmp.replace(file)


def run(config, backfill=False):
    data = Path(config["data_dir"])
    file = data / "security/download-security.json"
    old = json.loads(file.read_text()).get("events", []) if file.exists() else []
    previous = {e["id"]: e for e in old}
    live = {str(a["id"]): a.get("decisions", []) for a in cscli("decisions", "list")}
    access, state = access_records(data), records(data)
    now = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    for alert in cscli("alerts", "list", "--since", "24h", "--limit", "100"):
        ident = str(alert["id"])
        full = cscli("alerts", "inspect", ident)
        full = full[0] if isinstance(full, list) else full
        hosts = {m["value"] for e in full.get("events", []) for m in e.get("meta", []) if m["key"] == "target_fqdn"}
        if config["download_host"] not in hosts or full.get("simulated"):
            continue
        before = previous.get(ident)
        users = identities(full, access, state) or (before or {}).get("users", [])
        event = reconcile(full, live, before, users, now)
        key = event["action"]
        previous[ident] = event
        # Record the ban before any outbound request so Telegram downtime never
        # removes it from the dashboard. Failed deliveries are retried next run.
        if backfill:
            event.update({"notified": key, "delivery": "off"})
        elif event.get("notified") != key:
            event["delivery"] = "failed"
            publish(file, sorted(previous.values(), key=lambda e: e["at"])[-100:])
            try:
                if send(config, notification(event, config.get("lang", "ko"))):
                    event.update({"notified": key, "delivery": "sent"})
            except Exception:
                print("Download security notification failed; retained for retry", flush=True)
    publish(file, sorted(previous.values(), key=lambda e: e["at"])[-100:])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--backfill", action="store_true", help="Import history without sending old notifications")
    args = parser.parse_args()
    try:
        run(json.loads(args.config.read_text()), args.backfill)
    except Exception as error:
        # HTTP exceptions can carry a URL containing the bot token.
        raise SystemExit("Download security monitor failed: " + type(error).__name__) from None
