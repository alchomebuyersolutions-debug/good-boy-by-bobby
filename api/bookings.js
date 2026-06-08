// ============================================================================
//  Good Boy by Bobby — bookings API  (zero-dependency Vercel serverless function)
//  GET  /api/bookings   -> { bookings: [lead, ...] }   (newest first)
//  POST /api/bookings   -> { ok: true }                (stores + emails Bobby)
//
//  Persistence: Upstash Redis over its REST API.
//  Notifications: Resend over its REST API.
//  Both are optional — when their env vars are absent the function still works
//  (falling back to per-instance memory) so the site deploys before keys exist.
//
//  Env vars (set in Vercel project settings or `vercel env add`):
//    UPSTASH_REDIS_REST_URL     Upstash database REST URL
//    UPSTASH_REDIS_REST_TOKEN   Upstash database REST token
//    RESEND_API_KEY             Resend API key (re_...)
//    BOBBY_EMAIL                where booking alerts are sent
//    FROM_EMAIL                 verified sender, e.g. "Good Boy <book@yourdomain>"
//                               (defaults to Resend's onboarding sender)
// ============================================================================

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const BOBBY_EMAIL = process.env.BOBBY_EMAIL;
const FROM_EMAIL  = process.env.FROM_EMAIL || 'Good Boy by Bobby <onboarding@resend.dev>';

const KEY = 'gbb:bookings';
const MAX = 500; // keep the list bounded

// per-instance fallback so things work with no Redis configured (ephemeral)
globalThis.__gbbMem = globalThis.__gbbMem || [];

async function redis(command) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error('redis ' + res.status);
  const data = await res.json();
  return data.result;
}

async function listBookings() {
  const raw = await redis(['LRANGE', KEY, '0', '-1']);
  if (raw === null) return globalThis.__gbbMem;
  return raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

async function addBooking(lead) {
  const stored = await redis(['LPUSH', KEY, JSON.stringify(lead)]);
  if (stored === null) { globalThis.__gbbMem.unshift(lead); return; }
  await redis(['LTRIM', KEY, '0', String(MAX - 1)]).catch(() => {});
}

async function emailBobby(lead) {
  if (!RESEND_KEY || !BOBBY_EMAIL) return;
  const row = (k, v) => `<tr><td style="padding:4px 14px 4px 0;color:#4A5F62;font:600 13px sans-serif">${k}</td><td style="padding:4px 0;color:#15282D;font:600 14px sans-serif">${v}</td></tr>`;
  const esc = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const html = `
    <div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#2C484D;margin:0 0 4px">🐾 New booking request</h2>
      <p style="color:#4A5F62;margin:0 0 16px">Someone just booked an intro call on the website.</p>
      <table style="border-collapse:collapse">
        ${row('Dog', esc(lead.dog))}
        ${row('Owner', esc(lead.name))}
        ${row('Phone', esc(lead.phone))}
        ${row('Requested', esc(lead.dateNice) + ' · ' + esc(lead.session) + ' session')}
        ${lead.notes ? row('Notes', esc(lead.notes)) : ''}
      </table>
      <p style="color:#4A5F62;margin:18px 0 0;font-size:13px">Open the dashboard to confirm or decline.</p>
    </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [BOBBY_EMAIL],
      subject: `New booking: ${lead.dog} (${lead.name})`,
      html,
    }),
  }).catch(() => { /* email is best-effort, never blocks the booking */ });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const bookings = await listBookings();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ bookings });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (!body.id || !body.name || !body.dog) {
        return res.status(400).json({ error: 'missing required fields' });
      }
      const lead = {
        id: String(body.id),
        name: String(body.name).slice(0, 80),
        phone: String(body.phone || '').slice(0, 40),
        dog: String(body.dog).slice(0, 80),
        notes: String(body.notes || '').slice(0, 500),
        date: String(body.date || ''),
        dateNice: String(body.dateNice || ''),
        session: String(body.session || ''),
        sessionKey: ['AM', 'MID', 'PM'].includes(body.sessionKey) ? body.sessionKey : 'AM',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await addBooking(lead);
      await emailBobby(lead);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
};
