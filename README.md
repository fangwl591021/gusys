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

The mother-site webhook is configured in `wrangler.toml`:

```text
https://aiwe.cc/index.php/line_login/10279/
```

`/line-webhook` verifies the LINE signature, records Gusys events when D1 is
bound, forwards the payload to the mother webhook, then sends the mother
`replyPayload` through the LINE Reply API when provided.

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