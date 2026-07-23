// Simple JSON-file-backed store: base dataset (from the latest Excel ingest) +
// admin overrides layered on top. No native deps, so it deploys reliably anywhere.
// NOTE: for edits to survive a redeploy, the STORE_PATH directory needs to be on
// a persistent volume (see README.md).
const fs = require('fs');
const path = require('path');
const { rowId, TABLE_PATHS, EDITABLE_FIELDS } = require('./rowid');

const STORE_PATH = process.env.STORE_PATH || path.join(__dirname, '..', 'data', 'store.json');
const SEED_PATH = path.join(__dirname, '..', 'data', 'base-data.json');

let state = null; // { base, overrides, ingestedAt }
let writeQueue = Promise.resolve();

function load() {
  if (fs.existsSync(STORE_PATH)) {
    state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  } else {
    const base = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
    state = { base, overrides: {}, ingestedAt: base.meta && base.meta.generated || null };
    persist();
  }
}

function persist() {
  writeQueue = writeQueue.then(() => {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));
  });
  return writeQueue;
}

function overridesCount() {
  let n = 0;
  for (const t of Object.keys(state.overrides)) n += Object.keys(state.overrides[t]).length;
  return n;
}

// Deep-cloned merged dataset: base rows tagged with _id, with any stored
// overrides applied on top. Safe to mutate the returned object.
function getMerged() {
  const merged = JSON.parse(JSON.stringify(state.base));
  for (const [table, getter] of Object.entries(TABLE_PATHS)) {
    const rows = getter(merged);
    if (!Array.isArray(rows)) continue;
    rows.forEach((row) => {
      const id = rowId(table, row);
      row._id = id;
      const ov = state.overrides[table] && state.overrides[table][id];
      if (ov) Object.assign(row, ov.fields);
    });
  }
  merged.meta = merged.meta || {};
  merged.meta.overrides_count = overridesCount();
  merged.meta.ingested_at = state.ingestedAt;
  return merged;
}

// Look up a row's current base object by table+id (used to validate edits).
function findBaseRow(table, id) {
  const getter = TABLE_PATHS[table];
  if (!getter) return null;
  const rows = getter(state.base);
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => rowId(table, r) === id) || null;
}

function setOverride(table, id, field, value, editor) {
  const allowed = EDITABLE_FIELDS[table];
  if (!allowed || !allowed.includes(field)) {
    throw new Error(`Field "${field}" is not editable on table "${table}"`);
  }
  if (!findBaseRow(table, id)) {
    throw new Error(`Row not found (table may have changed on the last Excel sync)`);
  }
  state.overrides[table] = state.overrides[table] || {};
  state.overrides[table][id] = state.overrides[table][id] || { fields: {}, editedAt: null, editor: null };
  state.overrides[table][id].fields[field] = value;
  state.overrides[table][id].editedAt = new Date().toISOString();
  state.overrides[table][id].editor = editor || null;
  return persist();
}

function clearOverrides(table) {
  if (table) delete state.overrides[table];
  else state.overrides = {};
  return persist();
}

function setBase(newBase) {
  state.base = newBase;
  state.ingestedAt = new Date().toISOString();
  // Overrides whose row no longer exists in the new base are dropped automatically
  // at merge time (findBaseRow / rowId lookups simply won't match), so nothing
  // else to do here — stale overrides just stop applying rather than erroring.
  return persist();
}

function rowCounts(dataset) {
  const out = {};
  for (const [table, getter] of Object.entries(TABLE_PATHS)) {
    const rows = getter(dataset);
    out[table] = Array.isArray(rows) ? rows.length : 0;
  }
  return out;
}

load();

module.exports = { getMerged, setOverride, clearOverrides, setBase, overridesCount, rowCounts, findBaseRow };
