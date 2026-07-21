/**
 * Minimal Supabase REST client — talks to PostgREST directly with fetch, using the
 * service_role key, so it bypasses RLS. This file only ever runs on the server
 * (route handlers) — the key must never reach the browser.
 *
 * Requires in .env.local:
 *   SUPABASE_URL=https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key>
 *
 * Also requires the `resume_builder` schema to be listed under
 * Dashboard -> Project Settings -> API -> Exposed schemas.
 */

const SCHEMA = 'resume_builder';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key };
}

function isConfigured() { return config() !== null; }

/**
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} method
 * @param {string} pathAndQuery e.g. "documents?kind=eq.variant&order=updated_at.desc"
 * @param {object} [body]
 * @param {object} [extraHeaders] e.g. { Prefer: 'return=representation' }
 */
async function rest(method, pathAndQuery, body, extraHeaders) {
  const cfg = config();
  if (!cfg) throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');

  const headers = Object.assign({
    apikey: cfg.key,
    authorization: 'Bearer ' + cfg.key,
    accept: 'application/json',
    'accept-profile': SCHEMA,   // schema for reads
    'content-profile': SCHEMA,  // schema for writes
  }, extraHeaders || {});
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(cfg.url + '/rest/v1/' + pathAndQuery, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  if (!res.ok) {
    let msg = 'Supabase ' + res.status;
    try {
      const j = JSON.parse(raw);
      msg = j.message || j.hint || msg;
      if (/schema must be one of/i.test(msg) || res.status === 406) {
        msg += ' — add "' + SCHEMA + '" to Exposed schemas in Supabase Dashboard > Project Settings > API.';
      }
    } catch (_) { if (raw) msg += ': ' + raw.slice(0, 300); }
    throw new Error(msg);
  }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return raw; }
}

// ── Document shape mapping ────────────────────────────────────────────────────
// The row carries queryable metadata plus one `doc` column holding the app's
// snapshot verbatim. The snapshot is a union type (master / standalone / linked),
// so it is passed straight through rather than destructured into columns.
//
// Wire shape: { id, name, kind, company, role, ...metadata, ...snapshotFields }
// The snapshot is spread to the top level so applyState() on the client — which
// expects a bare snapshot — keeps working untouched.

const META_KEYS = ['id', 'name', 'kind', 'company', 'role', 'status', 'appliedOn',
                   'linkedToMaster', 'margins', 'createdAt', 'updatedAt'];

function rowToDoc(row) {
  if (!row) return null;
  const meta = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    company: row.company,
    role: row.role,
    status: row.status,
    appliedOn: row.applied_on,
    linkedToMaster: row.linked_to_master,
    margins: row.margins,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  // Snapshot fields (items/header/coverLetter/notes/base/overrides/...) sit alongside.
  return Object.assign(meta, row.doc || {});
}

function docToRow(doc) {
  const row = {};
  if (doc.name !== undefined) row.name = doc.name;
  if (doc.kind !== undefined) row.kind = doc.kind;
  if (doc.company !== undefined) row.company = doc.company;
  if (doc.role !== undefined) row.role = doc.role;
  if (doc.status !== undefined) row.status = doc.status;
  if (doc.appliedOn !== undefined) row.applied_on = doc.appliedOn;
  if (doc.margins !== undefined) row.margins = doc.margins;
  // linked_to_master is a generated column — never written directly.

  // Everything that isn't metadata is the snapshot body.
  const body = {};
  Object.keys(doc).forEach((k) => { if (!META_KEYS.includes(k)) body[k] = doc[k]; });
  if (Object.keys(body).length) row.doc = body;

  return row;
}

// Columns for the variant browser. Deliberately excludes the heavy `doc` body so
// listing 50 variants doesn't drag megabytes of resume text across the wire.
const LIST_COLS = 'id,name,kind,company,role,status,applied_on,linked_to_master,updated_at,created_at';

export const db = {
  isConfigured,
  rowToDoc,
  docToRow,

  async list() {
    const rows = await rest('GET', 'documents?select=' + LIST_COLS + '&kind=eq.variant&order=updated_at.desc');
    return (rows || []).map(rowToDoc);
  },

  async get(id) {
    const rows = await rest('GET', 'documents?select=*&id=eq.' + encodeURIComponent(id) + '&limit=1');
    return rowToDoc((rows || [])[0]);
  },

  // The master and autosave rows are singletons, addressed by kind rather than id.
  async getByKind(kind) {
    const rows = await rest('GET', 'documents?select=*&kind=eq.' + encodeURIComponent(kind) + '&limit=1');
    return rowToDoc((rows || [])[0]);
  },

  async create(doc) {
    const rows = await rest('POST', 'documents', [docToRow(doc)], { Prefer: 'return=representation' });
    return rowToDoc((rows || [])[0]);
  },

  async update(id, doc) {
    const rows = await rest('PATCH', 'documents?id=eq.' + encodeURIComponent(id), docToRow(doc), { Prefer: 'return=representation' });
    return rowToDoc((rows || [])[0]);
  },

  async remove(id) {
    await rest('DELETE', 'documents?id=eq.' + encodeURIComponent(id));
    return true;
  },

  // Upsert the singleton row for a kind ('master' | 'autosave'), creating it on first write.
  async putSingleton(kind, doc) {
    const existing = await db.getByKind(kind);
    if (existing) return db.update(existing.id, doc);
    return db.create(Object.assign({}, doc, { kind, name: kind === 'master' ? 'Master' : 'Autosave' }));
  },

  async revisions(documentId, limit) {
    const rows = await rest('GET',
      'revisions?select=id,created_at,note&document_id=eq.' + encodeURIComponent(documentId) +
      '&order=created_at.desc&limit=' + (limit || 25));
    return rows || [];
  },

  async revision(id) {
    const rows = await rest('GET', 'revisions?select=*&id=eq.' + encodeURIComponent(id) + '&limit=1');
    return (rows || [])[0] || null;
  },

  // Job description stored alongside one document. 1:1 — upsert on the unique
  // document_id constraint, no separate create/update call needed from the caller.
  async getJD(documentId) {
    const rows = await rest('GET', 'job_descriptions?select=jd_text,updated_at&document_id=eq.' + encodeURIComponent(documentId) + '&limit=1');
    return (rows || [])[0] || null;
  },

  async upsertJD(documentId, jdText) {
    const existing = await db.getJD(documentId);
    if (existing) {
      await rest('PATCH', 'job_descriptions?document_id=eq.' + encodeURIComponent(documentId), { jd_text: jdText });
    } else {
      await rest('POST', 'job_descriptions', [{ document_id: documentId, jd_text: jdText }]);
    }
    return true;
  },
};

export { rest, isConfigured, SCHEMA };
