import { db } from '@/lib/db';

// GET /api/documents — variant list for the browser (no heavy jsonb body) + master pointer
export async function GET() {
  try {
    const [variants, master] = await Promise.all([db.list(), db.getByKind('master')]);
    return Response.json({ ok: true, variants, master: master ? { id: master.id, name: master.name } : null });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}

// POST /api/documents — create a new variant (Save as…)
export async function POST(req) {
  let data;
  try { data = await req.json(); } catch (e) { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  if (!data.name || !String(data.name).trim()) return Response.json({ ok: false, error: 'Missing name' }, { status: 400 });
  try {
    const doc = await db.create(Object.assign({ kind: 'variant' }, data));
    return Response.json({ ok: true, doc });
  } catch (e) {
    const dupe = /duplicate key|already exists/i.test(e.message);
    return Response.json({ ok: false, error: dupe ? 'A variant named "' + data.name + '" already exists.' : e.message });
  }
}
