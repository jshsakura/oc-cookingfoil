import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_ADVICE, adviceFor } from "../../src/retro/core-advice.js";
import { CORE_ADVICE_WORDS } from "../../src/retro/core-advice-words.js";
import { DEFAULT_SYSTEMS } from "../../src/retro/systems.js";
import { CORE_RE } from "../../src/retro/system-cores.js";
import { RA_SETTINGS, badSetting, settingsView } from "../../src/retro/ra-settings.js";
import { RA_SETTINGS_WORDS } from "../../src/retro/ra-settings-words.js";

// The cores https://buildbot.libretro.com/nightly/nintendo/switch/libnx/latest/ listed on 2026-11-01.
const NIGHTLY = new Set(`gearsystem pcsx_rearmed dosbox_svn scummvm jumpnbump easyrpg mednafen_supergrafx gam4980 mame2003_midway dosbox_pure lutro smsplus hatari puae2021 tamalibretro mu ecwolf stella2023 uw8 np2kai vice_xcbm5x0 gong mame2003_plus mednafen_pce squirreljme jaxe mednafen_supafaust hatarib genesis_plus_gx_wide gme vecx dinothawr quasi88 vice_xcbm2 wasm4 vitaquake3 nxengine DoubleCherryGB bluemsx mgba bsnes mednafen_vb stella mesens quicknes cap32 fmsx vba_next fbalpha2012_cps2 mojozork vitaquake2-zaero mesen-s sameduck vice_xvic pocketcdg atari800 gambatte vice_x64sc ardens yabause vaporspec fuse vice_xplus4 bk 2048 x1 flycast geargrafx mrboom theodore bsnes_hd_beta fbalpha2012 prosystem freeintv fceumm lowresnx gearlynx vitaquake2-xatrix 81 minivmac sameboy freechaf amiarcadia px68k neocd puae dosbox_core vice_x64 virtualjaguar gearcoleco frodo snes9x vbam fbneo vice_xpet snes9x2010 race opera reminiscence boom3_xp handy gw pd777 vice_xscpu64 parallel_dc mednafen_wswan mednafen_ngp o2em mesen2 desmume fbalpha2012_cps1 tyrquake arduous superbroswar fbalpha ppsspp vircon32 stella2014 clownmdemu mednafen_pce_fast potator boom3 a5200 crocods gearboy dice melonds prboom uzem vitaquake2 mupen64plus_next tia mame2000 tgbdual picodrive mednafen_pcfx tic80 anarch xrick geartowns numero vice_x128 chailove vitaquake2-rogue mesen pokemini gametank retro8 gpsp mame2003 fbalpha2012_neogeo mednafen_lynx nestopia cannonball genesis_plus_gx`.split(/\s+/));
const ADMIN_LANGS = ["ko", "en", "ja", "zh"];

test("every console has advice, and the recommended core is the one its games start with by default", () => {
  for (const [id, s] of Object.entries(DEFAULT_SYSTEMS)) {
    assert.ok(CORE_ADVICE[id], `${id} has advice`);
    assert.equal(CORE_ADVICE[id].pick, s.core, `${id}: a new server already runs the recommended core`);
  }
  assert.deepEqual(Object.keys(CORE_ADVICE).filter((id) => !DEFAULT_SYSTEMS[id]), [], "no advice for a console the server does not know");
});

test("every recommended or alternative core can be fetched from the Switch nightly, unless the advice says it comes another way", () => {
  for (const [id, a] of Object.entries(CORE_ADVICE)) {
    for (const core of [a.pick, ...a.alts]) {
      assert.match(core, CORE_RE, `${id}: ${core} is a core id the server takes`);
      if (!a.separate) assert.ok(NIGHTLY.has(core), `${id}: ${core} is in the nightly`);
    }
    if (a.separate) assert.ok(!NIGHTLY.has(a.pick), `${id}: separate only when the nightly really lacks it`);
    assert.equal(new Set([a.pick, ...a.alts]).size, a.alts.length + 1, `${id}: no core twice`);
  }
});

test("every reason is said in each admin language", () => {
  for (const lang of ADMIN_LANGS) {
    for (const [id, a] of Object.entries(CORE_ADVICE)) {
      assert.ok(CORE_ADVICE_WORDS[lang][id], `${lang} ${id}`);
      for (const core of a.alts) assert.ok(CORE_ADVICE_WORDS[lang][`${id}.${core}`], `${lang} ${id}.${core}`);
    }
    assert.deepEqual(Object.keys(CORE_ADVICE_WORDS[lang]).sort(), Object.keys(CORE_ADVICE_WORDS.ko).sort(), lang);
  }
  const ko = adviceFor("snes", "ko");
  assert.equal(ko.pick, "snes9x");
  assert.equal(ko.alts[0].why, CORE_ADVICE_WORDS.ko["snes.snes9x2010"]);
  assert.equal(adviceFor("snes", "fr").why, CORE_ADVICE_WORDS.en.snes, "a language without words reads English");
  assert.equal(adviceFor("nope"), null);
});

test("every named RetroArch setting has a label in each admin language, and its default is one of its values", () => {
  for (const lang of ADMIN_LANGS) {
    const v = settingsView(lang);
    for (const g of v.groups) {
      assert.ok(g.label, `${lang} group ${g.id}`);
      for (const s of g.settings) {
        assert.ok(s.label, `${lang} ${s.key}`);
        if (RA_SETTINGS.get(s.key).help) assert.ok(s.help, `${lang} ${s.key}.help`);
        for (const x of s.values ?? []) assert.ok(x.label && x.label !== x.value || /^[a-z]+$/.test(x.value) === false, `${lang} ${s.key}=${x.value} has a label`);
      }
    }
    for (const a of v.advice) assert.ok(a.why, `${lang} advice ${a.core}`);
    assert.deepEqual(Object.keys(RA_SETTINGS_WORDS[lang]).sort(), Object.keys(RA_SETTINGS_WORDS.ko).sort(), lang);
  }
  for (const s of RA_SETTINGS.values()) {
    if (s.def === null) continue;
    assert.equal(badSetting(s.key, s.def), null, `${s.key} default ${s.def} fits`);
  }
});

test("a named setting takes only its own values; any other key takes any value", () => {
  assert.equal(badSetting("video_threaded", "false"), null);
  assert.equal(badSetting("video_threaded", "no"), "badValue");
  assert.equal(badSetting("run_ahead_frames", "7"), "badValue");
  assert.equal(badSetting("run_ahead_frames", "6"), null);
  assert.equal(badSetting("aspect_ratio_index", "22"), null);
  assert.equal(badSetting("aspect_ratio_index", "99"), "badValue");
  assert.equal(badSetting("some_core_option", "anything"), null);
  assert.equal(badSetting("video_threaded", null), null, "removing a line is always fine");
});
