// Assigns a stable identity to each row in an editable table, based on a curated
// subset of fields that are unlikely to change on the next Excel ingest, so that
// manual admin edits keep pointing at the "same" row even if row order shifts.
const crypto = require('crypto');

// Which top-level dataset path each editable table lives at.
const TABLE_PATHS = {
  completed_registrations: (d) => d.completed_registrations,
  inprocess_registrations: (d) => d.inprocess_registrations,
  five_batch: (d) => d.data_generation.five_batch,
  tox: (d) => d.data_generation.tox,
  columbia_project: (d) => d.data_generation.columbia_project,
  unmatched_review: (d) => d.data_generation.unmatched_review,
  technical: (d) => d.completeness_matrix.technical,
  formulation: (d) => d.completeness_matrix.formulation,
};

// Fields used to compute a row's identity hash. Deliberately excludes fields
// that are expected to be the target of manual edits (status, notes, etc.)
// so an edit doesn't change the row's own identity.
const IDENTITY_FIELDS = {
  completed_registrations: ['region', 'country', 'party', 'product', 'trade_name', 'reg_date_iso'],
  inprocess_registrations: ['region', 'country', 'customer', 'product', 'date_iso'],
  five_batch: ['section', 'sr_no', 'product'],
  tox: ['product'],
  columbia_project: ['product'],
  unmatched_review: ['source_sheet', 'product'],
  technical: ['section', 'sr_no', 'product'],
  formulation: ['section', 'sr_no', 'product'],
};

// Fields an admin is allowed to overlay-edit per table. Kept deliberately
// separate from IDENTITY_FIELDS above (editing an identity field would orphan
// the row's override on the next ingest).
const EDITABLE_FIELDS = {
  completed_registrations: ['region', 'country', 'party', 'product', 'trade_name', 'reg_date_display', 'reg_date_iso', 'due_date_display', 'due_date_iso', 'notes', 'source'],
  inprocess_registrations: ['region', 'country', 'customer', 'product', 'date_display', 'date_iso', 'stage', 'status_tag', 'notes', 'source'],
  five_batch: ['product', 'sample_available', 'sample_sent_to', 'status'],
  tox: ['product', 'status', 'notes'],
  columbia_project: ['product', 'status'],
  unmatched_review: ['source_sheet', 'product', 'status', 'why_flagged'],
  technical: ['product', 'lab', 'year', 'five_ba', 'pnc', 'six_pack_tox', 'eco_tox', 'muta', 'active_notes'],
  formulation: ['product', 'lab', 'year', 'five_ba', 'pnc', 'six_pack_tox', 'eco_tox', 'muta', 'active_notes'],
};

function rowId(table, row) {
  const fields = IDENTITY_FIELDS[table] || Object.keys(row).sort();
  const key = fields.map((f) => String(row[f] ?? '')).join('|');
  return crypto.createHash('sha1').update(table + '::' + key).digest('hex').slice(0, 16);
}

module.exports = { rowId, TABLE_PATHS, IDENTITY_FIELDS, EDITABLE_FIELDS };
