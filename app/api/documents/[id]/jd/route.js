import { db } from '@/lib/db';

// GET /api/documents/:id/jd — the job description stored alongside this document
export async function GET(req, { params }) {
  const { id } = await params;
  try {
    const jd = await db.getJD(decodeURIComponent(id));
    return Response.json({ ok: true, jd });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}

// PUT /api/documents/:id/jd — upsert it
export async function PUT(req, { params }) {
  const { id } = await params;
  let data;
  try { data = await req.json(); } catch (e) { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  try {
    await db.upsertJD(decodeURIComponent(id), String(data.jd_text || ''));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}
