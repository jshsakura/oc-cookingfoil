import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("the optional host monitor attributes verified requests, marks shared IPs and tracks releases", () => {
  const result = spawnSync("python3", ["-c", `
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("monitor", "examples/direct-download/security-monitor.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
stamp = "2026-01-01T00:00:00Z"
now = m.timestamp(stamp)
key = "a" * 64
other = "b" * 64
alert = {"id": 1, "created_at": stamp, "start_at": stamp, "stop_at": stamp, "scenario": "test", "source": {"value": "192.0.2.1"}, "events": [{"meta": [{"key": "http_path", "value": "/api/retro/base-pack/file/a.info"}]}]}
state = {"device": {key: {"label": "Console A", "addedBy": "alice"}, other: {"label": "Console B", "addedBy": "bob"}}, "device-activity": {key: {"lastIp": "192.0.2.1", "lastSeenAt": now}, other: {"lastIp": "192.0.2.1", "lastSeenAt": now}}, "google-account": {}}
row = {"route": "direct", "status": 200, "t": stamp, "path": "/api/retro/base-pack/file/a.info", "dev": "aaaaaaaa", "client": "192.0.2.1"}
users = m.identities(alert, [row], state)
assert users[0]["owner"] == "alice" and users[0]["match"] == "request"
assert users[1]["owner"] == "bob" and users[1]["match"] == "recent-address"
assert all(u["match"] == "recent-address" for u in m.identities(alert, [{**row, "client": "192.0.2.2"}], state))
assert all(u["match"] == "recent-address" for u in m.identities(alert, [{**row, "status": 401}], state))
assert m.identities(alert, [row], {**state, "device": {}, "device-activity": {}}) == []
assert key not in m.notification({"action": "blocked", "users": users, "reason": "test", "count": 15, "until": now + 600000}, "en")
blocked = m.reconcile(alert, {"1": [{"duration": "10m"}]}, None, users, now)
assert blocked["action"] == "blocked" and blocked["until"] == now + 600000
released = m.reconcile(alert, {}, blocked, users, now + 1000)
assert released["action"] == "released" and released["until"] is None
expired = m.reconcile(alert, {}, blocked, users, now + 600001)
assert expired["action"] == "expired"
assert m.reconcile(alert, {}, released, users, now + 2000)["action"] == "released"
assert m.duration("-1h2m3.5s") == -3723500
import tempfile, pathlib, json
with tempfile.TemporaryDirectory() as temp:
    active = [True]
    deliveries = []
    m.records = lambda data: state
    m.access_records = lambda data: [row]
    def command(*args):
        if args[:2] == ("decisions", "list"):
            return [{"id": 1, "decisions": [{"duration": "10m"}]}] if active[0] else []
        if args[:2] == ("alerts", "list"):
            return [alert]
        return [alert]
    m.cscli = command
    def deliver(config, text):
        deliveries.append(text)
        return True
    m.send = deliver
    alert["events"][0]["meta"].append({"key": "target_fqdn", "value": "dl.example.org"})
    config = {"data_dir": temp, "download_host": "dl.example.org", "lang": "en"}
    m.run(config)
    m.run(config)
    assert len(deliveries) == 1 and "alice" in deliveries[0]
    active[0] = False
    m.run(config)
    saved = json.loads((pathlib.Path(temp) / "security/download-security.json").read_text())["events"][0]
    assert saved["action"] == "released" and len(deliveries) == 2
    active[0] = True
    m.send = lambda config, text: False
    m.run(config)
    saved = json.loads((pathlib.Path(temp) / "security/download-security.json").read_text())["events"][0]
    assert saved["action"] == "blocked" and saved["delivery"] == "failed"
    m.send = deliver
    m.run(config)
    assert len(deliveries) == 3
`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
