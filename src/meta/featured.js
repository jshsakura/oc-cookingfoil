/**
 * Collections the operator picks on /admin to feature on the client's home
 * screen ("이번 주 추천", "가족과 함께"). Stored as ${COOK_DATA_DIR}/featured.json.
 *
 * They reach the client as a top-level `featured` array in the sections
 * response, referring to base title ids rather than repeating the items: the
 * client already holds every item, and CyberFoil must not see a second copy of
 * each file as another section.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import debug from "../debug.js";
import { dataDir } from "../helpers/envs.js";

const STORE_PATH = path.join(dataDir, "featured.json");
const MAX_COLLECTIONS = 12;
const MAX_TITLES = 40;
const MAX_TITLE_CHARS = 40;
const ID_RE = /^[a-z0-9-]{1,32}$/;
const TITLE_ID_RE = /^[0-9A-F]{16}$/;

let collections = [];
const listeners = [];

class FeaturedError extends Error {
  constructor(message) {
    super(message);
    this.code = "invalid-featured";
  }
}

function isBaseTitleId(id) {
  return TITLE_ID_RE.test(id) && (BigInt(`0x${id}`) & 0x1fffn) === 0n;
}

function cleanCollection(raw, index) {
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  if (!title || title.length > MAX_TITLE_CHARS) {
    throw new FeaturedError(`${index + 1}번째 추천의 제목은 1-${MAX_TITLE_CHARS}자로 씁니다.`);
  }
  const ids = Array.isArray(raw.titleIds) ? raw.titleIds : [];
  const titleIds = [...new Set(ids.map((id) => String(id).toUpperCase()))];
  if (titleIds.some((id) => !isBaseTitleId(id))) {
    throw new FeaturedError(`"${title}" 에 본편이 아닌 타이틀 ID 가 있습니다.`);
  }
  if (titleIds.length > MAX_TITLES) {
    throw new FeaturedError(`"${title}" 에는 게임을 ${MAX_TITLES}개까지 넣습니다.`);
  }
  const banner = raw.bannerTitleId ? String(raw.bannerTitleId).toUpperCase() : null;
  return {
    id: typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : crypto.randomBytes(4).toString("hex"),
    title,
    bannerTitleId: banner && titleIds.includes(banner) ? banner : null,
    titleIds,
  };
}

/** Validates the whole list; throws FeaturedError with a message for the operator. */
export function normalize(list) {
  if (!Array.isArray(list)) throw new FeaturedError("추천 목록 형식이 아닙니다.");
  if (list.length > MAX_COLLECTIONS) throw new FeaturedError(`추천은 ${MAX_COLLECTIONS}개까지 만듭니다.`);
  const out = list.map(cleanCollection);
  const ids = new Set();
  for (const c of out) {
    while (ids.has(c.id)) c.id = crypto.randomBytes(4).toString("hex");
    ids.add(c.id);
  }
  return out;
}

function load() {
  try {
    collections = normalize(JSON.parse(fs.readFileSync(STORE_PATH, "utf8")).collections);
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("featured: cannot read %s: %s", STORE_PATH, err.message);
    collections = [];
  }
}

export function list() {
  return collections.map((c) => ({ ...c, titleIds: [...c.titleIds] }));
}

export function onChange(fn) {
  listeners.push(fn);
}

/** Replaces every collection at once, the way the admin page edits them. */
export function replace(next) {
  const cleaned = normalize(next);
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, collections: cleaned }, null, 2));
  fs.renameSync(tmp, STORE_PATH);
  collections = cleaned;
  for (const fn of listeners) fn();
  return list();
}

/** The wire form inside the sections response; empty collections are left out. */
export function forSections() {
  return collections
    .filter((c) => c.titleIds.length)
    .map((c) => {
      const out = { id: c.id, title: c.title, title_ids: [...c.titleIds] };
      if (c.bannerTitleId) out.banner_url = `/api/shop/banner/${c.bannerTitleId}`;
      return out;
    });
}

load();
