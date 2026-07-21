import { db } from '@/lib/db';

// GET /api/documents/:id/revisions — snapshot history
export async function GET(req, { params }) {
  const { id } = await params;
  try {
    const revisions = await db.revisions(decodeURIComponent(id));
    return Response.json({ ok: true, revisions });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}
