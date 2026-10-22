/**
 * Who made the art the retro tab downloads, for the admin page and the game detail
 * (`bezel.credit` in /api/retro/games/:id). The text is the server's, in the twelve client
 * languages, so a client shows it as it is.
 */
import { pick } from "../meta/langs.js";

export const BEZEL_CREDIT = Object.freeze({
  name: "The Bezel Project",
  url: "https://github.com/thebezelproject",
  text: Object.freeze({
    en: "Bezels are made and shared by The Bezel Project community. Thank you.",
    ko: "베젤은 The Bezel Project 커뮤니티가 만들어 공개한 작품입니다. 감사합니다.",
    ja: "ベゼルは The Bezel Project コミュニティが制作・公開した作品です。ありがとうございます。",
    zh: "边框由 The Bezel Project 社区制作并公开。感谢他们。",
    "zh-Hant": "邊框由 The Bezel Project 社群製作並公開。感謝他們。",
    es: "Los bezels los crea y comparte la comunidad The Bezel Project. Gracias.",
    fr: "Les bezels sont créés et partagés par la communauté The Bezel Project. Merci.",
    de: "Die Bezels stammen von der Community des The Bezel Project. Vielen Dank.",
    it: "I bezel sono creati e condivisi dalla community di The Bezel Project. Grazie.",
    pt: "Os bezels são criados e compartilhados pela comunidade The Bezel Project. Obrigado.",
    ru: "Рамки созданы и опубликованы сообществом The Bezel Project. Спасибо.",
    nl: "De bezels zijn gemaakt en gedeeld door de community van The Bezel Project. Bedankt.",
  }),
});

/** The credit of a bezel as the game detail carries it: { name, url, text } in `lang`. Pure. */
export const bezelCredit = (lang) => ({ name: BEZEL_CREDIT.name, url: BEZEL_CREDIT.url, text: pick(BEZEL_CREDIT.text, lang) });
