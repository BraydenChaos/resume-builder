import { db } from '@/lib/db';

export async function GET() {
  try { return Response.json({ ok: true, doc: await db.getByKind('autosave') }); }
  catch (e) { return Response.json({ ok: false, error: e.message }); }
}

export async function PUT(req) {
  let data;
  try { data = await req.json(); } catch (e) { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  try { return Response.json({ ok: true, doc: await db.putSingleton('autosave', data) }); }
  catch (e) { return Response.json({ ok: false, error: e.message }); }
}
