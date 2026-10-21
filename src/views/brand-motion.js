/** The existing sign-in logo's entrance, with a quiet hop between long rests. */
import fs from "node:fs";

// Inline on sign-in and restart pages: /assets may be gated or unavailable.
export const BRAND_LOGO = `data:image/svg+xml;base64,${fs.readFileSync(new URL("./assets/cookingfoil.svg", import.meta.url)).toString("base64")}`;

export const BRAND_MOTION_CSS = /* css */ `
.brand-motion{transform-origin:50% 100%;animation:cf-logo-drop .7s cubic-bezier(.3,.7,.4,1) both,cf-logo-hop 16s ease-in-out 1.6s infinite}
@keyframes cf-logo-drop{0%{transform:translateY(-40px) scale(.9,1.1);opacity:0}45%{transform:translateY(0) scale(.95,1.05);opacity:1}60%{transform:translateY(0) scale(1.1,.85)}78%{transform:translateY(-6px) scale(.97,1.03)}100%{transform:none}}
@keyframes cf-logo-hop{0%,92%,100%{transform:none}94%{transform:translateY(-6px) scale(.97,1.03)}96%{transform:scale(1.08,.92)}98%{transform:translateY(-2px)}}
@media(prefers-reduced-motion:reduce){.brand-motion{animation:none}}
`;
