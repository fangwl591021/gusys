# Porting Checklist

Use this checklist before changing any Gusys feature that is based on HookTea, Action, or AIWE mother-site behavior.

## 1. Identify the Source

- Source repo:
- Source file or route:
- Source screenshot or live URL:
- Target Gusys route:
- Target admin section:
- Required D1 tables or settings:

## 2. Confirm Ownership

- Member identity authority:
- Point authority:
- Reply-token owner:
- Order authority:
- Payment authority:
- Shipment authority:
- Sales attribution authority:

If any authority is unclear, stop and document the decision before coding.

## 3. Port Behavior, Not Just Layout

Verify these items against the source:

- Fields and labels
- Buttons and states
- Modal/drawer behavior
- Search, filters, and tabs
- Create/edit/delete flows
- Upload behavior
- Save and validation messages
- Empty states
- Error states
- Mobile layout

## 4. Data Sync Checks

- Admin setting saves to the expected key.
- Public frontend reads the same key.
- API response includes the saved value.
- D1 record is updated only where Gusys owns the field.
- Mother-site/WETW data is queried rather than overwritten when it is the authority.
- Cached frontend state does not mask backend failure.

## 5. Shop and Order Checks

- Product image upload works.
- Product category follows admin settings.
- Price, original price, point discount, stock, and status are shown.
- Cart supports point discount.
- Shipping fee and free-shipping threshold are applied.
- Remittance last five digits are saved.
- Order maintenance shows payment, shipment, points, and remittance records.
- Cancelled orders return used points when the order is allowed to cancel.

## 6. LINE and LIFF Checks

- LIFF ID and callback URL match LINE Developers settings.
- Login flow gets real LINE UID and profile.
- CRM records LINE display name, UID, and avatar.
- Sales QR binding records the intended sales owner.
- Webhook verification returns 200.
- Mother-site forwarding does not consume reply tokens twice.

## 7. Verification Commands

Run the relevant checks:

```powershell
node --check worker.js
git diff --check
npx.cmd wrangler deploy
```

Then verify the live route with a cache-busting query string.

## 8. Completion Record

- Worker version:
- Commit:
- Live URL verified:
- Remaining gap:
- Next recommended step:
