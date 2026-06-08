# Good Boy by Bobby

Marketing site + scheduling dashboard for a Vernon, CT dog-training business.
Single-file React app (`index.html`) plus one serverless function for bookings.

- **Site:** `/#home` — services, pricing, and a booking calendar
- **Dashboard:** `/#dashboard` — Bobby's weekly board, waitlist, and "Buddy" automation agent
- **API:** `/api/bookings` — stores bookings (Upstash Redis) and emails Bobby (Resend)

## How a booking flows
1. Visitor picks a day + session and submits the form.
2. The browser POSTs the lead to `/api/bookings`.
3. The function stores it in Redis and emails Bobby.
4. Bobby's dashboard fetches `/api/bookings` on load and polls every 20s, so the
   booking appears as a **pending** dog (tagged `web`) on any device.

`localStorage` + an in-page event are kept as an offline fallback, so the site
still works if the backend is unreachable.

## Environment variables
Set these in the Vercel project (or `vercel env add`):

| Variable | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash database REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash database REST token |
| `RESEND_API_KEY` | Resend API key (`re_...`) |
| `BOBBY_EMAIL` | where booking alerts are sent |
| `FROM_EMAIL` | verified sender (defaults to Resend's onboarding address) |

All are optional — without them the function still responds, using ephemeral
per-instance memory and skipping email.

## Deploy
```bash
vercel deploy --prod --yes
```
