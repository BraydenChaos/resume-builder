#!/usr/bin/env node
/**
 * One-time migration: variants/*.json  ->  Supabase (resume_builder.documents)
 *
 *   node migrate-to-supabase.js            # dry run, shows what it would do
 *   node migrate-to-supabase.js --commit   # actually write
 *
 * Safe to re-run: it matches on name and updates rather than duplicating.
 * Your JSON files are never modified or deleted — they stay as a git-tracked backup.
 */

const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;

// Reuse the server's .env loader semantics.
(function loadDotEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      if (/^\s*#/.test(line)) return;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) return;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    });
  } catch (_) {}
})();

const { db, rest } = require('./supabase');

const COMMIT = process.argv.includes('--commit');
const DIR = path.join(ROOT, 'variants');

// Company/role for the files that exist today. A naive "first word is the company"
// split gets multi-word names wrong (Booz Allen, Dash Social, POD Marketing), so the
// known set is mapped explicitly. Anything new just lands with no company/role, which
// you can fill in from the variant browser.
const META = {
  'Booz Allen XR Developer':             ['Booz Allen',    'XR Developer'],
  'Dash Social Sr Product Manager':      ['Dash Social',   'Sr Product Manager'],
  'Forge GTM Lead Specialist':           ['Forge',         'GTM Lead Specialist'],
  'Google XR Enterprise Platform PM':    ['Google',        'XR Enterprise Platform PM'],
  'Intangible Product UX Designer':      ['Intangible',    'Product UX Designer'],
  'Netflix Eyeline RnD Engineer':        ['Netflix',       'Eyeline R&D Engineer'],
  'OceanX AI Immersive Technologist':    ['OceanX',        'AI Immersive Technologist'],
  'PaintScout Head of Marketing':        ['PaintScout',    'Head of Marketing'],
  'POD Marketing Digital Strategist':    ['POD Marketing', 'Digital Strategist'],
  'Sample Growth Marketing Lead':        [null,            'Growth Marketing Lead'],
  'UCS Strategic Communications Officer':['UCS',           'Strategic Communications Officer'],
  'UFA Product Owner':                   ['UFA',           'Product Owner'],
};

function classify(base) {
  if (base === '_master')     return { kind: 'master',   name: 'Master',   company: null, role: null };
  if (base === '__autosave__') return { kind: 'autosave', name: 'Autosave', company: null, role: null };
  const [company, role] = META[base] || [null, null];
  return { kind: 'variant', name: base, company, role };
}

(async () => {
  if (!db.isConfigured()) {
    console.error('\n  Supabase is not configured.');
    console.error('  Add these to .env, then re-run:\n');
    console.error('    SUPABASE_URL=https://hdzflottfwtqfkvmwsnw.supabase.co');
    console.error('    SUPABASE_SERVICE_ROLE_KEY=<service_role key from Dashboard > Settings > API>\n');
    process.exit(1);
  }

  if (!fs.existsSync(DIR)) {
    console.error('  No variants/ folder found at', DIR);
    process.exit(1);
  }

  // Fail fast and loud if the schema isn't exposed — otherwise every write 404s confusingly.
  try {
    await rest('GET', 'documents?select=id&limit=1');
  } catch (e) {
    console.error('\n  Could not reach resume_builder.documents:\n    ' + e.message + '\n');
    process.exit(1);
  }

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  console.log('\n  ' + (COMMIT ? 'Migrating' : 'DRY RUN — would migrate') + ' ' + files.length + ' file(s) from variants/\n');

  // Existing rows by lowercased name, so a re-run updates instead of duplicating.
  const existing = new Map();
  const all = await rest('GET', 'documents?select=id,name,kind');
  (all || []).forEach((r) => existing.set(r.kind + ':' + r.name.toLowerCase(), r.id));

  let created = 0, updated = 0, failed = 0;

  for (const f of files) {
    const base = f.replace(/\.json$/, '');
    const meta = classify(base);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    } catch (e) {
      console.log('  ✗ ' + f + '  (invalid JSON, skipped)');
      failed++;
      continue;
    }

    // The file IS the snapshot. Pass it through verbatim (it may be a linked
    // variant with no items array at all) and only add metadata around it.
    const doc = Object.assign({}, raw, {
      name: meta.name,
      kind: meta.kind,
      company: meta.company,
      role: meta.role,
    });

    const hit = existing.get(meta.kind + ':' + meta.name.toLowerCase());
    const shape = raw.base === 'master' ? 'linked to master'
                : ((raw.items || []).length + ' items');
    const label = '  ' + (hit ? '~' : '+') + ' ' + meta.name.padEnd(38) +
                  meta.kind.padEnd(9) + shape +
                  (raw.coverLetter ? ', cover letter' : '');

    if (!COMMIT) { console.log(label); hit ? updated++ : created++; continue; }

    try {
      if (hit) { await db.update(hit, doc); updated++; }
      else     { await db.create(doc);      created++; }
      console.log(label);
    } catch (e) {
      console.log('  ✗ ' + meta.name + ' — ' + e.message);
      failed++;
    }
  }

  console.log('\n  created: ' + created + '   updated: ' + updated + (failed ? '   failed: ' + failed : ''));
  if (!COMMIT) console.log('\n  Nothing was written. Re-run with --commit to apply.\n');
  else console.log('\n  Done. Your JSON files are untouched and still in variants/.\n');
})();
