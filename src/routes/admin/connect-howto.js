/**
 * The overview tab's "연결" line: how a console joins this server, written
 * from the settings in force when the page is drawn, so the page never tells
 * the admin a way in that the server would refuse.
 *
 *   devicePairing    CookingFoil joins by QR (or as a client downloaded from the web page)
 *   deviceApproval   who approves a QR request
 *   passwordsOn()    whether an ID and password given at pairing approves the console at once
 */
import * as env from "../../helpers/envs.js";
import { passwordsOn } from "../../security/password-policy.js";
import { topHtml } from "./top-i18n.js";

// Each piece is its own swappable span, so a language change rewords the line piece by piece.
const APPROVAL = {
  manual: topHtml("ch.apprManual"),
  signin: "",
};

const ONE_TIME_PASSWORD = topHtml("ch.oncePw");
const NO_PASSWORD = topHtml("ch.noPw");

const SHORTCUT = topHtml("ch.shortcut");

/** The <li> lines for the current settings. `s` stands in for the live settings in tests. */
export function connectHowto(s = {
  devicePairing: env.devicePairing,
  deviceApproval: env.deviceAutoApprove ? "signin" : "manual",
  accountPasswords: passwordsOn(),
}) {
  if (!s.devicePairing) return [topHtml("ch.off")];
    const password = s.deviceApproval === "signin" && s.accountPasswords ? ONE_TIME_PASSWORD : NO_PASSWORD;
  return [`${topHtml("ch.connect")}${password}${APPROVAL[s.deviceApproval] ?? ""}`, SHORTCUT];
}
