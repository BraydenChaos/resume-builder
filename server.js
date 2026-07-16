#!/usr/bin/env node
/**
 * Resume Builder — Local Server
 *
 * Usage:
 *   node server.js                          # default: ./variants
 *   node server.js --folder ./2025-june     # start with a specific folder
 *   node server.js --folder /abs/path       # absolute path works too
 *
 * The active folder can also be changed live from the UI without restarting.
 * Folders are created automatically if they don't exist.
 *
 * No npm required — pure Node built-ins.
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PORT = 3457;
const ROOT = __dirname;

// Minimal .env loader (zero-dependency). Reads KEY=value lines from ./.env if present.
// Real environment variables always win over .env values.
(function loadDotEnv(){
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || /^\s*#/.test(line)) return;
      let key = m[1], val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    });
    console.log('  Loaded .env');
  } catch (e) { /* ignore malformed .env */ }
})();

// Resumes live in Postgres (resume_builder schema). The variants/*.json files in the
// repo are now just a historical snapshot of the pre-migration data; the app no longer
// reads or writes them.
const { db } = require('./supabase');

// ── Helpers ───────────────────────────────────────────────────────────────────
function send(res, status, body, contentType) {
  contentType = contentType || 'application/json';
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── Resume-editing tools exposed to the chat model ────────────────────────────
// The tools run in the BROWSER (that is where the live document state lives), so
// the server only declares their schemas and forwards them to Anthropic. The
// client executes each call, applies it to the page, and streams tool_results back.
const RESUME_TOOLS = [
  {
    name: 'get_document',
    description: 'Read the current resume as structured data with stable section ids and zero-based job indices. Call this FIRST before any edit so you target the correct ids and see current content. Returns sections (id, label, type, and their content), the header, and the cover letter if one exists.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_summary',
    description: 'Replace the full text of a summary/profile section.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string', description: 'Id of a section whose type is "summary".' },
        text: { type: 'string', description: 'The new summary text.' },
      },
      required: ['section_id', 'text'],
    },
  },
  {
    name: 'update_job',
    description: 'Update one job entry inside a jobs-type section. Only fields you pass are changed. To edit bullets, pass the FULL new bullets array — it replaces every bullet for that job.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        job_index: { type: 'integer', description: 'Zero-based index of the job within the section\'s jobs array.' },
        org: { type: 'string' },
        title: { type: 'string' },
        dates: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' }, description: 'Full replacement list of bullet strings.' },
      },
      required: ['section_id', 'job_index'],
    },
  },
  {
    name: 'set_list_items',
    description: 'Replace all items in a list-type section (e.g. certifications, speaking engagements). Pass the full new list.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
      },
      required: ['section_id', 'items'],
    },
  },
  {
    name: 'set_skill_groups',
    description: 'Replace the skill groups of a skills-type section. Each group has a label (category) and an items string of comma-separated skills.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              items: { type: 'string', description: 'Comma-separated skills.' },
            },
            required: ['label', 'items'],
          },
        },
      },
      required: ['section_id', 'groups'],
    },
  },
  {
    name: 'set_section_visibility',
    description: 'Show or hide a section on the resume. Hidden sections stay in the document but are not printed. This is the key tool for tailoring: drop projects and sections that are not relevant to the target role, and keep the ones that are.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        visible: { type: 'boolean' },
      },
      required: ['section_id', 'visible'],
    },
  },
  {
    name: 'update_header',
    description: 'Update the resume header. Only fields you pass are changed.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        title: { type: 'string', description: 'The tagline shown under the name.' },
      },
    },
  },
  {
    name: 'update_cover_letter',
    description: 'Update the cover letter. Only fields you pass are changed. body is the full ordered list of paragraphs.',
    input_schema: {
      type: 'object',
      properties: {
        salutation: { type: 'string' },
        body: { type: 'array', items: { type: 'string' }, description: 'Full list of paragraphs, in order.' },
        signoff: { type: 'string' },
        signName: { type: 'string' },
      },
    },
  },

  // ── Master tools ──────────────────────────────────────────────────────────
  // The master is the canonical resume every variant draws from. These edit it
  // in the BACKGROUND — they do not change whatever variant the user is viewing.
  {
    name: 'get_master',
    description: 'Read the MASTER resume (the canonical source all variants draw from) as structured data: section ids, types, current content, AND each section\'s private context note. Call this before edit_master or edit_master_context so you target the right section id and can preserve existing context. Master section ids can differ from the current variant\'s, so never assume — read them here.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'edit_master',
    description: 'Edit the MASTER resume\'s content in the background (does not touch the variant the user is viewing). Use this to improve the canonical record of a role or project so all future variants benefit. Pass section_id and only the fields for that section\'s type: summary -> text; a jobs section -> job_index plus any of org/title/dates/bullets (bullets replaces every bullet for that job); list -> items; skills -> groups.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        job_index: { type: 'integer', description: 'Zero-based job index, for jobs sections.' },
        text: { type: 'string' },
        org: { type: 'string' },
        title: { type: 'string' },
        dates: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' } },
        items: { type: 'array', items: { type: 'string' } },
        groups: {
          type: 'array',
          items: { type: 'object', properties: { label: { type: 'string' }, items: { type: 'string' } }, required: ['label', 'items'] },
        },
      },
      required: ['section_id'],
    },
  },
  {
    name: 'edit_master_context',
    description: 'Set the private plain-English CONTEXT note on a MASTER section (never printed on any resume). Use this whenever the user tells you background about a role or project — its real scope, their actual role, results, metrics, who to contact — so future tailoring is better informed. Call get_master first and pass the FULL note you want stored (existing context plus the new detail); this overwrites the section\'s note.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        context: { type: 'string', description: 'The full context note to store for this section.' },
      },
      required: ['section_id', 'context'],
    },
  },
];

// Structured-output schema for the proofread findings. Each finding carries the
// AI's exact replacement text (`suggestion`), so applying a checked finding is a
// direct write — no second AI call, no drift from what the user approved.
const PROOF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: ['technical', 'alignment'],
            description: '"technical" = typos, grammar, inconsistent dates/capitalization, disagreeing metrics, awkward phrasing. "alignment" = how well this resume matches the job description — missing keywords, under-emphasized relevant experience, generic wording that should mirror the JD.' },
          field: { type: 'string',
            enum: ['summary', 'header_name', 'header_title', 'job_org', 'job_title', 'job_dates', 'bullet', 'list_item', 'skill_group_label', 'skill_group_items'],
            description: 'Which field this finding targets.' },
          section_id: { type: 'string', description: 'Section id this finding targets. Empty string for header_name/header_title.' },
          job_index: { type: 'integer', description: 'Required when field is job_org/job_title/job_dates/bullet.' },
          bullet_index: { type: 'integer', description: 'Required when field is bullet.' },
          list_index: { type: 'integer', description: 'Required when field is list_item.' },
          group_index: { type: 'integer', description: 'Required when field is skill_group_label/skill_group_items.' },
          issue: { type: 'string', description: 'One short sentence: what is wrong or misaligned, quoting the offending text.' },
          suggestion: { type: 'string', description: 'The exact full replacement text for this field. This is what gets written if the user approves the finding.' },
        },
        required: ['category', 'field', 'section_id', 'issue', 'suggestion'],
      },
    },
  },
  required: ['findings'],
};

// Structured-output schema for the one-shot JD build. The model returns a tailoring
// PLAN (what to hide, the rewritten summary/title, bullet rewrites) in a single call;
// the client applies it deterministically. No agentic loop, so no transcript re-sends.
const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    visible_ids: {
      type: 'array', items: { type: 'string' },
      description: 'Ids of the sections that should be VISIBLE for this role. Every section id NOT in this list is hidden. Keep the profile/summary and the most relevant experience; drop unrelated projects and roles.',
    },
    summary: {
      type: 'string',
      description: 'Rewritten profile/summary text tailored to the role. Empty string to leave the current summary unchanged.',
    },
    title: {
      type: 'string',
      description: 'Header tagline aligned to the role. Empty string to leave it unchanged.',
    },
    bullets: {
      type: 'array',
      description: 'Bullet rewrites for the most relevant jobs only. Each entry fully replaces that job\'s bullet list. Leave empty to keep all bullets as they are.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section_id: { type: 'string' },
          job_index: { type: 'integer' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['section_id', 'job_index', 'bullets'],
      },
    },
    summary_of_changes: {
      type: 'string',
      description: 'One or two plain sentences describing what you tailored and why.',
    },
  },
  required: ['visible_ids', 'summary', 'title', 'bullets', 'summary_of_changes'],
};

// Replace large tool-result payloads in older turns with a short stub. The big
// ones are get_document / get_master dumps (multiple KB each); once a couple of
// turns have passed they are stale (the live document has moved on) and pure
// weight. Only the last few messages keep their full results, so the model always
// sees fresh detail for the turn it is reasoning about. tool_use_id pairing is
// preserved — only the result's content string is shortened.
function pruneToolResults(history) {
  const KEEP_FULL = 4;          // last N messages keep full tool results
  const STUB_OVER = 400;        // only stub results longer than this
  const cut = history.length - KEEP_FULL;
  if (cut <= 0) return history;
  return history.map((m, i) => {
    if (i >= cut || !Array.isArray(m.content)) return m;
    let changed = false;
    const content = m.content.map(b => {
      if (b && b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > STUB_OVER) {
        changed = true;
        return Object.assign({}, b, { content: '[earlier result omitted to save tokens — call the read tool again if you need current detail]' });
      }
      return b;
    });
    return changed ? Object.assign({}, m, { content }) : m;
  });
}

// ── Request handler ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = req.url.split('?')[0];
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') return send(res, 204, '');

  // ── Serve the HTML file ──────────────────────────────────────────────────
  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    const htmlPath = path.join(ROOT, 'resume_builder.html');
    if (!fs.existsSync(htmlPath)) {
      return send(res, 404, 'resume_builder.html not found', 'text/plain');
    }
    return send(res, 200, fs.readFileSync(htmlPath, 'utf8'), 'text/html; charset=utf-8');
  }

  // Silence the browser's automatic favicon request (avoids a console 404)
  if (method === 'GET' && url === '/favicon.ico') {
    res.writeHead(204); return res.end();
  }

  // ── GET /ping — storage mode + health ────────────────────────────────────
  if (method === 'GET' && url === '/ping') {
    if (!db.isConfigured()) {
      return send(res, 200, { ok: true, storage: 'none',
        message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.' });
    }
    try {
      await db.list();
      return send(res, 200, { ok: true, storage: 'supabase' });
    } catch (e) {
      return send(res, 200, { ok: false, storage: 'supabase', error: e.message });
    }
  }

  // ── GET /documents — variant list for the browser (no heavy jsonb body) ──
  if (method === 'GET' && url === '/documents') {
    try {
      const [variants, master] = await Promise.all([db.list(), db.getByKind('master')]);
      return send(res, 200, { ok: true, variants, master: master ? { id: master.id, name: master.name } : null });
    } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
  }

  // ── Singletons: the master and the rolling autosave ──────────────────────
  const singleton = url.match(/^\/(master|autosave)$/);
  if (singleton) {
    const kind = singleton[1];
    if (method === 'GET') {
      try { return send(res, 200, { ok: true, doc: await db.getByKind(kind) }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if (method === 'PUT') {
      let data;
      try { data = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { ok: false, error: 'Invalid JSON' }); }
      try { return send(res, 200, { ok: true, doc: await db.putSingleton(kind, data) }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
  }

  // ── /documents/:id — load, save, delete a single resume ──────────────────
  const docMatch = url.match(/^\/documents\/([^/]+)$/);
  if (docMatch) {
    const id = decodeURIComponent(docMatch[1]);

    if (method === 'GET') {
      try {
        const doc = await db.get(id);
        if (!doc) return send(res, 404, { ok: false, error: 'Not found' });
        return send(res, 200, { ok: true, doc });
      } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }

    if (method === 'PATCH') {
      let data;
      try { data = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { ok: false, error: 'Invalid JSON' }); }
      try {
        const doc = await db.update(id, data);
        console.log('  Saved:', doc && doc.name);
        return send(res, 200, { ok: true, doc });
      } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }

    if (method === 'DELETE') {
      try { await db.remove(id); console.log('  Deleted:', id); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
  }

  // ── POST /documents — create a new variant (Save as…) ────────────────────
  if (method === 'POST' && url === '/documents') {
    let data;
    try { data = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { ok: false, error: 'Invalid JSON' }); }
    if (!data.name || !String(data.name).trim()) return send(res, 400, { ok: false, error: 'Missing name' });
    try {
      const doc = await db.create(Object.assign({ kind: 'variant' }, data));
      console.log('  Created:', doc.name);
      return send(res, 200, { ok: true, doc });
    } catch (e) {
      // The unique index on lower(name) is the likely culprit — say so plainly.
      const dupe = /duplicate key|already exists/i.test(e.message);
      return send(res, 200, { ok: false, error: dupe ? 'A variant named "' + data.name + '" already exists.' : e.message });
    }
  }

  // ── GET /documents/:id/revisions — snapshot history ──────────────────────
  const revList = url.match(/^\/documents\/([^/]+)\/revisions$/);
  if (method === 'GET' && revList) {
    try { return send(res, 200, { ok: true, revisions: await db.revisions(decodeURIComponent(revList[1])) }); }
    catch (e) { return send(res, 200, { ok: false, error: e.message }); }
  }

  // ── /documents/:id/jd — the job description stored alongside this resume ─
  const jdMatch = url.match(/^\/documents\/([^/]+)\/jd$/);
  if (jdMatch) {
    const docId = decodeURIComponent(jdMatch[1]);
    if (method === 'GET') {
      try { return send(res, 200, { ok: true, jd: await db.getJD(docId) }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if (method === 'PUT') {
      let data;
      try { data = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { ok: false, error: 'Invalid JSON' }); }
      try { await db.upsertJD(docId, String(data.jd_text || '')); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
  }

  // ── POST /revisions/:id/restore — roll a document back ───────────────────
  const revRestore = url.match(/^\/revisions\/([^/]+)\/restore$/);
  if (method === 'POST' && revRestore) {
    try {
      const rev = await db.revision(decodeURIComponent(revRestore[1]));
      if (!rev) return send(res, 404, { ok: false, error: 'Revision not found' });
      const s = rev.snapshot || {};
      // Restoring is itself an update, so the trigger snapshots the current state
      // first. That means a restore is itself undoable.
      const doc = await db.update(rev.document_id,
        Object.assign({}, s.doc || {}, s.margins ? { margins: s.margins } : {}));
      console.log('  Restored:', doc && doc.name);
      return send(res, 200, { ok: true, doc });
    } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
  }

  // ── POST /proofread — one-shot structured proofread (resume + JD together) ──
  // A single, stateless call — same shape as /build. Sends the resume and its
  // stored job description together and gets back a flat list of findings, each
  // carrying its own exact suggested replacement text so Apply can write it
  // directly with no further AI call.
  if (method === 'POST' && url === '/proofread') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch(e) { return send(res, 400, { ok:false, error:'bad_json', message:'Invalid JSON.' }); }

    const doc = data.doc;
    if (!doc || !Array.isArray(doc.sections)) {
      return send(res, 200, { ok:false, error:'empty', message:'Nothing to proofread yet.' });
    }
    const jdText = String(data.jd_text || '').slice(0, 12000);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return send(res, 200, { ok:false, error:'no_key',
        message: 'Proofreading needs an Anthropic API key. Stop the server, set the ANTHROPIC_API_KEY environment variable (Windows: set ANTHROPIC_API_KEY=sk-ant-...   then  node server.js), and reload this page.' });
    }

    const system =
      'You are a meticulous resume reviewer. Review the resume document (JSON, with stable section ids) below and report real issues as a flat list of findings. ' +
      'Two categories only: "technical" (typos, grammar, inconsistent dates or capitalization, metrics that disagree, awkward or weak phrasing) and "alignment" (' +
      (jdText ? 'how well the resume matches the job description below — missing keywords, under-emphasized relevant experience, generic wording that should mirror the JD' : 'no job description was provided, so skip this category entirely — return only technical findings') +
      '). Be specific: quote or reference the exact offending text in `issue`. Every finding must include the FULL exact replacement text in `suggestion` — not a description of the fix, the actual corrected text for that field. Do not invent problems; if something is already good, do not report it. Never use em-dashes.';
    const userContent = 'RESUME DOCUMENT (JSON):\n' + JSON.stringify(doc) + (jdText ? '\n\nJOB DESCRIPTION:\n' + jdText : '\n\n(No job description provided — technical findings only.)');

    const model = process.env.ANTHROPIC_CHAT_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
    const payload = JSON.stringify({
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: system }],
      messages: [{ role: 'user', content: userContent }],
      output_config: { format: { type: 'json_schema', schema: PROOF_SCHEMA } },
    });

    const https = require('https');
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(payload) },
    };
    return new Promise((resolve) => {
      const areq = https.request(opts, (ares) => {
        let chunks = '';
        ares.on('data', c => { chunks += c; });
        ares.on('end', () => {
          if (ares.statusCode === 429) {
            const retryAfter = parseInt(ares.headers['retry-after'], 10);
            return resolve(send(res, 200, { ok:false, error:'rate_limit', message:'Rate limited.', retryAfter: retryAfter > 0 ? retryAfter : 30 }));
          }
          try {
            const j = JSON.parse(chunks);
            if (j.error) { resolve(send(res, 200, { ok:false, error:'api', message: (j.error.message || 'Anthropic API error.') })); return; }
            const textBlock = (j.content || []).find(b => b.type === 'text') || {};
            let parsed;
            try { parsed = JSON.parse(textBlock.text || ''); }
            catch(e) { return resolve(send(res, 200, { ok:false, error:'parse', message:'The model did not return valid findings.' })); }
            const u = j.usage || {};
            console.log('  Proofread: in=' + (u.input_tokens || 0) + ' cacheRead=' + (u.cache_read_input_tokens || 0) +
                        ' out=' + (u.output_tokens || 0) + '  |  ' + ((parsed.findings || []).length) + ' findings');
            resolve(send(res, 200, { ok:true, findings: parsed.findings || [], usage: u }));
          } catch(e) {
            resolve(send(res, 200, { ok:false, error:'parse', message:'Could not parse the API response.' }));
          }
        });
      });
      areq.on('error', (e) => { resolve(send(res, 200, { ok:false, error:'network', message: String((e && e.message) || e) })); });
      areq.write(payload);
      areq.end();
    });
  }

  // ── POST /build — one-shot JD tailoring via structured outputs ───────────
  // A single API call: send the document + JD, get back a tailoring plan. No loop,
  // no transcript re-sending — this is the fix for the build's runaway token use.
  if (method === 'POST' && url === '/build') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch(e) { return send(res, 400, { ok:false, error:'bad_json' }); }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return send(res, 200, { ok:false, error:'no_key', message:'Building needs an Anthropic API key (ANTHROPIC_API_KEY).' });

    const doc = data.doc;
    const jd = String(data.jd || '').slice(0, 12000);
    if (!doc || !Array.isArray(doc.sections) || !jd.trim()) {
      return send(res, 200, { ok:false, error:'bad_input', message:'Need a document and a job description.' });
    }

    const system =
      'You are a resume-tailoring engine. Given a resume document (JSON, with stable section ids) and a job description, produce a tailoring PLAN as structured JSON. ' +
      'Decide which sections stay visible (relevant to the target role) and which are hidden; rewrite the profile/summary and the header tagline to match the role; rewrite the bullets of the most relevant jobs to emphasize fit. ' +
      'Stay strictly truthful — never invent experience, employers, titles, or metrics; only reshape and re-emphasize what is already there. Keep language tight and specific. Never use em-dashes.';
    const userContent = 'JOB DESCRIPTION:\n' + jd + '\n\nRESUME DOCUMENT (JSON):\n' + JSON.stringify(doc);

    const model = process.env.ANTHROPIC_CHAT_MODEL || 'claude-opus-4-8';
    const payload = JSON.stringify({
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: system }],
      messages: [{ role: 'user', content: userContent }],
      output_config: { format: { type: 'json_schema', schema: BUILD_SCHEMA } },
    });

    const https = require('https');
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(payload) },
    };
    return new Promise((resolve) => {
      const areq = https.request(opts, (ares) => {
        let chunks = '';
        ares.on('data', c => { chunks += c; });
        ares.on('end', () => {
          if (ares.statusCode === 429) {
            const retryAfter = parseInt(ares.headers['retry-after'], 10);
            return resolve(send(res, 200, { ok:false, error:'rate_limit', message:'Rate limited.', retryAfter: retryAfter > 0 ? retryAfter : 30 }));
          }
          try {
            const j = JSON.parse(chunks);
            if (j.error) return resolve(send(res, 200, { ok:false, error:'api', message: j.error.message || 'Anthropic API error.' }));
            const textBlock = (j.content || []).find(b => b.type === 'text') || {};
            let plan;
            try { plan = JSON.parse(textBlock.text || ''); }
            catch(e) { return resolve(send(res, 200, { ok:false, error:'parse', message:'The model did not return a valid plan.' })); }
            const u = j.usage || {};
            const hidden = (doc.sections.length) - (plan.visible_ids || []).length;
            console.log('  Build: in=' + (u.input_tokens || 0) + ' cacheRead=' + (u.cache_read_input_tokens || 0) +
                        ' out=' + (u.output_tokens || 0) + '  |  ' + (plan.visible_ids || []).length + ' shown / ' +
                        (hidden < 0 ? 0 : hidden) + ' hidden, ' + ((plan.bullets || []).length) + ' bullet rewrites');
            resolve(send(res, 200, { ok:true, plan, usage: u }));
          } catch(e) {
            resolve(send(res, 200, { ok:false, error:'parse', message:'Could not parse the API response.' }));
          }
        });
      });
      areq.on('error', (e) => resolve(send(res, 200, { ok:false, error:'network', message: String((e && e.message) || e) })));
      areq.write(payload);
      areq.end();
    });
  }

  // ── POST /chat — streaming AI chat via Anthropic API (SSE passthrough) ───
  if (method === 'POST' && url === '/chat') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch(e) { return send(res, 400, { ok:false, error:'bad_json' }); }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return send(res, 200, { ok:false, error:'no_key',
        message: 'Chat needs an Anthropic API key. Set ANTHROPIC_API_KEY in .env or the environment and restart the server.' });
    }

    // Content may be a string (plain turn) or an array of blocks (assistant
    // tool_use turns, and user tool_result turns from the client-side loop).
    let history = (Array.isArray(data.messages) ? data.messages : []).filter(m => {
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) return false;
      if (typeof m.content === 'string') return m.content.trim().length > 0;
      return Array.isArray(m.content) && m.content.length > 0;
    }).slice(-60);
    if (!history.length) return send(res, 400, { ok:false, error:'no_messages' });

    // ── Token diet ────────────────────────────────────────────────────────────
    // A JD build fires ~16 tool-loop turns back to back. Anything re-sent every
    // turn multiplies by that. Two things used to dominate the input tokens:
    //   1. the entire resume, embedded in the system prompt on EVERY request;
    //   2. big get_document / get_master tool results, replayed in full each turn.
    // Fix (1) by moving the frozen instructions into a cacheable system block and
    // never inlining the resume — the model reads it via get_document instead. Fix
    // (2) by stubbing large tool-result payloads from all but the last couple of
    // turns; the live document already reflects those edits, and the model can call
    // the read tool again if it needs fresh detail.
    history = pruneToolResults(history);

    // Frozen instructions — identical on every request, so it (plus the tool
    // schemas that render before it) caches and is re-read at ~0.1x on each
    // continuation instead of re-billed in full.
    const SYSTEM_PROMPT =
      'You are a resume and career assistant embedded in a resume builder app. ' +
      'You help the user tailor their resume and cover letter to specific roles: sharpening bullets, quantifying impact, adjusting positioning, and giving honest feedback. ' +
      'You can edit the document DIRECTLY with the provided tools. When the user asks for a change, MAKE it with the tools rather than only describing it. ' +
      'You do NOT have the document inline — always call get_document first to get exact section ids and current content before editing or giving specific feedback. ' +
      'Make the smallest edit that satisfies the request; never rewrite sections the user did not ask about. After editing, confirm what you changed in one short line. ' +
      'When the user only asks a question or wants advice, just answer — do not edit. ' +
      'To tailor a resume to a specific role, use set_section_visibility to hide the projects and sections that are not relevant and keep the ones that are, then sharpen the summary and the most relevant bullets and align the header title. ' +
      'The MASTER is the canonical resume every variant draws from. When the user shares background about a role or project (its real scope, their actual role, results, metrics, context) rather than requesting a specific edit to the visible resume, quietly record it on the master with edit_master_context so future tailoring benefits — call get_master first to see the section ids and existing notes, and append to what is already there. Use edit_master to improve the master\'s actual content when a change should apply to every future variant, not just this one. These master tools work in the background and do not alter the variant the user is viewing. ' +
      'Be concise — this renders in a narrow side panel. Use short paragraphs and bullets. Never use em-dashes.';

    const system = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
    // Optional lightweight outline (section ids/labels/types, no full content),
    // sent by the client only on the first turn of a request. It sits AFTER the
    // cache breakpoint so it never invalidates the cached prefix, and gives the
    // model orientation so simple questions don't always need a get_document call.
    const outline = String(data.outline || '').slice(0, 4000);
    if (outline) system.push({ type: 'text', text: 'Outline of the document currently on screen (ids and headings only — call get_document for full content):\n' + outline });

    const model = process.env.ANTHROPIC_CHAT_MODEL || 'claude-opus-4-8';
    // Extended thinking is intentionally off: preserving signed thinking blocks
    // through a client-driven tool loop is fragile, and these edits don't need it.
    const payload = JSON.stringify({
      model,
      max_tokens: 8192,
      stream: true,
      system,
      tools: RESUME_TOOLS,
      messages: history.map(m => ({ role: m.role, content: m.content })),
    });

    const https = require('https');
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-length': Buffer.byteLength(payload)
      }
    };
    return new Promise((resolve) => {
      const areq = https.request(opts, (ares) => {
        if (ares.statusCode !== 200) {
          // Non-streaming error body — collect and forward as JSON
          let chunks = '';
          ares.on('data', c => { chunks += c; });
          ares.on('end', () => {
            let msg = 'Anthropic API error (' + ares.statusCode + ').';
            try { const j = JSON.parse(chunks); if (j.error && j.error.message) msg = j.error.message; } catch(e) {}
            // Surface rate limits distinctly with the server's retry-after hint so
            // the client can wait and resume the loop instead of failing the build.
            const rateLimited = ares.statusCode === 429;
            const retryAfter = parseInt(ares.headers['retry-after'], 10);
            resolve(send(res, 200, {
              ok: false,
              error: rateLimited ? 'rate_limit' : 'api',
              message: msg,
              retryAfter: (rateLimited && retryAfter > 0) ? retryAfter : (rateLimited ? 30 : undefined),
            }));
          });
          return;
        }
        // Pipe the SSE stream straight through to the browser, teeing off the
        // usage numbers so every chat turn's token cost is logged server-side.
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        let logBuf = '', usage = {};
        ares.on('data', c => {
          res.write(c);
          logBuf += c.toString();
          const lines = logBuf.split('\n');
          logBuf = lines.pop();
          lines.forEach(line => {
            if (line.indexOf('data:') !== 0) return;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              if (ev.type === 'message_start' && ev.message && ev.message.usage) Object.assign(usage, ev.message.usage);
              if (ev.type === 'message_delta' && ev.usage && ev.usage.output_tokens != null) usage.output_tokens = ev.usage.output_tokens;
            } catch(e) {}
          });
        });
        ares.on('end', () => {
          const turns = history.length;
          console.log('  Chat turn: in=' + (usage.input_tokens || 0) + ' cacheRead=' + (usage.cache_read_input_tokens || 0) +
                      ' cacheWrite=' + (usage.cache_creation_input_tokens || 0) + ' out=' + (usage.output_tokens || 0) +
                      '  (' + turns + ' msgs in history)');
          res.end(); resolve();
        });
        ares.on('error', () => { res.end(); resolve(); });
      });
      areq.on('error', (e) => { resolve(send(res, 200, { ok:false, error:'network', message: String((e && e.message) || e) })); });
      areq.write(payload);
      areq.end();
    });
  }

  return send(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', async () => {
  let storage = 'NOT CONFIGURED — see .env.example';
  if (db.isConfigured()) {
    try {
      const rows = await db.list();
      storage = 'Supabase (' + rows.length + ' variants)';
    } catch (e) {
      storage = 'Supabase ERROR';
      console.log('\n  Supabase is configured but unreachable:\n    ' + e.message);
    }
  }
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────┐');
  console.log('  │  Resume Builder                                  │');
  console.log('  │                                                  │');
  console.log(`  │  URL:      http://localhost:${PORT}                  │`);
  console.log(`  │  Storage:  ${storage.slice(0, 38).padEnd(38)}│`);
  console.log('  │                                                  │');
  console.log('  │  Ctrl+C to stop                                  │');
  console.log('  └──────────────────────────────────────────────────┘');
  console.log('');
});
