import { db } from '@/lib/db';

export async function GET() {
  if (!db.isConfigured()) {
    return Response.json({ ok: true, storage: 'none',
      message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.' });
  }
  try {
    await db.list();
    return Response.json({ ok: true, storage: 'supabase' });
  } catch (e) {
    return Response.json({ ok: false, storage: 'supabase', error: e.message });
  }
}
