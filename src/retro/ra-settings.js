/**
 * The RetroArch settings the admin page offers by name, in groups. Each key is one RetroArch 1.22.2 reads
 * (checked against the strings in retroarch.nro), and `def` is its default in the Switch (libnx) build as
 * config.def.h and configuration.c of v1.22.2 set it; null where that build's default was not worked out,
 * which the page shows as "RetroArch's default". Any other key can still be typed in by hand.
 *
 *   type  bool ("true" | "false"), enum (values), int (min..max)
 *
 * Labels are in ra-settings-words.js: <key> and <key>.help, g.<group>, and v.<list>.<value> for the
 * values of a list. CONFIG_ADVICE are lines we recommend in a core's override, with why (advice.<core>.<key>);
 * the page offers each one a file lacks and applies it only on a click.
 */
import { RA_SETTINGS_WORDS } from "./ra-settings-words.js";

const bool = (key, def, help = false, path = null) => ({ key, type: "bool", def, help, path });
const pick = (key, def, list, values, help = false, path = null) => ({ key, type: "enum", def, list, values, help, path });
const int = (key, def, min, max, help = false, path = null) => ({ key, type: "int", def, min, max, help, path });

const COMBO = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
// Value names that read the same in every language.
const SAME = {
  "combo.1": "↓ + Y + L + R", "combo.2": "L3 + R3", "combo.5": "L3 + R", "combo.6": "L + R", "combo.10": "ZL + ZR",
  "aspect.0": "4:3", "aspect.1": "16:9", "aspect.15": "8:7",
  "menu.ozone": "Ozone", "menu.xmb": "XMB", "menu.rgui": "RGUI", "menu.glui": "Material UI",
};

// In the order and under the names of RetroArch's Settings menu; `path` is where the console's menu has it
// (RetroArch's English labels), null where we did not pin it down.
export const RA_GROUPS = [
  { id: "video", path: "Settings > Video", settings: [
    bool("video_threaded", "true", true, "Settings > Video > Threaded Video"),
    bool("video_vsync", "true", true, "Settings > Video > Synchronization > Vertical Sync (VSync)"),
    bool("video_smooth", "false", true, "Settings > Video > Scaling > Bilinear Filtering"),
    bool("video_scale_integer", "false", true, "Settings > Video > Scaling > Integer Scale"),
    pick("aspect_ratio_index", "22", "aspect", ["22", "0", "1", "15", "21", "24"], false, "Settings > Video > Scaling > Aspect Ratio"),
    bool("video_shader_enable", null, false, "Quick Menu > Shaders > Video Shaders"),
    bool("fps_show", "false", false, null),
  ] },
  { id: "input", path: "Settings > Input", settings: [
    pick("input_menu_toggle_gamepad_combo", "4", "combo", COMBO, false, "Settings > Input > Hotkeys > Menu Toggle (Controller Combo)"),
    pick("input_quit_gamepad_combo", "0", "combo", COMBO, false, "Settings > Input > Hotkeys > Quit (Controller Combo)"),
    bool("quit_press_twice", "true", false, "Settings > Input > Hotkeys > Confirm Quit"),
    bool("menu_swap_ok_cancel_buttons", "true", false, "Settings > Input > Menu Controls > Menu Swap OK & Cancel Buttons"),
  ] },
  { id: "latency", path: "Settings > Latency", settings: [
    bool("run_ahead_enabled", "false", true, "Settings > Latency > Run-Ahead"),
    int("run_ahead_frames", "1", 1, 6, false, "Settings > Latency > Number of Frames to Run-Ahead"),
    int("video_frame_delay", "0", 0, 15, true, "Settings > Latency > Frame Delay"),
  ] },
  { id: "config", path: "Settings > Configuration", settings: [
    bool("config_save_on_exit", "true", true, "Settings > Configuration > Save Configuration on Quit"),
    bool("auto_overrides_enable", "true", true, "Settings > Configuration > Load Override Files Automatically"),
    bool("game_specific_options", "true", false, null),
  ] },
  { id: "saving", path: "Settings > Saving", settings: [
    bool("sort_savefiles_enable", "true", false, "Settings > Saving > Sort Saves into Folders by Core Name"),
    bool("sort_savestates_enable", "true", false, "Settings > Saving > Sort Save States into Folders by Core Name"),
    int("autosave_interval", "0", 0, 600, true, "Settings > Saving > SaveRAM Autosave Interval"),
    bool("savestate_auto_save", "false", true, "Settings > Saving > Auto Save State"),
    bool("savestate_auto_load", "false", true, "Settings > Saving > Auto Load State"),
    bool("savestate_thumbnail_enable", "false", false, "Settings > Saving > Save State Thumbnails"),
  ] },
  { id: "throttle", path: "Settings > Frame Throttle", settings: [
    bool("rewind_enable", "false", true, "Settings > Frame Throttle > Rewind > Rewind Support"),
  ] },
  { id: "menu", path: null, settings: [
    pick("user_language", "0", "lang", ["10", "0", "1", "12", "11"], false, "Settings > User > Language"),
    pick("menu_driver", null, "menu", ["ozone", "xmb", "rgui", "glui"], false, "Settings > Drivers > Menu"),
  ] },
];

export const RA_SETTINGS = new Map(RA_GROUPS.flatMap((g) => g.settings.map((s) => [s.key, { ...s, group: g.id }])));

/** Why `value` doesn't fit the named setting `key`, as a code, or null (any value fits a key not named here). Pure. */
export function badSetting(key, value) {
  const s = RA_SETTINGS.get(key);
  if (!s || value === null) return null;
  if (s.type === "bool") return value === "true" || value === "false" ? null : "badValue";
  if (s.type === "enum") return s.values.includes(value) ? null : "badValue";
  const n = Number(value);
  return /^-?\d+$/.test(value) && n >= s.min && n <= s.max ? null : "badValue";
}

export const CONFIG_ADVICE = [{ core: "ScummVM", key: "video_threaded", value: "false" }];

/** The settings in a language, ready for the page (labels in `lang`, en otherwise). Pure. */
export function settingsView(lang = "en") {
  const words = RA_SETTINGS_WORDS[lang] ?? RA_SETTINGS_WORDS.en;
  const say = (k) => words[k] ?? RA_SETTINGS_WORDS.en[k] ?? null;
  const setting = ({ help, list, ...s }) => ({
    ...s,
    label: say(s.key),
    help: help ? say(`${s.key}.help`) : null,
    ...(s.values ? { values: s.values.map((value) => ({ value, label: SAME[`${list}.${value}`] ?? say(`v.${list}.${value}`) ?? value })) } : {}),
  });
  return {
    groups: RA_GROUPS.map((g) => ({ id: g.id, label: say(`g.${g.id}`), path: g.path, settings: g.settings.map(setting) })),
    advice: CONFIG_ADVICE.map((a) => ({ ...a, rel: `config/${a.core}/${a.core}.cfg`, why: say(`advice.${a.core}.${a.key}`) })),
  };
}
