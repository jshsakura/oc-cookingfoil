/**
 * Where a game's files land on the SD card, and the RetroArch configs made up
 * for a bezel when the operator didn't supply them. Paths are relative to the
 * SD root. Pure.
 */
/**
 * SD paths for one game's bundle, from its plan in retro/sd-names.js (`game.sd`):
 * ASCII names throughout. RetroArch loads a per-game config named after the
 * ROM, so the config and the bezel files use the ROM's stem too.
 */
export function sdPaths(game, system) {
  const overlayDir = `retroarch/overlays/GameBezels/${system.bezelDir}`;
  const stem = game.sd?.stem ?? game.name;
  return {
    rom: game.sd?.rom ?? `roms/${game.system}/${game.rel}`,
    extra: (rel) => game.sd?.extras.get(rel)?.sd ?? `roms/${game.system}/${rel}`,
    bezelPng: `${overlayDir}/${stem}.png`,
    overlayCfg: `${overlayDir}/${stem}.cfg`,
    gameCfg: system.coreName ? `retroarch/config/${system.coreName}/${stem}.cfg` : null,
  };
}

/** The overlay config: one full-screen image, no buttons. */
export function overlayCfg(game) {
  return [
    "overlays = 1",
    `overlay0_overlay = "${game.sd?.stem ?? game.name}.png"`,
    "overlay0_full_screen = true",
    "overlay0_descs = 0",
    "",
  ].join("\n");
}

/**
 * Per-game RetroArch config: the bezel around a picture in the core's own
 * aspect ratio (4:3 for home consoles, 3:2 for the GBA, …). The console draws
 * 720p handheld and 1080p docked, so a fixed pixel viewport would only fit one
 * of them; The Bezel Project's images are cut for the core's aspect ratio.
 */
/** An operator's own per-game config, pointed at the renamed overlay. Pure. */
export function retargetOverride(text, game, system) {
  const overlay = "/" + sdPaths(game, system).overlayCfg;
  return text.replace(/^(\s*input_overlay\s*=\s*).*$/m, `$1"${overlay}"`);
}

export function gameCfg(game, system) {
  const overlay = "/" + sdPaths(game, system).overlayCfg;
  return [
    'video_aspect_ratio_auto = "true"',
    'video_scale_integer = "false"',
    'input_overlay_enable = "true"',
    'input_overlay_opacity = "1.000000"',
    `input_overlay = "${overlay}"`,
    "",
  ].join("\n");
}
