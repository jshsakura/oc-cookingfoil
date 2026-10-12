/** Step 4: report.md for a person, from plan.json and apply.json. */
import fs from "node:fs";
import path from "node:path";

const LABEL = {
  install: "새로 설치", replace: "새 버전으로 교체", skip: "최신 그대로", "exists-manual": "사람이 넣은 패치가 있음 (그대로 둠)",
  "xdelta-pending": "게임 원본이 필요함 (xdelta·패처)", manual: "자동으로 못 받음", review: "확인 필요 (title id 미정)", ignored: "대상 아님",
};

const read = (dir, name) => {
  const f = path.join(dir, name);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
};

const link = (i) => i.articleUrl ?? i.sourceUrl ?? i.key;

export async function report(dir) {
  const plan = read(dir, "plan.json");
  const applied = new Map(read(dir, "apply.json").map((a) => [a.tid, a]));
  const lines = [`# kpatch 실행 결과 (${path.basename(dir)})`, ""];

  for (const [action, label] of Object.entries(LABEL)) {
    const rows = plan.filter((i) => i.action === action);
    if (!rows.length) continue;
    lines.push(`## ${label} (${rows.length})`, "", "| 게임 | title id | 버전 | 결과·이유 | 글 |", "|---|---|---|---|---|");
    for (const i of rows) {
      const a = applied.get(i.tid);
      const why = a ? `${a.result}${a.reason ? `: ${a.reason}` : ""}` : (i.reason ?? (i.candidates?.length ? `후보 ${i.candidates.join(", ")}` : ""));
      lines.push(`| ${i.name ?? i.subject} | ${i.tid ?? ""} | ${i.version ?? ""} | ${why.replace(/\|/g, "/")} | ${link(i)} |`);
    }
    lines.push("");
  }
  const file = path.join(dir, "report.md");
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  console.log(file);
}
