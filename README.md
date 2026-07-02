# gusys

Gusys is a Cloudflare Worker starter for a distributor LINE Official Account.

Core hierarchy:

```text
Company -> Sales Rep -> Customer -> Order -> Sales Attribution
```

The first production rule is sales ownership: each sales rep has a dedicated QR
invite URL. When a customer enters through that QR and binds their LINE identity,
future orders and reports use that binding to attribute sales.

## Current Worker routes

- `GET /` - system overview
- `GET /hub-test` - binding and mother-webhook diagnostics
- `GET|POST /line-webhook` - LINE OA webhook gateway
- `GET /sales/invite?sales=CODE` - sales QR landing page
- `POST /api/sales/reps` - create a sales rep and QR URL
- `GET /api/sales/reps` - list sales reps
- `POST /api/sales/bind` - bind a LINE customer to a sales rep
- `GET /api/reports/monthly-sales?period=YYYY-MM` - monthly sales report

## Mother webhook

The mother-site webhook is a WordPress endpoint, not Google Apps Script:

```text
MOTHER_WEBHOOK_URL=https://aiwe.cc/index.php/line_login/10279/
```

`/line-webhook` verifies the LINE signature, records Gusys events when D1 is
bound, and forwards the original LINE webhook body to `MOTHER_WEBHOOK_URL` using
`MOTHER_WEBHOOK_MODE=raw`.

If the mother webhook returns a JSON `replyPayload`, Gusys sends it through the
LINE Reply API. If the mother site handles replies internally and returns HTML,
Gusys records the mother response for diagnostics and does not send a fallback
reply unless `MOTHER_FALLBACK_REPLY_ENABLED=true` is explicitly configured.

## Secrets

Do not commit LINE secrets. Set them with Wrangler:

```powershell
npx.cmd wrangler secret put LINE_CHANNEL_SECRET
npx.cmd wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

## D1

Create and bind a D1 database before enabling persistent sales/customer data:

```powershell
npx.cmd wrangler d1 create gusys
npx.cmd wrangler d1 migrations apply gusys --remote
```

After `d1 create`, update `wrangler.toml` with the returned `database_id` and
uncomment the `[[d1_databases]]` block.

## AIWE / WETW points adapter

The Worker is wired for the AIWE member and point APIs. Keep the API key out of
source control:

```powershell
npx.cmd wrangler secret put WETW_API_KEY
```

Set the actual shop id after confirming the biotechnology company account:

```text
WETW_SHOP_ID=<actual shop id>
```

Configured non-secret endpoints:

- `WETW_MEMBER_API_URL=https://aiwe.cc/index.php/wp-json/wetw/v1/check-or-create-line-user`
- `WETW_POINT_INSERT_URL=https://aiwe.cc/index.php/wp-json/wetw-point/v1/insert-user-point`
- `WETW_POINT_QUERY_URL=https://aiwe.cc/index.php/wp-json/wetw-point/v1/query-user-point-list`
- `WETW_POINT_TYPE=system_point`

When `WETW_API_KEY` or `WETW_SHOP_ID` is missing, the adapter returns a skipped
configuration result instead of breaking sales QR binding.
## AI monitor

Gusys can analyze stored LINE messages with the OpenAI Responses API.

Secret:

```powershell
npx.cmd wrangler secret put OPENAI_API_KEY
```

Routes:

- `POST /api/ai-monitor/analyze` - analyze recent LINE messages and save an insight
- `GET /api/ai-monitor/insights` - list saved AI insights

Optional request body for analysis:

```json
{ "threadId": "Uxxxxxxxx", "limit": 30 }
```

The monitor writes only summary, category, risk level, sentiment, tags, and recommended action. It does not reply to LINE users.