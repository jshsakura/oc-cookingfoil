// The PS Vita: a console that backs up what it holds and installs it again (~/app/ports/cookingfoil-vita API.md).
const TITLED = ["app", "patch", "savedata", "repatch", "readdcont", "psp-game", "psp-save", "license"];
const SECRET_KINDS = ["license", "license-db"];

export default {
  id: "vita",
  titleId: /^[A-Z0-9]{9}$/,
  clientBuild: "cookingfoil.vpk",
  backupKinds: ["app", "patch", "addcont", "license", "license-db", "savedata", "repatch", "readdcont",
    "psp-iso", "psp-game", "psp-save", "psp-config", "ra-save", "ra-state", "ra-config", "ra-system"],
  titledKinds: TITLED,
  secretKinds: SECRET_KINDS,
  // A licence's files, and wherever they sit a game's work.bin and any .rif, are bound to the owner's account.
  isSecretPath: (kind, file) =>
    SECRET_KINDS.includes(kind) || /(^|\/)sce_sys\/package\/work\.bin$/i.test(file) || /\.rif$/i.test(file),
};
