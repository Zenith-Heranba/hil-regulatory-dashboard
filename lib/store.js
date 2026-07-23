// Redis-backed store (Upstash, via the Vercel Marketplace integration): base dataset
// (from the latest Excel ingest) + admin overrides layered on top. Vercel serverless
// functions have no persistent local disk, so — unlike the earlier Railway version of
// this file — every read/write goes to Redis instead of a JSON file. Upstash's REST
// client auto-serializes/deserializes JS objects to/from JSON, so values are stored
// and read back as plain objects.
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');
const { rowId, TABLE_PATHS, EDITABLE_FIELDS } = require('./rowid');

const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN

const BASE_KEY = 'hil:base';
const OVERRIDES_KEY = 'hil:overrides';
const INGESTED_AT_KEY = 'hil:ingestedAt';

const SEED_PATH = path.join(__dirname, '..', 'data', 'base-data.json');

async function getBase() {
  let base = await redis.get(BASE_KEY);
  if (!base) {
    // First run against a fresh Redis store: seed from the dataset bundled in the repo.
    base = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
    await redis.set(BASE_KEY, base);
    await redis.set(INGESTED_AT_KEY, (base.meta && base.meta.generated) || null);
  }
  return base;
}

async function getOverrides() {
  const ov = await redis.get(OVERRIDES_KEY);
  return ov || {};
}

function countOverrides(overrides) {
  let n = 0;
  for (const t of Object.keys(overrides)) n += Object.keys(overrides[t]).length;
  return n;
}

// Deep-cloned merged dataset: base rows tagged with _id, with any stored
// overrides applied on top. Safe to mutate the returned object.
async function getMerged() {
  const [base, overrides, ingestedAt] = await Promise.all([getBase(), getOverrides(), redis.get(INGESTED_AT_KEY)]);
  const merged = JSON.parse(JSON.stringify(base));
  for (const [table, getter] of Object.entries(TABLE_PATHS)) {
    const rows = getter(merged);
    if (!Array.isArray(rows)) continue;
    rows.forEach((row) => {
      const id = rowId(table, row);
      row._id = id;
      const ov = overrides[table] && overrides[table][id];
      if (ov) Object.assign(row, ov.fields);
    });
  }
  merged.meta = merged.meta || {};
  merged.meta.overrides_count = countOverrides(overrides);
  merged.meta.ingested_at = ingestedAt;
  return merged;
}

// Look up a row's current base object by table+id (used to validate edits).
async function findBaseRow(table, id) {
  const getter = TABLE_PATHS[table];
  if (!getter) return null;
  const base = await getBase();
  const rows = getter(base);
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => rowId(table, r) === id) || null;
}

async function setOverride(table, id, field, value, editor) {
  const allowed = EDITABLE_FIELDS[table];
  if (!allowed || !allowed.includes(field)) {
    throw new Error(`Field "${field}" is not editable on table "${table}"`);
  }
  if (!(await findBaseRow(table, id))) {
    throw new Error(`Row not found (table may have changed on the last Excel sync)`);
  }
  const overrides = await getOverrides();
  overrides[table] = overrides[table] || {};
  overrides[table][id] = overrides[table][id] || { fields: {}, editedAt: null, editor: null };
  overrides[table][id].fields[field] = value;
  overrides[table][id].editedAt = new Date().toISOString();
  overrides[table][id].editor = editor || null;
  await redis.set(OVERRIDES_KEY, overrides);
}

async function clearOverrides(table) {
  if (table) {
    const overrides = await getOverrides();
    delete overrides[table];
    await redis.set(OVERRIDES_KEY, overrides);
  } else {
    await redis.set(OVERRIDES_KEY, {});
  }
}

async function setBase(newBase) {
  await redis.set(BASE_KEY, newBase);
  await redis.set(INGESTED_AT_KEY, new Date().toISOString());
  // Overrides whose row no longer exists in the new base simply stop applying at merge
  // time (findBaseRow / rowId lookups won't match) — nothing else to do here.
}

async function overridesCount() {
  return countOverrides(await getOverrides());
}

function rowCounts(dataset) {
  const out = {};
  for (const [table, getter] of Object.entries(TABLE_PATHS)) {
    const rows = getter(dataset);
    out[table] = Array.isArray(rows) ? rows.length : 0;
  }
  return out;
}

module.exports = { getMerged, setOverride, clearOverrides, setBase, overridesCount, rowCounts, findBaseRow };
