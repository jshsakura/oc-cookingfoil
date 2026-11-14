// The Switch: everything the server did before platforms came in. Its rules stay where they were; this names it.
export default {
  id: "switch",
  titleId: /^[0-9A-Fa-f]{16}$/,
  clientBuild: "cookingfoil.nro",
  backupKinds: [],
  secretKinds: [],
  isSecretPath: () => false,
};
