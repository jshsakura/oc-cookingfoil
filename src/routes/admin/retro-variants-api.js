/**
 * Versions of one retro game, from the admin page (retro tab):
 *
 *   GET  /admin/api/retro-variants             groups with more than one file:
 *                                              { groups: [{ id, system, systemName, kind, reason, picked, members: [M…] }] }
 *   GET  /admin/api/retro-variants/sets        every arcade game with its sets, best first, and counts:
 *                                              { summary: { groups, sets, listed, broken, hidden: { bootleg, hack, … } },
 *                                                groups: [{ id, reason, picked, listed, members: [M…] }] }
 *   POST /admin/api/retro-variants/pick        { group, game }  that file represents the group (game null: the rule's pick)
 *   POST /admin/api/retro-variants/trash       { game, force? } move the file and its art into <retro dir>/.cookingfoil-trash/<date>/;
 *                                              409 with { dependents } when other arcade sets need it, unless force
 *   GET  /admin/api/retro-variants/trash       { items: [{ entry, home, id, trashId, system, name, file, size, trashedAt, files }] }
 *   POST /admin/api/retro-variants/restore     { entry, home? } put it back; a file whose place was taken comes back
 *                                              beside it under a numbered name ({ renamed })
 *
 * M = { id, name, file, variant?, edition?, region?, size, addedAt, representative, missing?, class?, hidden? }
 * `class` is an arcade set's tags (arcade-policy.js classifySet); `hidden` says
 * why a set is not listed by default: missing, bootleg, hack, prototype, demo.
 * Picks are saved in the data dir (retro-variants.json) and show at once.
 */
import debug from "../../debug.js";
import { retroDir } from "../../helpers/envs.js";
import * as retroCatalog from "../../retro/catalog.js";
import { editionOf } from "../../retro/edition.js";
import { regionOf } from "../../retro/arcade.js";
import { tagsOf } from "../../retro/sd-names.js";
import { groupVisible, hiddenClass, representative } from "../../retro/variants.js";
import * as picks from "../../retro/variant-picks.js";
import { listTrash, restoreEntry, stillUsed, trashGame, TrashError } from "../../retro/trash.js";
import { actorOf } from "../../library/trash-service.js";

function member(g, rep, group) {
  const variant = tagsOf(g.name);
  const edition = g.edition ?? editionOf(variant);
  const region = g.region ?? (edition ? "kr" : regionOf(variant));
  const cls = group.classes?.get(g.id);
  const hidden = g === rep ? (groupVisible(rep) ? null : "missing") : hiddenClass(g, cls);
  return {
    id: g.id, name: g.name, file: g.file,
    ...(variant ? { variant } : {}), ...(edition ? { edition } : {}), ...(region ? { region } : {}),
    size: g.size, addedAt: g.addedAt, representative: g === rep,
    ...(g.missing?.length ? { missing: g.missing } : {}),
    ...(cls ? { class: cls } : {}),
    ...(hidden ? { hidden } : {}),
  };
}

function publicGroup(group, systems) {
  const picked = picks.get(group.id);
  const rep = representative(group, picked);
  const pickedNow = Boolean(picked) && rep.id === picked && rep !== group.members[0];
  return {
    id: group.id,
    system: group.system,
    systemName: systems[group.system]?.names?.ko ?? group.system,
    kind: group.kind,
    reason: pickedNow ? "관리자가 정했습니다" : group.reason,
    picked: pickedNow ? picked : null,
    listed: groupVisible(rep),
    members: group.members.map((g) => member(g, rep, group)),
  };
}

/** Other arcade sets in the folder that load this one (as their parent or BIOS). */
const dependentsOf = (catalog, g) =>
  g.keepFileName ? catalog.games.filter((o) => o !== g && o.system === g.system && o.extras.some((x) => x.rel === g.rel)).map((o) => o.file) : [];

export function mountRetroVariantsApi(router, requireSession) {
  const guarded = (handler) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof TrashError) return res.status(err.status ?? 409).json({ error: err.message });
      debug.error("admin retro-variants: %s", err.message);
      res.status(502).json({ error: err.message });
    }
  };

  router.get("/api/retro-variants", guarded(async (_req, res) => {
    const catalog = await retroCatalog.current(retroDir);
    const groups = [...catalog.groups.values()].filter((g) => g.members.length > 1).map((g) => publicGroup(g, catalog.systems));
    res.json({ groups });
  }));

  router.get("/api/retro-variants/sets", guarded(async (_req, res) => {
    const catalog = await retroCatalog.current(retroDir);
    const groups = [...catalog.groups.values()].filter((g) => g.kind === "arcade").map((g) => publicGroup(g, catalog.systems));
    const members = groups.flatMap((g) => g.members);
    const hidden = {};
    for (const m of members) if (m.hidden) hidden[m.hidden] = (hidden[m.hidden] ?? 0) + 1;
    res.json({
      summary: { groups: groups.length, sets: members.length, listed: groups.filter((g) => g.listed).length, broken: members.filter((m) => m.missing).length, hidden },
      groups,
    });
  }));

  router.post("/api/retro-variants/pick", guarded(async (req, res) => {
    const catalog = await retroCatalog.current(retroDir);
    const group = catalog.groups.get(String(req.body?.group ?? ""));
    if (!group) return res.status(404).json({ error: "없는 묶음입니다" });
    const game = req.body?.game == null ? null : String(req.body.game);
    if (game !== null && !group.members.some((g) => g.id === game)) return res.status(400).json({ error: "이 묶음의 파일이 아닙니다" });
    // A set that can't run would leave the group with nothing to list.
    if (game !== null && group.members.find((g) => g.id === game).missing?.length) return res.status(400).json({ error: "실행되지 않는 세트는 추천 버전으로 정할 수 없습니다" });
    picks.set(group.id, game === group.members[0].id ? null : game);
    debug.log("admin: retro group %s represented by %s", group.id, game ?? "(rule)");
    res.json({ ok: true, group: publicGroup(group, catalog.systems) });
  }));

  router.get("/api/retro-variants/trash", guarded(async (_req, res) => {
    res.json({ items: await listTrash(retroDir) });
  }));

  router.post("/api/retro-variants/trash", guarded(async (req, res) => {
    const catalog = await retroCatalog.current(retroDir);
    const g = catalog.byId.get(String(req.body?.game ?? ""));
    if (!g) return res.status(404).json({ error: "목록에 없는 게임입니다" });
    const dependents = dependentsOf(catalog, g);
    if (dependents.length && req.body?.force !== true) return res.status(409).json({ error: "다른 세트가 이 파일을 씁니다", dependents });
    try {
      const result = await trashGame(retroDir, g, catalog.systems[g.system], { keep: stillUsed(g, catalog.games), by: actorOf(req) });
      debug.log("admin: retro game %s moved to the trash (%d files)", g.id, result.files.length);
      await retroCatalog.rescan(retroDir);
      res.json({ ok: true, ...result });
    } finally {
      // Whatever moved, the lists follow the folder at once.
      retroCatalog.rescan(retroDir).catch((err) => debug.error("retro: rescan after a variant change failed: %s", err.message));
    }
  }));

  router.post("/api/retro-variants/restore", guarded(async (req, res) => {
    try {
      const home = typeof req.body?.home === "string" ? req.body.home : null;
      const result = await restoreEntry(retroDir, String(req.body?.entry ?? ""), home);
      debug.log("admin: retro game %s restored from the trash", result.id);
      await retroCatalog.rescan(retroDir);
      res.json({ ok: true, ...result });
    } finally {
      retroCatalog.rescan(retroDir).catch((err) => debug.error("retro: rescan after a variant change failed: %s", err.message));
    }
  }));
}
