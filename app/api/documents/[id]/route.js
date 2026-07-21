import { db } from '@/lib/db';

// GET /api/documents/:id — load a single resume
export async function GET(req, { params }) {
  const { id } = await params;
  try {
    const doc = await db.get(decodeURIComponent(id));
    if (!doc) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
    return Response.json({ ok: true, doc });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}

// PATCH /api/documents/:id — save
export async function PATCH(req, { params }) {
  const { id } = await params;
  let data;
  try { data = await req.json(); } catch (e) { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  try {
    const doc = await db.update(decodeURIComponent(id), data);
    return Response.json({ ok: true, doc });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}

// DELETE /api/documents/:id
export async function DELETE(req, { params }) {
  const { id } = await params;
  try {
    await db.remove(decodeURIComponent(id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}
