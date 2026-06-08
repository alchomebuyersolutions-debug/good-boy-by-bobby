// ============================================================================
//  Good Boy by Bobby — feedback API  (zero-dependency Vercel serverless function)
//  GET  /api/feedback  -> { feedback: [item, ...] }   (newest first)
//  POST /api/feedback  -> { ok: true }                (stores + emails owner)
//
//  Same env vars as bookings (UPSTASH_REDIS_REST_*, RESEND_API_KEY, BOBBY_EMAIL,
//  FROM_EMAIL). All optional — falls back to per-instance memory + skips email.
// ============================================================================

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const BOBBY_EMAIL = process.env.BOBBY_EMAIL;
const FROM_EMAIL  = process.env.FROM_EMAIL || 'Good Boy by Bobby <onboarding@resend.dev>';

const KEY = 'gbb:feedback';
const MAX = 500;

globalThis.__gbbFb = globalThis.__gbbFb || [];

async function redis(command) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error('redis ' + res.status);
  return (await res.json()).result;
}

async function listFeedback() {
  const raw = await redis(['LRANGE', KEY, '0', '-1']);
  if (raw === null) return globalThis.__gbbFb;
  return raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

async function addFeedback(item) {
  const stored = await redis(['LPUSH', KEY, JSON.stringify(item)]);
  if (stored === null) { globalThis.__gbbFb.unshift(item); return; }
  await redis(['LTRIM', KEY, '0', String(MAX - 1)]).catch(() => {});
}

async function emailOwner(item) {
  if (!RESEND_KEY || !BOBBY_EMAIL) return;
  const esc = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const html = `
    <div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#2C484D;margin:0 0 4px">💬 New site feedback</h2>
      <p style="color:#4A5F62;margin:0 0 14px"><b>${esc(item.name) || 'A reviewer'}</b>${item.rating ? ' · rated ' + esc(item.rating) + '/5' : ''} left feedback on <b>${esc(item.page)}</b>:</p>
      <blockquote style="margin:0;padding:12px 16px;background:#F7F0E4;border-left:3px solid #E09B55;border-radius:8px;color:#15282D;font:15px sans-serif">${esc(item.message)}</blockquote>
    </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [BOBBY_EMAIL], subject: `Site feedback from ${item.name || 'a reviewer'}`, html }),
  }).catch(() => {});
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ feedback: await listFeedback() });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const message = String(body.message || '').trim();
      if (!message) return res.status(400).json({ error: 'message required' });
      const item = {
        id: 'fb-' + Date.now().toString(36),
        name: String(body.name || '').slice(0, 80),
        message: message.slice(0, 2000),
        rating: Number(body.rating) || null,
        page: String(body.page || '').slice(0, 120),
        createdAt: new Date().toISOString(),
      };
      await addFeedback(item);
      await emailOwner(item);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
};
