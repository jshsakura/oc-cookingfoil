/**
 * Where a game's files land on the SD card, and the RetroArch configs made up
 * for a bezel when the operator didn't supply them. Paths are relative to the
 * SD root. Pure.
 */
/** SD paths for one game's bundle. */
export function sdPaths(game, system) {
  const overlayDir = `retroarch/overlays/GameBezels/${system.bezelDir}`;
  return {
    rom: `roms/${game.system}/${game.rel}`,
    extra: (rel) => `roms/${game.system}/${rel}`,
    bezelPng: `${overlayDir}/${game.name}.png`,
    overlayCfg: `${overlayDir}/${game.name}.cfg`,
    gameCfg: system.coreName ? `retroarch/config/${system.coreName}/${game.name}.cfg` : null,
  };
}

/** The overlay config: one full-screen image, no buttons. */
export function overlayCfg(game) {
  return [
    "overlays = 1",
    `overlay0_overlay = "${game.name}.png"`,
    "overlay0_full_screen = true",
    "overlay0_descs = 0",
    "",
  ].join("\n");
}

/**
 * Per-game RetroArch config: a 4:3 picture in the middle of a 720p screen
 * (960x720 at x=160), with the bezel around it.
 */
export function gameCfg(game, system) {
  const overlay = "/" + sdPaths(game, system).overlayCfg;
  return [
    'aspect_ratio_index = "22"',
    'custom_viewport_width = "960"',
    'custom_viewport_height = "720"',
    'custom_viewport_x = "160"',
    'custom_viewport_y = "0"',
    'video_scale_integer = "false"',
    'input_overlay_enable = "true"',
    'input_overlay_opacity = "1.000000"',
    `input_overlay = "${overlay}"`,
    "",
  ].join("\n");
}
