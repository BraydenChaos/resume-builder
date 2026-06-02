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
const { exec } = require('child_process');

const PORT = 3457;
const ROOT = __dirname;

// ── Parse CLI args ────────────────────────────────────────────────────────────
let defaultFolder = 'variants';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--folder' || args[i] === '-f') && args[i + 1]) {
    defaultFolder = args[i + 1];
    i++;
  }
}

// Active folder — can be changed via API without restart
let activeFolder = path.resolve(ROOT, defaultFolder);

function ensureFolder(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    console.log('  Created folder:', p);
  }
}

ensureFolder(activeFolder);

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9 \-_.]/g, '').trim();
}

function variantPath(name) {
  return path.join(activeFolder, safeName(name) + '.json');
}

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

function listFolderContents(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs.readdirSync(folderPath)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort();
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

  // ── GET /ping — returns current folder info ──────────────────────────────
  if (method === 'GET' && url === '/ping') {
    return send(res, 200, {
      ok: true,
      folder: activeFolder,
      folderName: path.relative(ROOT, activeFolder) || path.basename(activeFolder)
    });
  }

  // ── GET /folder — get active folder ─────────────────────────────────────
  if (method === 'GET' && url === '/folder') {
    return send(res, 200, {
      folder: activeFolder,
      folderName: path.relative(ROOT, activeFolder) || path.basename(activeFolder),
      variants: listFolderContents(activeFolder)
    });
  }

  // ── GET /pick-folder — open native folder picker dialog ─────────────
  if (method === 'GET' && url === '/pick-folder') {
    const ps = `$s=New-Object -ComObject Shell.Application;$f=$s.BrowseForFolder(0,'Select variants folder',16384);if($f){$f.Self.Path}`;
    return new Promise((resolve) => {
      exec(`powershell -NoProfile -NonInteractive -Command "${ps}"`, (err, stdout) => {
        const picked = stdout.trim();
        if (err || !picked) { resolve(send(res, 200, { cancelled: true })); return; }
        resolve(send(res, 200, { folder: picked }));
      });
    });
  }

  // ── PUT /folder — switch active folder ──────────────────────────────────
  if (method === 'PUT' && url === '/folder') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch(e) { return send(res, 400, { error: 'Invalid JSON' }); }
    if (!data.folder) return send(res, 400, { error: 'Missing folder' });

    // Resolve relative to ROOT (server file location)
    const newFolder = path.resolve(ROOT, data.folder);

    // Safety: must be within ROOT or an absolute path the user explicitly typed
    ensureFolder(newFolder);
    activeFolder = newFolder;

    const folderName = path.relative(ROOT, activeFolder) || path.basename(activeFolder);
    console.log('  Switched folder →', activeFolder);
    return send(res, 200, {
      ok: true,
      folder: activeFolder,
      folderName: folderName,
      variants: listFolderContents(activeFolder)
    });
  }

  // ── GET /variants — list variants in active folder ───────────────────────
  if (method === 'GET' && url === '/variants') {
    return send(res, 200, {
      variants: listFolderContents(activeFolder),
      folder: activeFolder,
      folderName: path.relative(ROOT, activeFolder) || path.basename(activeFolder)
    });
  }

  // ── GET /variants/:name — load a variant ────────────────────────────────
  const nameMatch = url.match(/^\/variants\/(.+)$/);
  if (nameMatch) {
    const name = decodeURIComponent(nameMatch[1]);

    if (method === 'GET') {
      const fp = variantPath(name);
      if (!fs.existsSync(fp)) return send(res, 404, { error: 'Not found' });
      return send(res, 200, fs.readFileSync(fp, 'utf8'), 'application/json');
    }

    if (method === 'POST') {
      const safe = safeName(name);
      if (!safe) return send(res, 400, { error: 'Invalid name' });
      const body = await readBody(req);
      try { JSON.parse(body); } catch(e) { return send(res, 400, { error: 'Invalid JSON' }); }
      fs.writeFileSync(variantPath(name), body, 'utf8');
      console.log('  Saved:', path.join(path.relative(ROOT, activeFolder), safe + '.json'));
      return send(res, 200, { ok: true, name: safe });
    }

    if (method === 'DELETE') {
      const fp = variantPath(name);
      if (!fs.existsSync(fp)) return send(res, 404, { error: 'Not found' });
      fs.unlinkSync(fp);
      console.log('  Deleted:', path.join(path.relative(ROOT, activeFolder), safeName(name) + '.json'));
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  const folderDisplay = path.relative(ROOT, activeFolder) || activeFolder;
  console.log('');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log('  │  Resume Builder                             │');
  console.log('  │                                             │');
  console.log(`  │  URL:    http://localhost:${PORT}             │`);
  console.log(`  │  Folder: ${folderDisplay.padEnd(35)}│`);
  console.log('  │                                             │');
  console.log('  │  Ctrl+C to stop                            │');
  console.log('  └─────────────────────────────────────────────┘');
  console.log('');
});
