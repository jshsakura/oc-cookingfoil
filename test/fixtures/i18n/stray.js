// 이 주석은 세지 않습니다
export const WORDS = { ko: { save: "저장합니다" }, en: { save: "Saved" }, ja: { save: "保存しました" }, zh: { save: "已保存" } };
export const message = () => "저장하지 못했습니다";
export const page = /* js */ `
const t = ${JSON.stringify("x")};
// 안쪽 주석도 세지 않습니다
alert('안쪽 문구' + t);
`;
export const html = `<p title="제목">본문</p><!-- 주석 -->`;
export const pattern = /한글/;
export const language = "한국어";
export const count = (n) => `${n}개`;
