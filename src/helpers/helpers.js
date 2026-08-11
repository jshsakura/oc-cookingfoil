// Use the file system fs promises
import { readFile, writeFile } from "fs/promises";
import fs from "fs";
import path from "path";
import JSON5 from "json5";
import { fileURLToPath } from "url";
import { dirname } from "path";
import urlencode from "urlencode";
import url from "url";

import { romsDirPath, jsonTemplatePath } from "./envs.js";

const addRelativeStartPath = (path) => {
  path.url = "../" + path.url;
  return path;
};

/**
 * 상대 경로를 tinfoil 와이어 포맷으로 퍼센트 인코딩한다.
 *
 * 예전에는 `url.parse(path).path` 로 1차 인코딩한 뒤 손으로 만든 치환표로
 * 몇 글자를 더 바꿨다. 그 표에 `?` 와 `#` 이 없어서 그런 이름을 가진 파일이
 * 목록에는 보이지만 받으면 깨졌다 — 실측 11건.
 *
 *   "What The Golf?"  → url.parse 가 `?` 를 쿼리 구분자로 남긴다      → 404
 *   "Test #Hash"      → url.parse 가 `#` 뒤를 통째로 버린다("Test%20") → URL 절단
 *   "100% Orange"     → 리터럴 `%` 가 남아 퍼센트 인코딩이 깨진다
 *
 * encodeURIComponent 는 이 셋을 포함해 예약문자를 전부 처리한다. `/` 도
 * `%2F` 로 바꾸는데, 기존 와이어 포맷이 그걸 쓰므로 의도한 동작이다.
 * 다만 `(` `)` 는 남기므로(RFC3986 상 sub-delim) 옛 출력과 맞추려고 직접 바꾼다.
 * `!` `*` `'` `~` 는 예전에도 그대로 뒀으므로 건드리지 않는다.
 *
 * @param {string} value 라이브러리 루트 기준 상대 경로
 * @returns {string} 퍼센트 인코딩된 경로
 */
function stringNormalizer(value) {
  if (!value) return value;
  return encodeURIComponent(value).replace(
    /[()]/g,
    (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}
const addUrlEncodedFileInfo = (filePath) => {
  filePath.url = stringNormalizer(filePath.url);
  return filePath;
};
const addFileInfoToPath = async (filePath) => {
  const status = fs.statSync(
    path.join(romsDirPath, filePath.replace(/^\.\.\//gim, ""))
  );
  return { url: filePath, size: status.size };
}; //  Shop template file to use
const getJsonTemplateFile = () =>
  JSON5.parse(fs.readFileSync(jsonTemplatePath));

export default function fileDirName(meta) {
  const __filename = fileURLToPath(meta.url);

  const __dirname = dirname(__filename);

  return { __dirname, __filename };
}
export {
  addUrlEncodedFileInfo,
  addFileInfoToPath,
  addRelativeStartPath,
  getJsonTemplateFile,
  fileDirName,
};
