import { db } from '@/lib/db';

// POST /api/revisions/:id/restore — roll a document back to an earlier snapshot.
// Restoring is itself an update, so the DB trigger snapshots the current state
// first — meaning a restore is itself undoable.
export async function POST(req, { params }) {
  const { id } = await params;
  try {
    const rev = await db.revision(decodeURIComponent(id));
    if (!rev) return Response.json({ ok: false, error: 'Revision not found' }, { status: 404 });
    const s = rev.snapshot || {};
    const doc = await db.update(rev.document_id, Object.assign({}, s.doc || {}, s.margins ? { margins: s.margins } : {}));
    return Response.json({ ok: true, doc });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}
