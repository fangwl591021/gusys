# Gusys AIWE Dev System Rules

This project uses `fangwl591021/aiwe-dev-system` as the shared development governance source, not as a runtime dependency.

## Source Boundaries

- `gusys` is the production runtime for the distributor LINE OA system.
- `aiwe-dev-system` is the shared rules, workflow, knowledge, and reusable module index.
- `hooktea` is the source reference for CRM, shop, order, points, settings, rich-menu, and customer-facing shop behavior.
- `action` is the source reference for paid broadcast and member-zone card modules.
- The AIWE mother site is the authority for mother-site membership, LINE Login flows, and point APIs when those flows are delegated to AIWE.

## Non-Negotiable Rules

1. Do not replace a working product runtime with `aiwe-dev-system`.
2. Do not invent a parallel UI when the user asks to migrate from `hooktea` or `action`; preserve source behavior, fields, wording, and workflow unless a specific change is requested.
3. Treat mother-site membership and points as authoritative where AIWE/WETW is configured. Gusys can mirror, display, and record, but must not silently create an incompatible identity model.
4. LINE OA has one webhook URL. Gusys may be the gateway, but reply ownership must be explicit before forwarding to downstream systems.
5. Every production-visible change must be verified on the live URL, not only in local code.
6. Keep secrets in Wrangler/Cloudflare environment settings. Never commit LINE, OpenAI, WETW, payment, or admin secrets.
7. If admin settings are changed, confirm the corresponding public frontend surface consumes the same setting.

## Current Authority Map

| Area | Authority | Gusys Role |
| --- | --- | --- |
| LINE webhook ingress | Gusys Worker | Verify, log, route, and forward |
| Mother webhook content | AIWE mother site | Forward raw event and record result |
| CRM display and editing | HookTea pattern + Gusys D1 | Mirror LINE profiles and admin edits |
| Points balance | WETW/AIWE point API when configured | Query, display, and record local transactions |
| Sales attribution | Gusys D1 | Bind customer to sales UID/code |
| Shop catalog/order UX | HookTea source behavior | Port and adapt for distributor OA |
| Paid broadcast | Action source behavior | Port same module behavior |
| Member cards | Action source behavior | Port same V0-V5 editor behavior |

## Definition of Done

A feature is not done until all applicable checks pass:

- Source behavior compared against the reference repo or live reference screen.
- Admin UI, public frontend, API route, and D1 schema are all aligned.
- Existing live data is preserved.
- `node --check worker.js` passes for Worker changes.
- Cloudflare Worker is deployed when runtime behavior changes.
- The live production route is checked after deploy.
- Git commit and push are completed after deployment.
