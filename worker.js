const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/") return renderHome(env);
      if (url.pathname === "/admin") return renderHookteaAdminPage(env);
      if (url.pathname === "/hub-test") return handleHubTest(env);
      if (url.pathname === "/line-webhook") return handleLineWebhook(request, env, ctx);
      if (url.pathname === "/sales/invite") return renderSalesInvitePage(request, env);
      if (url.pathname.startsWith("/api/admin/webhook") && request.method === "GET") return listAdminWebhookEvents(request, env);
      if (url.pathname === "/api/admin/summary" && request.method === "GET") return adminSummary(request, env);
      if (url.pathname === "/api/admin/customers" && request.method === "GET") return listAdminCustomers(request, env);
      if (url.pathname === "/api/admin/customers/sync-profiles" && request.method === "POST") return syncAdminCustomerProfiles(request, env);
      if (url.pathname === "/api/admin/line-messages" && request.method === "GET") return listAdminLineMessages(request, env);
      if ((url.pathname === "/api/admin/webhook-events" || url.pathname === "/api/admin/webhooks") && request.method === "GET") return listAdminWebhookEvents(request, env);
      if (url.pathname === "/api/products" && request.method === "GET") return listProducts(request, env);
      if (url.pathname === "/api/products" && request.method === "POST") return createProduct(request, env);
      if (url.pathname === "/api/sales/reps" && request.method === "POST") return createSalesRep(request, env);
      if (url.pathname === "/api/sales/reps" && request.method === "GET") return listSalesReps(env);
      if (url.pathname === "/api/sales/bind" && request.method === "POST") return bindCustomerToSalesRep(request, env);
      if (url.pathname === "/api/members/check-or-create" && request.method === "POST") return checkOrCreateMember(request, env);
      if (url.pathname === "/api/points/adjust" && request.method === "POST") return adjustMemberPoints(request, env);
      if (url.pathname === "/api/points/list" && request.method === "GET") return listMemberPoints(request, env);
      if (url.pathname === "/api/ai-monitor/analyze" && request.method === "POST") return analyzeLineMonitor(request, env);
      if (url.pathname === "/api/ai-monitor/insights" && request.method === "GET") return listAiMonitorInsights(request, env);
      if (url.pathname === "/api/reports/monthly-sales" && request.method === "GET") return monthlySalesReport(request, env);

      return json({ ok: false, error: "not_found", path: url.pathname }, 404);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "request_failed",
        path: url.pathname,
        error: error && error.stack ? error.stack : String(error),
      }));
      return json({ ok: false, error: "internal_error", message: String(error?.message || error) }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function handleLineWebhook(request, env, ctx) {
  if (request.method === "GET") {
    return new Response("Gusys LINE webhook endpoint", { status: 200, headers: TEXT_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const signature = request.headers.get("x-line-signature") || "";
  const rawBody = await request.text();
  const lineBody = parseJson(rawBody, {});
  const signatureResult = await verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET);
  if (!signatureResult.ok) {
    if (isLineVerifyProbe(lineBody)) {
      await recordWebhookDebug(env, "LINE_WEBHOOK_VERIFY_PROBE_LAST", {
        reason: signatureResult.reason,
        hasSignature: Boolean(signature),
        secretConfigured: Boolean(env.LINE_CHANNEL_SECRET),
        acceptedAt: new Date().toISOString(),
      });
      return json({ ok: true, verify: true, signature: "probe_accepted" });
    }
    if (env.DB) {
      await recordRejectedLineEvents(env, lineBody, rawBody, signatureResult.reason).catch(error => {
        console.error(JSON.stringify({ level: "error", message: "record_rejected_line_events_failed", error: String(error?.message || error) }));
      });
    }
    await recordWebhookDebug(env, "LINE_WEBHOOK_REJECT_LAST", {
      reason: signatureResult.reason,
      hasSignature: Boolean(signature),
      secretConfigured: Boolean(env.LINE_CHANNEL_SECRET),
      rejectedAt: new Date().toISOString(),
    });
    return new Response("Invalid Signature", { status: 403, headers: TEXT_HEADERS });
  }

  const events = Array.isArray(lineBody.events) ? lineBody.events : [];

  if (env.DB) {
    ctx.waitUntil(recordLineEvents(env, events, rawBody).catch(error => {
      console.error(JSON.stringify({ level: "error", message: "record_line_events_failed", error: String(error?.message || error) }));
    }));
    ctx.waitUntil(handleGusysLineEvents(env, events).catch(error => {
      console.error(JSON.stringify({ level: "error", message: "handle_gusys_events_failed", error: String(error?.message || error) }));
    }));
  }

  const motherResult = await forwardToMotherWebhook(env, rawBody, signature);

  if (env.DB) {
    ctx.waitUntil(recordMotherForwardResult(env, events, motherResult).catch(error => {
      console.error(JSON.stringify({ level: "error", message: "record_mother_forward_failed", error: String(error?.message || error) }));
    }));
  }

  await recordWebhookDebug(env, "LINE_WEBHOOK_LAST", {
    eventCount: events.length,
    motherStatus: motherResult.status,
    motherOk: motherResult.ok,
    receivedAt: new Date().toISOString(),
  });

  const replyPayload = motherResult.replyPayload || buildLocalKeywordReplyPayload(events, env);
  if (replyPayload && env.LINE_CHANNEL_ACCESS_TOKEN) {
    const replyResult = await replyLineMessage(env, replyPayload);
    return json({ ok: true, mother: motherResult.summary, reply: replyResult });
  }

  return json({ ok: true, mother: motherResult.summary, reply: null });
}

function isLineVerifyProbe(body) {
  if (!body || typeof body !== "object") return false;
  if (!Array.isArray(body.events)) return false;
  return body.events.length === 0;
}
async function forwardToMotherWebhook(env, rawBody, signature) {
  const targetUrl = env.MOTHER_WEBHOOK_URL;
  if (!targetUrl) {
    return {
      ok: false,
      status: 0,
      replyPayload: null,
      summary: { configured: false, status: 0 },
    };
  }

  const mode = String(env.MOTHER_WEBHOOK_MODE || "raw").toLowerCase();
  const lineBody = parseJson(rawBody, {});
  const body = mode === "raw"
    ? rawBody
    : JSON.stringify({ action: "LINE_WEBHOOK", payload: lineBody });

  const forwardSignature = await buildMotherSignature(env, body, signature);
  const headers = {
    "content-type": "application/json",
  };
  if (forwardSignature) headers["x-line-signature"] = forwardSignature;

  const startedAt = Date.now();
  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body,
    });
    const text = await response.text();
    const parsed = parseJson(text, null);
    return {
      ok: response.ok,
      status: response.status,
      replyPayload: extractReplyPayload(parsed),
      summary: {
        configured: true,
        ok: response.ok,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        hasReplyPayload: Boolean(extractReplyPayload(parsed)),
        contentType: response.headers.get("content-type") || "",
        invalidSignature: /invalid\s+signature/i.test(text),
        hasHtmlResponse: /<html[\s>]/i.test(text),
        bodyPreview: text.slice(0, 2200),
        bodyTail: text.slice(-1200),
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      replyPayload: null,
      summary: {
        configured: true,
        ok: false,
        status: 0,
        elapsedMs: Date.now() - startedAt,
        error: String(error?.message || error),
      },
    };
  }
}

function buildLocalKeywordReplyPayload(events, env) {
  if (String(env.MOTHER_FALLBACK_REPLY_ENABLED || "false").toLowerCase() !== "true") return null;
  const event = Array.isArray(events) ? events.find(item => item?.replyToken && item?.message?.type === "text") : null;
  if (!event) return null;

  const text = String(event.message?.text || "").trim();
  if (!text) return null;

  if (text.includes("會員專區")) {
    const url = env.MEMBER_CENTER_URL || env.MOTHER_MEMBER_URL || "https://aiwe.cc/index.php/line_login/10279/";
    return {
      replyToken: event.replyToken,
      messages: [{ type: "text", text: `會員專區\n${url}` }],
    };
  }

  if (text.includes("點數") || text.includes("點數管理")) {
    const url = env.POINTS_PAGE_URL || "https://aiwe.cc/index.php/linecard_16/10281/";
    return {
      replyToken: event.replyToken,
      messages: [{ type: "text", text: `點數管理\n${url}` }],
    };
  }

  return null;
}
async function buildMotherSignature(env, body, originalSignature) {
  const secret = env.MOTHER_LINE_CHANNEL_SECRET;
  if (!secret) return originalSignature;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return arrayBufferToBase64(signature);
}
function extractReplyPayload(value) {
  if (!value || typeof value !== "object") return null;
  if (value.replyPayload) return value.replyPayload;
  if (value.data && value.data.replyPayload) return value.data.replyPayload;
  if (value.result && value.result.replyPayload) return value.result.replyPayload;
  return null;
}

async function replyLineMessage(env, replyPayload) {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(replyPayload),
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: text.slice(0, 1000),
  };
}

async function handleGusysLineEvents(env, events) {
  for (const event of events) {
    if (!event || event.type !== "message" || event.message?.type !== "text") continue;
    const text = String(event.message.text || "").trim();
    const lineUserId = String(event.source?.userId || "").trim();
    if (!lineUserId) continue;

    const salesCode = extractSalesCode(text);
    if (salesCode) {
      await bindCustomerBySalesCode(env, {
        lineUserId,
        displayName: "",
        salesCode,
        source: "line_text",
      });
    }
  }
}

function extractSalesCode(text) {
  const normalized = String(text || "").trim();
  const match = normalized.match(/(?:業務碼|業務代碼|sales|sales_code|ref)[:：\s#-]*([A-Za-z0-9_-]{3,40})/i);
  return match ? match[1] : "";
}

async function recordRejectedLineEvents(env, lineBody, rawBody, reason) {
  const events = Array.isArray(lineBody?.events) ? lineBody.events : [];
  if (!events.length) {
    await env.DB.prepare(`
      INSERT INTO webhook_events (
        id, source, event_type, message_text, mother_status, handled_by_gusys, raw_json
      ) VALUES (?, 'line', 'signature_reject', ?, 403, 0, ?)
    `).bind(crypto.randomUUID(), String(reason || 'invalid_signature'), rawBody.slice(0, 5000)).run();
    return;
  }
  for (const event of events) {
    const eventId = `reject_${String(event.webhookEventId || event.message?.id || crypto.randomUUID())}`;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO webhook_events (
        id, source, line_user_id, event_type, message_text, mother_status, handled_by_gusys, raw_json
      ) VALUES (?, 'line', ?, 'signature_reject', ?, 403, 0, ?)
    `).bind(
      eventId,
      String(event.source?.userId || ''),
      `${String(reason || 'invalid_signature')}: ${lineEventText(event)}`,
      JSON.stringify(event),
    ).run();
  }
}
async function recordMotherForwardResult(env, events, motherResult) {
  const event = Array.isArray(events) && events.length ? events[0] : {};
  const lineUserId = String(event.source?.userId || "");
  const text = lineEventText(event);
  const summary = motherResult?.summary || {};
  await env.DB.prepare(`
    INSERT INTO webhook_events (
      id, source, line_user_id, event_type, message_text, mother_status, handled_by_gusys, raw_json
    ) VALUES (?, 'mother', ?, 'mother_forward', ?, ?, 0, ?)
  `).bind(
    crypto.randomUUID(),
    lineUserId,
    text,
    Number(motherResult?.status || 0),
    JSON.stringify(summary).slice(0, 5000),
  ).run();
}
async function recordLineEvents(env, events, rawBody) {
  for (const event of events) {
    const eventId = String(event.webhookEventId || event.message?.id || crypto.randomUUID());
    const lineUserId = String(event.source?.userId || "");
    const text = lineEventText(event);
    const createdAt = String(event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString());
    const threadId = lineUserId || eventId;
    const crmProfile = await ensureCustomerFromLineEvent(env, event).catch(error => {
      console.error(JSON.stringify({ level: "error", message: "ensure_crm_customer_failed", error: String(error?.message || error) }));
      return null;
    });
    const displayName = crmProfile?.displayName || lineUserId;

    await env.DB.prepare(`
      INSERT INTO line_threads (
        id, company_id, source_user_id, display_name, status, summary,
        unread_count, tags, last_message_at, created_at, updated_at
      ) VALUES (?, 'default', ?, ?, 'open', ?, 1, 'LINE', ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        source_user_id = excluded.source_user_id,
        summary = excluded.summary,
        unread_count = line_threads.unread_count + 1,
        last_message_at = excluded.last_message_at,
        updated_at = datetime('now')
    `).bind(threadId, lineUserId, displayName, text, createdAt).run();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO line_messages (
        id, thread_id, line_event_id, reply_token, message_type, sender_role,
        sender_id, sender_name, message_text, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?, ?, ?)
    `).bind(
      eventId,
      threadId,
      String(event.webhookEventId || ""),
      String(event.replyToken || ""),
      String(event.message?.type || event.type || "event"),
      lineUserId,
      displayName,
      text,
      JSON.stringify(event),
      createdAt,
    ).run();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO webhook_events (
        id, source, line_user_id, event_type, message_text, raw_json
      ) VALUES (?, 'line', ?, ?, ?, ?)
    `).bind(eventId, lineUserId, String(event.type || ""), text, rawBody).run();
  }
}

function lineEventText(event) {
  if (!event) return "";
  if (event.message?.type === "text") return String(event.message.text || "");
  if (event.message?.type) return `[${event.message.type}]`;
  return `[${event.type || "event"}]`;
}

async function ensureCustomerFromLineEvent(env, event) {
  const lineUserId = String(event?.source?.userId || "").trim();
  if (!lineUserId) return null;

  const createdAt = String(event?.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString());
  const profile = await fetchLineProfile(env, lineUserId);
  const displayName = String(profile.displayName || "").trim();
  const pictureUrl = String(profile.pictureUrl || "").trim();

  await env.DB.prepare(`
    INSERT INTO customers (
      id, company_id, line_user_id, display_name, picture_url, status, first_seen_at, created_at, updated_at
    ) VALUES (?, 'default', ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
    ON CONFLICT(line_user_id) DO UPDATE SET
      display_name = CASE
        WHEN excluded.display_name <> '' THEN excluded.display_name
        WHEN customers.display_name = customers.line_user_id THEN ''
        ELSE customers.display_name
      END,
      picture_url = CASE WHEN excluded.picture_url <> '' THEN excluded.picture_url ELSE customers.picture_url END,
      status = 'active',
      updated_at = datetime('now')
  `).bind(crypto.randomUUID(), lineUserId, displayName, pictureUrl, createdAt).run();

  return { lineUserId, displayName: displayName || lineUserId, pictureUrl };
}

async function fetchLineProfile(env, lineUserId) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !lineUserId) return {};
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!response.ok) return {};
    const data = await response.json().catch(() => ({}));
    return {
      displayName: String(data.displayName || ""),
      pictureUrl: String(data.pictureUrl || ""),
      statusMessage: String(data.statusMessage || ""),
    };
  } catch {
    return {};
  }
}

async function adminSummary(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const [sales, customers, products, messages, webhooks, highRisk] = await Promise.all([
    countRows(env, "sales_reps", "status = 'active'"),
    countRows(env, "customers", "status = 'active'"),
    countRows(env, "products", "status = 'active'"),
    countRows(env, "line_messages", "message_text <> ''"),
    countRows(env, "webhook_events", "source = 'mother'"),
    countRows(env, "ai_monitor_insights", "risk_level = 'high'"),
  ]);
  const latestMother = await env.DB.prepare(`
    SELECT message_text AS messageText, mother_status AS motherStatus, raw_json AS rawJson, created_at AS createdAt
    FROM webhook_events
    WHERE source = 'mother'
    ORDER BY created_at DESC
    LIMIT 1
  `).first();
  const latestMessage = await env.DB.prepare(`
    SELECT message_text AS messageText, sender_id AS senderId, created_at AS createdAt
    FROM line_messages
    WHERE message_text <> ''
    ORDER BY created_at DESC, inserted_at DESC
    LIMIT 1
  `).first();
  return json({ ok: true, data: { sales, customers, products, messages, webhooks, highRisk, latestMother, latestMessage } });
}

async function listAdminCustomers(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const url = new URL(request.url);
  const limit = readLimit(url, 200);
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.line_user_id AS lineUserId, c.display_name AS displayName,
           c.picture_url AS pictureUrl,
           c.phone, c.address, c.status, c.first_seen_at AS firstSeenAt,
           c.updated_at AS updatedAt,
           sr.sales_code AS salesCode, sr.name AS salesName, b.bound_at AS boundAt,
           lt.last_message_at AS lastMessageAt,
           COUNT(lm.id) AS messageCount
    FROM customers c
    LEFT JOIN customer_sales_bindings b ON b.customer_id = c.id AND b.active = 1
    LEFT JOIN sales_reps sr ON sr.id = b.sales_rep_id
    LEFT JOIN line_threads lt ON lt.source_user_id = c.line_user_id
    LEFT JOIN line_messages lm ON lm.sender_id = c.line_user_id
    GROUP BY c.id
    ORDER BY COALESCE(lt.last_message_at, c.updated_at, c.created_at) DESC
    LIMIT ?
  `).bind(limit).all();
  return json({ ok: true, data: results || [] });
}

async function syncAdminCustomerProfiles(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const body = await request.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit || 200), 1), 500);
  const { results } = await env.DB.prepare(`
    SELECT id, line_user_id AS lineUserId, display_name AS displayName, picture_url AS pictureUrl
    FROM customers
    WHERE line_user_id <> ''
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(limit).all();

  let updated = 0;
  let skipped = 0;
  const failed = [];
  for (const customer of results || []) {
    const lineUserId = String(customer.lineUserId || "");
    const profile = await fetchLineProfile(env, lineUserId);
    const displayName = String(profile.displayName || "").trim();
    const pictureUrl = String(profile.pictureUrl || "").trim();
    if (!displayName && !pictureUrl) {
      skipped += 1;
      failed.push(lineUserId);
      continue;
    }
    await env.DB.prepare(`
      UPDATE customers
      SET display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
          picture_url = CASE WHEN ? <> '' THEN ? ELSE picture_url END,
          updated_at = datetime('now')
      WHERE line_user_id = ?
    `).bind(displayName, displayName, pictureUrl, pictureUrl, lineUserId).run();
    updated += 1;
  }

  return json({ ok: true, data: { updated, skipped, failed: failed.slice(0, 20) } });
}

async function listAdminLineMessages(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const url = new URL(request.url);
  const limit = readLimit(url, 120);
  const { results } = await env.DB.prepare(`
    SELECT id, thread_id AS threadId, sender_id AS senderId, sender_name AS senderName,
           message_type AS messageType, message_text AS messageText, created_at AS createdAt, inserted_at AS insertedAt
    FROM line_messages
    WHERE message_text <> ''
    ORDER BY created_at DESC, inserted_at DESC
    LIMIT ?
  `).bind(limit).all();
  return json({ ok: true, data: results || [] });
}

async function listAdminWebhookEvents(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const url = new URL(request.url);
  const limit = readLimit(url, 120);
  const source = String(url.searchParams.get("source") || "").trim();
  const where = source ? "WHERE source = ?" : "";
  const stmt = env.DB.prepare(`
    SELECT id, source, event_type AS eventType, line_user_id AS lineUserId,
           message_text AS messageText, mother_status AS motherStatus,
           handled_by_gusys AS handledByGusys, raw_json AS rawJson, created_at AS createdAt
    FROM webhook_events
    ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const { results } = source ? await stmt.bind(source, limit).all() : await stmt.bind(limit).all();
  return json({ ok: true, data: (results || []).map(item => ({ ...item, summary: summarizeWebhookRaw(item.rawJson) })) });
}

async function listProducts(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const url = new URL(request.url);
  const limit = readLimit(url, 200);
  const { results } = await env.DB.prepare(`
    SELECT id, sku, name, category, unit, price, cost, stock_qty AS stockQty,
           safety_stock_qty AS safetyStockQty, status, updated_at AS updatedAt
    FROM products
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ?
  `).bind(limit).all();
  return json({ ok: true, data: results || [] });
}

async function createProduct(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const payload = await request.json().catch(() => ({}));
  const name = String(payload.name || "").trim();
  if (!name) return json({ ok: false, error: "missing_name" }, 400);
  const id = crypto.randomUUID();
  const sku = String(payload.sku || "").trim();
  const category = String(payload.category || "").trim();
  const unit = String(payload.unit || "件").trim() || "件";
  const price = Number.parseInt(payload.price || 0, 10) || 0;
  const cost = Number.parseInt(payload.cost || 0, 10) || 0;
  const stockQty = Number.parseInt(payload.stockQty ?? payload.stock_qty ?? 0, 10) || 0;
  const safetyStockQty = Number.parseInt(payload.safetyStockQty ?? payload.safety_stock_qty ?? 0, 10) || 0;
  await env.DB.prepare(`
    INSERT INTO products (
      id, company_id, sku, name, category, unit, price, cost, stock_qty, safety_stock_qty, status, created_at, updated_at
    ) VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
  `).bind(id, sku, name, category, unit, price, cost, stockQty, safetyStockQty).run();
  return json({ ok: true, data: { id, sku, name } });
}

async function countRows(env, table, where) {
  const sql = `SELECT COUNT(*) AS total FROM ${table} ${where ? "WHERE " + where : ""}`;
  const row = await env.DB.prepare(sql).first();
  return Number(row?.total || 0);
}

function readLimit(url, fallback) {
  return Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || fallback) || fallback));
}

function summarizeWebhookRaw(rawJson) {
  const parsed = parseJson(rawJson, null);
  if (!parsed || typeof parsed !== "object") return { contentType: "", invalidSignature: false, hasReplyPayload: false };
  return {
    status: parsed.status || 0,
    contentType: parsed.contentType || "",
    invalidSignature: Boolean(parsed.invalidSignature),
    hasHtmlResponse: Boolean(parsed.hasHtmlResponse),
    hasReplyPayload: Boolean(parsed.hasReplyPayload),
    bodyTail: String(parsed.bodyTail || "").slice(-220),
  };
}

function requireAdmin(request, env) {
  const token = String(env.ADMIN_TOKEN || "").trim();
  if (!token) return;
  const url = new URL(request.url);
  const provided = request.headers.get("x-admin-token") || url.searchParams.get("token") || "";
  if (provided !== token) throw new HttpError(401, "admin_unauthorized");
}
async function createSalesRep(request, env) {
  requireDb(env);
  const payload = await request.json().catch(() => ({}));
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const lineUserId = String(payload.lineUserId || "").trim();
  if (!name) return json({ ok: false, error: "missing_name" }, 400);

  const id = crypto.randomUUID();
  const salesCode = normalizeSalesCode(payload.salesCode || makeSalesCode(name));
  const inviteUrl = buildSalesInviteUrl(env, salesCode);
  const qrUrl = buildQrUrl(inviteUrl);

  await env.DB.prepare(`
    INSERT INTO sales_reps (
      id, company_id, sales_code, name, line_user_id, phone, status,
      invite_url, qr_url, created_at, updated_at
    ) VALUES (?, 'default', ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
  `).bind(id, salesCode, name, lineUserId, phone, inviteUrl, qrUrl).run();

  return json({ ok: true, data: { id, salesCode, name, inviteUrl, qrUrl } });
}

async function listSalesReps(env) {
  requireDb(env);
  const { results } = await env.DB.prepare(`
    SELECT id, sales_code AS salesCode, name, line_user_id AS lineUserId,
           phone, status, invite_url AS inviteUrl, qr_url AS qrUrl,
           created_at AS createdAt, updated_at AS updatedAt
    FROM sales_reps
    ORDER BY created_at DESC
    LIMIT 200
  `).all();
  return json({ ok: true, data: results || [] });
}

async function bindCustomerToSalesRep(request, env) {
  requireDb(env);
  const payload = await request.json().catch(() => ({}));
  const result = await bindCustomerBySalesCode(env, {
    lineUserId: payload.lineUserId,
    displayName: payload.displayName,
    phone: payload.phone,
    address: payload.address,
    salesCode: payload.salesCode,
    source: payload.source || "api",
  });
  return json({ ok: true, data: result });
}

async function checkOrCreateMember(request, env) {
  const payload = await request.json().catch(() => ({}));
  const result = await syncWetwMember(env, {
    lineUserId: payload.lineUserId || payload.LINE_user_id,
    displayName: payload.displayName || payload.LINE_display_name,
    statusMessage: payload.statusMessage || payload.LINE_status_message,
    pictureUrl: payload.pictureUrl || payload.LINE_picture_url,
  });
  return json({ ok: result.ok, data: result }, result.ok ? 200 : result.status || 400);
}

async function adjustMemberPoints(request, env) {
  const payload = await request.json().catch(() => ({}));
  const result = await callWetwPointInsert(env, {
    lineUserId: payload.lineUserId || payload.LINE_user_id,
    eventName: payload.eventName || payload.event_name,
    eventContent: payload.eventContent || payload.event_content,
    pointType: payload.pointType || payload.point_type,
    points: payload.points ?? payload.get_point,
    shopUserLineId: payload.shopUserLineId || payload.shop_user_lineid,
    childShopName: payload.childShopName || payload.child_shop_name,
    childShopRenew: payload.childShopRenew ?? payload.child_shop_renew,
    shopRemark: payload.shopRemark || payload.shop_remark,
  });
  return json({ ok: result.ok, data: result }, result.ok ? 200 : result.status || 400);
}

async function listMemberPoints(request, env) {
  const url = new URL(request.url);
  const result = await callWetwPointQuery(env, {
    lineUserId: url.searchParams.get("lineUserId") || url.searchParams.get("LINE_user_id"),
    shopId: url.searchParams.get("shopId") || url.searchParams.get("shop_id"),
    pointType: url.searchParams.get("pointType") || url.searchParams.get("point_type"),
    dateStart: url.searchParams.get("dateStart") || url.searchParams.get("date_start"),
    dateEnd: url.searchParams.get("dateEnd") || url.searchParams.get("date_end"),
    page: url.searchParams.get("page"),
    perPage: url.searchParams.get("perPage") || url.searchParams.get("per_page"),
  });
  return json({ ok: result.ok, data: result }, result.ok ? 200 : result.status || 400);
}
async function bindCustomerBySalesCode(env, input) {
  const lineUserId = String(input.lineUserId || "").trim();
  const salesCode = normalizeSalesCode(input.salesCode || "");
  if (!lineUserId) throw new Error("missing_line_user_id");
  if (!salesCode) throw new Error("missing_sales_code");

  const salesRep = await env.DB.prepare(`
    SELECT id, sales_code, name
    FROM sales_reps
    WHERE sales_code = ? AND status = 'active'
    LIMIT 1
  `).bind(salesCode).first();
  if (!salesRep) throw new Error("sales_rep_not_found");

  const existingCustomer = await env.DB.prepare(`
    SELECT id
    FROM customers
    WHERE line_user_id = ?
    LIMIT 1
  `).bind(lineUserId).first();

  const customerId = existingCustomer?.id || crypto.randomUUID();
  if (existingCustomer) {
    await env.DB.prepare(`
      UPDATE customers
      SET display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
          phone = CASE WHEN ? <> '' THEN ? ELSE phone END,
          address = CASE WHEN ? <> '' THEN ? ELSE address END,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      String(input.displayName || "").trim(),
      String(input.displayName || "").trim(),
      String(input.phone || "").trim(),
      String(input.phone || "").trim(),
      String(input.address || "").trim(),
      String(input.address || "").trim(),
      customerId,
    ).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO customers (
        id, company_id, line_user_id, display_name, phone, address,
        status, first_seen_at, created_at, updated_at
      ) VALUES (?, 'default', ?, ?, ?, ?, 'active', datetime('now'), datetime('now'), datetime('now'))
    `).bind(
      customerId,
      lineUserId,
      String(input.displayName || "").trim(),
      String(input.phone || "").trim(),
      String(input.address || "").trim(),
    ).run();
  }

  const activeBinding = await env.DB.prepare(`
    SELECT id, sales_rep_id AS salesRepId
    FROM customer_sales_bindings
    WHERE customer_id = ? AND active = 1
    LIMIT 1
  `).bind(customerId).first();

  if (!activeBinding) {
    await env.DB.prepare(`
      INSERT INTO customer_sales_bindings (
        id, company_id, customer_id, sales_rep_id, source, locked, active, bound_at
      ) VALUES (?, 'default', ?, ?, ?, 1, 1, datetime('now'))
    `).bind(crypto.randomUUID(), customerId, salesRep.id, String(input.source || "sales_qr")).run();
  }

  const memberSync = await syncWetwMember(env, {
    lineUserId,
    displayName: input.displayName,
    statusMessage: input.statusMessage,
    pictureUrl: input.pictureUrl,
  }).catch(error => ({ ok: false, skipped: false, error: String(error?.message || error) }));

  return {
    customerId,
    lineUserId,
    salesRepId: activeBinding?.salesRepId || salesRep.id,
    salesCode,
    salesName: salesRep.name,
    alreadyBound: Boolean(activeBinding),
    memberSync,
  };
}

async function syncWetwMember(env, input) {
  const lineUserId = String(input.lineUserId || "").trim();
  if (!lineUserId) return { ok: false, skipped: false, error: "missing_line_user_id", status: 400 };
  const cfg = wetwConfig(env);
  if (!cfg.apiKey || !cfg.shopId) {
    return { ok: false, skipped: true, error: "wetw_member_config_missing", configured: cfg.configured };
  }
  return callWetwApi(cfg.memberApiUrl, {
    api_key: cfg.apiKey,
    shop_id: cfg.shopId,
    LINE_user_id: lineUserId,
    LINE_display_name: String(input.displayName || "").trim(),
    LINE_status_message: String(input.statusMessage || "").trim(),
    LINE_picture_url: String(input.pictureUrl || "").trim(),
  });
}

async function callWetwPointInsert(env, input) {
  const lineUserId = String(input.lineUserId || "").trim();
  const eventName = String(input.eventName || "").trim();
  const eventContent = String(input.eventContent || eventName || "Gusys 點數異動").trim();
  const points = Number(input.points);
  if (!lineUserId) return { ok: false, skipped: false, error: "missing_line_user_id", status: 400 };
  if (!eventName) return { ok: false, skipped: false, error: "missing_event_name", status: 400 };
  if (!Number.isFinite(points) || points === 0) return { ok: false, skipped: false, error: "invalid_points", status: 400 };
  const cfg = wetwConfig(env);
  if (!cfg.apiKey || !cfg.shopId) {
    return { ok: false, skipped: true, error: "wetw_point_config_missing", configured: cfg.configured };
  }
  return callWetwApi(cfg.pointInsertUrl, {
    api_key: cfg.apiKey,
    LINE_user_id: lineUserId,
    shop_id: cfg.shopId,
    event_name: eventName,
    event_content: eventContent,
    point_type: String(input.pointType || cfg.pointType || "system_point").trim(),
    get_point: points,
    shop_user_lineid: String(input.shopUserLineId || "").trim(),
    child_shop_name: String(input.childShopName || "").trim(),
    child_shop_renew: Number(input.childShopRenew || 0) || 0,
    shop_remark: String(input.shopRemark || "Gusys API").trim(),
  });
}

async function callWetwPointQuery(env, input) {
  const cfg = wetwConfig(env);
  if (!cfg.apiKey) return { ok: false, skipped: true, error: "wetw_api_key_missing", configured: cfg.configured };
  const lineUserId = String(input.lineUserId || "").trim();
  const shopId = String(input.shopId || cfg.shopId || "").trim();
  if (!lineUserId && !shopId) return { ok: false, skipped: false, error: "missing_query_condition", status: 400 };
  const payload = {
    api_key: cfg.apiKey,
    page: Math.max(1, Number(input.page || 1) || 1),
    per_page: Math.min(100, Math.max(1, Number(input.perPage || 20) || 20)),
  };
  if (lineUserId) payload.LINE_user_id = lineUserId;
  if (shopId) payload.shop_id = Number(shopId) || shopId;
  if (input.pointType) payload.point_type = String(input.pointType).trim();
  if (input.dateStart) payload.date_start = String(input.dateStart).trim();
  if (input.dateEnd) payload.date_end = String(input.dateEnd).trim();
  const result = await callWetwApi(cfg.pointQueryUrl, payload);
  return normalizeWetwPointQueryResult(result);
}

function normalizeWetwPointQueryResult(result) {
  const dataRoot = result?.data?.data || result?.data || {};
  const payload = dataRoot?.data || dataRoot;
  const list = Array.isArray(payload?.list) ? payload.list : [];
  const latest = list[0] || {};
  const balance = Number(latest.point_balance ?? latest.balance ?? latest.after_balance ?? 0) || 0;
  return {
    ...result,
    balance,
    logs: list,
    pagination: payload?.pagination || {},
    query: payload?.query || {},
  };
}

async function callWetwApi(url, payload) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const data = parseJson(text, null);
    return {
      ok: response.ok && data?.success !== false,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      code: data?.code || "",
      message: data?.message || "",
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      error: String(error?.message || error),
    };
  }
}

function wetwConfig(env) {
  const apiKey = String(env.WETW_API_KEY || "").trim();
  const shopId = String(env.WETW_SHOP_ID || "").trim();
  const memberApiUrl = String(env.WETW_MEMBER_API_URL || "https://aiwe.cc/index.php/wp-json/wetw/v1/check-or-create-line-user").trim();
  const pointInsertUrl = String(env.WETW_POINT_INSERT_URL || "https://aiwe.cc/index.php/wp-json/wetw-point/v1/insert-user-point").trim();
  const pointQueryUrl = String(env.WETW_POINT_QUERY_URL || "https://aiwe.cc/index.php/wp-json/wetw-point/v1/query-user-point-list").trim();
  const pointType = String(env.WETW_POINT_TYPE || "system_point").trim();
  return {
    apiKey,
    shopId,
    memberApiUrl,
    pointInsertUrl,
    pointQueryUrl,
    pointType,
    configured: {
      apiKey: Boolean(apiKey),
      shopId: Boolean(shopId),
      memberApiUrl: Boolean(memberApiUrl),
      pointInsertUrl: Boolean(pointInsertUrl),
      pointQueryUrl: Boolean(pointQueryUrl),
      pointType,
    },
  };
}
async function analyzeLineMonitor(request, env) {
  requireDb(env);
  const cfg = aiMonitorConfig(env);
  if (!cfg.enabled) return json({ ok: false, error: "ai_monitor_disabled" }, 400);
  if (!cfg.apiKey) return json({ ok: false, error: "openai_api_key_missing" }, 400);

  const payload = await request.json().catch(() => ({}));
  const limit = Math.min(cfg.messageLimit, Math.max(1, Number(payload.limit || cfg.messageLimit) || cfg.messageLimit));
  const threadId = String(payload.threadId || "").trim();
  const messages = await loadLineMessagesForAi(env, { threadId, limit });
  if (!messages.length) return json({ ok: false, error: "no_messages" }, 404);

  const insight = await callOpenAiMonitor(cfg, messages);
  const saved = await saveAiMonitorInsight(env, insight, messages, cfg.model);
  return json({ ok: true, data: saved });
}

async function listAiMonitorInsights(request, env) {
  requireDb(env);
  const url = new URL(request.url);
  const risk = String(url.searchParams.get("risk") || "").trim();
  const threadId = String(url.searchParams.get("threadId") || "").trim();
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50) || 50));
  const where = [];
  const binds = [];
  if (risk) { where.push("risk_level = ?"); binds.push(risk); }
  if (threadId) { where.push("thread_id = ?"); binds.push(threadId); }
  const sql = `
    SELECT id, thread_id AS threadId, source_message_ids AS sourceMessageIds,
           category, risk_level AS riskLevel, summary, recommended_action AS recommendedAction,
           sentiment, tags, model, created_at AS createdAt, updated_at AS updatedAt
    FROM ai_monitor_insights
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  binds.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ ok: true, data: results || [] });
}

async function loadLineMessagesForAi(env, options) {
  const limit = Math.min(100, Math.max(1, Number(options.limit || 30) || 30));
  const threadId = String(options.threadId || "").trim();
  if (threadId) {
    const { results } = await env.DB.prepare(`
      SELECT id, thread_id AS threadId, sender_role AS senderRole, sender_name AS senderName,
             message_text AS messageText, created_at AS createdAt
      FROM line_messages
      WHERE thread_id = ? AND message_text <> ''
      ORDER BY created_at DESC, inserted_at DESC
      LIMIT ?
    `).bind(threadId, limit).all();
    return (results || []).reverse();
  }
  const { results } = await env.DB.prepare(`
    SELECT m.id, m.thread_id AS threadId, m.sender_role AS senderRole, m.sender_name AS senderName,
           m.message_text AS messageText, m.created_at AS createdAt
    FROM line_messages m
    WHERE m.message_text <> ''
    ORDER BY m.created_at DESC, m.inserted_at DESC
    LIMIT ?
  `).bind(limit).all();
  return (results || []).reverse();
}

async function callOpenAiMonitor(cfg, messages) {
  const compactMessages = messages.map(item => ({
    id: item.id,
    threadId: item.threadId,
    role: item.senderRole || "user",
    name: item.senderName || "",
    text: item.messageText || "",
    at: item.createdAt || "",
  }));
  const prompt = [
    "你是 LINE 官方帳號客服監控分析器。請只輸出 JSON，不要 markdown。",
    "根據訊息判斷分類、風險、情緒、摘要、建議處理。",
    `可用分類：${cfg.categories.join("、")}`,
    `高風險關鍵字：${cfg.riskKeywords.join("、")}`,
    "JSON 欄位：category, risk_level(low|medium|high), sentiment(positive|neutral|negative), summary, recommended_action, tags(array)。",
    JSON.stringify(compactMessages),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      input: prompt,
      temperature: 0.2,
      max_output_tokens: 600,
    }),
  });
  const text = await response.text();
  const data = parseJson(text, null);
  if (!response.ok) {
    return {
      category: "一般問題",
      risk_level: "medium",
      sentiment: "neutral",
      summary: "OpenAI 分析失敗",
      recommended_action: `檢查 API 狀態：HTTP ${response.status}`,
      tags: ["openai_error"],
      raw: data || text.slice(0, 1000),
    };
  }
  const outputText = extractOpenAiOutputText(data);
  const parsed = parseJson(outputText, null) || {};
  return normalizeAiInsight({ ...parsed, raw: data });
}

function extractOpenAiOutputText(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of Array.isArray(data.output) ? data.output : []) {
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function normalizeAiInsight(input) {
  const risk = ["low", "medium", "high"].includes(input.risk_level) ? input.risk_level : "low";
  const sentiment = ["positive", "neutral", "negative"].includes(input.sentiment) ? input.sentiment : "neutral";
  const tags = Array.isArray(input.tags) ? input.tags.map(item => String(item).trim()).filter(Boolean).slice(0, 10) : [];
  return {
    category: String(input.category || "一般問題").slice(0, 80),
    risk_level: risk,
    sentiment,
    summary: String(input.summary || "").slice(0, 1000),
    recommended_action: String(input.recommended_action || "").slice(0, 1000),
    tags,
    raw: input.raw || input,
  };
}

async function saveAiMonitorInsight(env, insight, messages, model) {
  const id = crypto.randomUUID();
  const threadId = String(messages[messages.length - 1]?.threadId || messages[0]?.threadId || "");
  const messageIds = messages.map(item => item.id).filter(Boolean);
  await env.DB.prepare(`
    INSERT INTO ai_monitor_insights (
      id, thread_id, source_message_ids, category, risk_level, summary,
      recommended_action, sentiment, tags, model, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    id,
    threadId,
    JSON.stringify(messageIds),
    insight.category,
    insight.risk_level,
    insight.summary,
    insight.recommended_action,
    insight.sentiment,
    insight.tags.join(","),
    model,
    JSON.stringify(insight.raw || {}),
  ).run();
  return { id, threadId, sourceMessageIds: messageIds, ...insight, model };
}

function aiMonitorConfig(env) {
  const enabled = String(env.AI_MONITOR_ENABLED || "true").toLowerCase() !== "false";
  return {
    enabled,
    apiKey: String(env.OPENAI_API_KEY || "").trim(),
    model: String(env.AI_MONITOR_MODEL || "gpt-4.1-mini").trim(),
    messageLimit: Math.min(100, Math.max(1, Number(env.AI_MONITOR_LINE_MESSAGE_LIMIT || 30) || 30)),
    categories: splitCsv(env.AI_MONITOR_CATEGORIES || "客訴,詢價,訂單,點數,業務歸屬,產品問題,付款,出貨,一般問題"),
    riskKeywords: splitCsv(env.AI_MONITOR_RISK_KEYWORDS || "客訴,退款,詐騙,沒有收到,業務問題,產品不良,我要退貨"),
  };
}

function splitCsv(value) {
  return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
}
async function monthlySalesReport(request, env) {
  requireDb(env);
  const url = new URL(request.url);
  const period = String(url.searchParams.get("period") || currentPeriod()).trim();
  const start = `${period}-01T00:00:00.000Z`;
  const end = nextPeriodStart(period);

  const { results } = await env.DB.prepare(`
    SELECT
      sr.id AS salesRepId,
      sr.sales_code AS salesCode,
      sr.name AS salesName,
      COUNT(o.id) AS orderCount,
      COALESCE(SUM(o.total), 0) AS totalAmount
    FROM sales_reps sr
    LEFT JOIN orders o
      ON o.sales_rep_id = sr.id
      AND o.ordered_at >= ?
      AND o.ordered_at < ?
      AND o.status <> 'cancelled'
    WHERE sr.status = 'active'
    GROUP BY sr.id, sr.sales_code, sr.name
    ORDER BY totalAmount DESC, orderCount DESC, sr.name ASC
  `).bind(start, end).all();

  return json({ ok: true, period, data: results || [] });
}

async function renderSalesInvitePage(request, env) {
  const url = new URL(request.url);
  const salesCode = normalizeSalesCode(url.searchParams.get("sales") || url.searchParams.get("ref") || "");
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gusys 業務綁定</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#0f172a}
    main{max-width:560px;margin:0 auto;padding:32px 20px}
    h1{font-size:28px;margin:0 0 12px}
    p{line-height:1.7;color:#475569}
    input,button{width:100%;box-sizing:border-box;border-radius:8px;font-size:16px;padding:12px 14px}
    input{border:1px solid #cbd5e1;margin:8px 0}
    button{border:0;background:#0f766e;color:white;font-weight:700;margin-top:10px}
    .box{background:white;border:1px solid #e2e8f0;border-radius:8px;padding:18px}
    .code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:700}
  </style>
</head>
<body>
  <main>
    <h1>Gusys 業務綁定</h1>
    <div class="box">
      <p>業務代碼：<span class="code" id="salesCode">${escapeHtml(salesCode || "未帶入")}</span></p>
      <p>LINE LIFF 串接完成後，這頁會自動取得 LINE UID 並綁定業務。現在可用下方欄位做測試。</p>
      <input id="lineUserId" placeholder="LINE User ID">
      <input id="displayName" placeholder="客戶姓名">
      <input id="phone" placeholder="電話">
      <button id="bind">建立綁定</button>
      <p id="result"></p>
    </div>
  </main>
  <script>
    const salesCode = ${JSON.stringify(salesCode)};
    document.getElementById("bind").addEventListener("click", async () => {
      const payload = {
        salesCode,
        lineUserId: document.getElementById("lineUserId").value.trim(),
        displayName: document.getElementById("displayName").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        source: "sales_invite_page"
      };
      const res = await fetch("/api/sales/bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      document.getElementById("result").textContent = data.ok ? "綁定完成" : "綁定失敗：" + (data.message || data.error);
    });
  </script>
</body>
</html>`, { headers: HTML_HEADERS });
}

function renderAdminPage(env) {
  const publicUrl = env.WORKER_PUBLIC_URL || "https://gusys.fangwl591021.workers.dev";
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gusys Admin</title><style>body{margin:0;background:#f6f7f9;color:#1f2937;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}header{background:#fff;border-bottom:1px solid #d9dee7;padding:14px 18px;position:sticky;top:0}main{max-width:1180px;margin:auto;padding:16px 18px 36px}h1{font-size:18px;margin:0}.muted{color:#667085}.tabs{display:flex;gap:8px;overflow:auto;margin-bottom:12px}.tab,button{border:1px solid #0f766e;border-radius:6px;background:#0f766e;color:#fff;padding:9px 12px;cursor:pointer}.tab{background:#fff;color:#344054;border-color:#d9dee7}.tab.active{background:#0f766e;color:#fff;border-color:#0f766e}input{border:1px solid #cfd6e1;border-radius:6px;padding:9px 10px}.bar{display:flex;justify-content:space-between;gap:12px;align-items:center}.actions{display:flex;gap:8px}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}.metric,.panel{background:#fff;border:1px solid #d9dee7;border-radius:8px}.metric{padding:14px}.metric span{display:block;color:#667085;font-size:12px}.metric strong{display:block;font-size:26px;margin-top:8px}.panel{margin-top:12px}.panel h2{font-size:15px;margin:0;padding:12px 14px;border-bottom:1px solid #d9dee7}.body{padding:14px}.view{display:none}.view.active{display:block}.form{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:720px}th,td{border-bottom:1px solid #edf0f5;text-align:left;padding:10px;vertical-align:top}th{font-size:12px;color:#667085;background:#fafbfc}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.pill{border-radius:999px;padding:3px 8px;font-size:12px;background:#fef3c7;color:#92400e}.pill.good{background:#dcfce7;color:#166534}.pill.bad{background:#fee2e2;color:#991b1b}.qr{width:70px;height:70px;border:1px solid #d9dee7;border-radius:6px}.log{white-space:pre-wrap;max-width:420px;color:#475467}.empty{text-align:center;color:#667085;padding:20px}@media(max-width:850px){.grid{grid-template-columns:repeat(2,1fr)}.form{grid-template-columns:1fr}.bar{align-items:flex-start;flex-direction:column}.actions{width:100%}.actions input{flex:1}}</style></head><body><header><div class="bar"><div><h1>Gusys Admin</h1><div class="muted">經銷商 LINE OA 控制台</div></div><div class="actions"><input id="adminToken" type="password" placeholder="Admin token"><button id="saveToken">儲存</button><button id="refreshAll">更新</button></div></div></header><main><nav class="tabs" id="tabs"><button class="tab active" data-view="dashboard">總覽</button><button class="tab" data-view="sales">業務 QR</button><button class="tab" data-view="customers">用戶歸屬</button><button class="tab" data-view="inventory">進銷存</button><button class="tab" data-view="messages">LINE 訊息</button><button class="tab" data-view="ai">AI 監控</button><button class="tab" data-view="webhooks">Webhook</button></nav><section class="view active" id="view-dashboard"><div class="grid" id="metrics"></div><section class="panel"><h2>最近母站轉送</h2><div class="body" id="latestMother"></div></section></section><section class="view" id="view-sales"><section class="panel"><h2>新增業務</h2><div class="body"><div class="form"><input id="salesName" placeholder="姓名"><input id="salesPhone" placeholder="電話"><input id="salesLine" placeholder="LINE User ID"><input id="salesCode" placeholder="業務代碼，可空白"></div><button id="createSales">建立業務 QR</button><span id="salesStatus" class="muted"></span></div></section><section class="panel"><h2>業務清單</h2><div class="body table-wrap"><table><thead><tr><th>業務</th><th>代碼</th><th>QR</th><th>連結</th><th>狀態</th></tr></thead><tbody id="salesRows"></tbody></table></div></section></section><section class="view" id="view-customers"><section class="panel"><h2>用戶歸屬</h2><div class="body table-wrap"><table><thead><tr><th>用戶</th><th>LINE UID</th><th>業務</th><th>電話</th><th>綁定時間</th></tr></thead><tbody id="customerRows"></tbody></table></div></section></section><section class="view" id="view-inventory"><section class="panel"><h2>新增商品</h2><div class="body"><div class="form"><input id="productSku" placeholder="SKU"><input id="productCategory" placeholder="分類"><input id="productName" placeholder="商品名稱"><input id="productPrice" type="number" placeholder="售價"><input id="productCost" type="number" placeholder="成本"><input id="productStock" type="number" placeholder="庫存"><input id="productSafety" type="number" placeholder="安全庫存"></div><button id="createProduct">建立商品</button><span id="productStatus" class="muted"></span></div></section><section class="panel"><h2>商品庫存</h2><div class="body table-wrap"><table><thead><tr><th>商品</th><th>SKU</th><th>分類</th><th>售價</th><th>庫存</th><th>狀態</th></tr></thead><tbody id="productRows"></tbody></table></div></section></section><section class="view" id="view-messages"><section class="panel"><h2>LINE 訊息</h2><div class="body"><button id="runAi">AI 分析最新訊息</button> <span id="aiRunStatus" class="muted"></span><div class="table-wrap"><table><thead><tr><th>時間</th><th>LINE UID</th><th>內容</th><th>Thread</th></tr></thead><tbody id="messageRows"></tbody></table></div></div></section></section><section class="view" id="view-ai"><section class="panel"><h2>AI 監控洞察</h2><div class="body table-wrap"><table><thead><tr><th>時間</th><th>風險</th><th>分類</th><th>摘要</th><th>建議</th></tr></thead><tbody id="aiRows"></tbody></table></div></section></section><section class="view" id="view-webhooks"><section class="panel"><h2>Webhook 診斷</h2><div class="body table-wrap"><table><thead><tr><th>時間</th><th>來源</th><th>訊息</th><th>母站</th><th>摘要</th></tr></thead><tbody id="webhookRows"></tbody></table></div></section></section></main><script>const publicUrl=${JSON.stringify(publicUrl)};let adminToken=localStorage.getItem('gusys_admin_token')||'';document.getElementById('adminToken').value=adminToken;const qs=s=>document.querySelector(s);const money=v=>new Intl.NumberFormat('zh-TW').format(Number(v||0));function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function authHeaders(){return adminToken?{'x-admin-token':adminToken}:{}}async function api(path,opt){const init=opt||{};init.headers=Object.assign({'content-type':'application/json'},authHeaders(),init.headers||{});const res=await fetch(path,init);const data=await res.json().catch(()=>({ok:false,error:'bad_json'}));if(!res.ok||!data.ok)throw new Error(data.error||data.message||('HTTP '+res.status));return data.data||data}document.getElementById('tabs').onclick=e=>{const b=e.target.closest('.tab');if(!b)return;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+b.dataset.view));};document.getElementById('saveToken').onclick=()=>{adminToken=qs('#adminToken').value.trim();localStorage.setItem('gusys_admin_token',adminToken);loadAll()};document.getElementById('refreshAll').onclick=()=>loadAll();document.getElementById('createSales').onclick=async()=>{try{await api('/api/sales/reps',{method:'POST',body:JSON.stringify({name:qs('#salesName').value,phone:qs('#salesPhone').value,lineUserId:qs('#salesLine').value,salesCode:qs('#salesCode').value})});qs('#salesStatus').textContent=' 已建立';await loadSales();await loadSummary()}catch(e){qs('#salesStatus').textContent=e.message}};document.getElementById('createProduct').onclick=async()=>{try{await api('/api/products',{method:'POST',body:JSON.stringify({sku:qs('#productSku').value,category:qs('#productCategory').value,name:qs('#productName').value,price:qs('#productPrice').value,cost:qs('#productCost').value,stockQty:qs('#productStock').value,safetyStockQty:qs('#productSafety').value})});qs('#productStatus').textContent=' 已建立';await loadProducts();await loadSummary()}catch(e){qs('#productStatus').textContent=e.message}};document.getElementById('runAi').onclick=async()=>{qs('#aiRunStatus').textContent='分析中';try{await api('/api/ai-monitor/analyze',{method:'POST',body:JSON.stringify({limit:30})});qs('#aiRunStatus').textContent='完成';await loadAi()}catch(e){qs('#aiRunStatus').textContent=e.message}};async function loadSummary(){const s=await api('/api/admin/summary');qs('#metrics').innerHTML=[['業務',s.sales],['用戶',s.customers],['商品',s.products],['LINE 訊息',s.messages],['母站轉送',s.webhooks],['高風險',s.highRisk]].map(x=>'<div class="metric"><span>'+esc(x[0])+'</span><strong>'+money(x[1])+'</strong></div>').join('');const lm=s.latestMother||{};qs('#latestMother').innerHTML='<div>Worker：<span class="mono">'+esc(publicUrl)+'</span></div><div>訊息：'+esc(lm.messageText)+'</div><div>時間：'+esc(lm.createdAt)+'</div><pre class="log">'+esc(lm.rawJson||'')+'</pre>'}async function loadSales(){const rows=await api('/api/sales/reps');qs('#salesRows').innerHTML=rows.map(r=>'<tr><td>'+esc(r.name)+'<div class="muted">'+esc(r.phone)+'</div></td><td class="mono">'+esc(r.salesCode)+'</td><td>'+(r.qrUrl?'<img class="qr" src="'+esc(r.qrUrl)+'">':'-')+'</td><td><a href="'+esc(r.inviteUrl)+'" target="_blank">開啟</a><div class="mono">'+esc(r.inviteUrl)+'</div></td><td><span class="pill good">'+esc(r.status)+'</span></td></tr>').join('')||'<tr><td colspan="5" class="empty">尚無業務</td></tr>'}async function loadCustomers(){const rows=await api('/api/admin/customers');qs('#customerRows').innerHTML=rows.map(r=>'<tr><td>'+esc(r.displayName||'-')+'</td><td class="mono">'+esc(r.lineUserId)+'</td><td>'+esc(r.salesName||'未綁定')+'<div class="mono">'+esc(r.salesCode||'')+'</div></td><td>'+esc(r.phone)+'</td><td>'+esc(r.boundAt||r.firstSeenAt)+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">尚無用戶</td></tr>'}async function loadProducts(){const rows=await api('/api/products');qs('#productRows').innerHTML=rows.map(r=>'<tr><td>'+esc(r.name)+'</td><td class="mono">'+esc(r.sku)+'</td><td>'+esc(r.category)+'</td><td>'+money(r.price)+'</td><td>'+money(r.stockQty)+' / '+money(r.safetyStockQty)+'</td><td><span class="pill">'+esc(r.status)+'</span></td></tr>').join('')||'<tr><td colspan="6" class="empty">尚無商品</td></tr>'}async function loadMessages(){const rows=await api('/api/admin/line-messages');qs('#messageRows').innerHTML=rows.map(r=>'<tr><td>'+esc(r.createdAt)+'</td><td class="mono">'+esc(r.senderId)+'</td><td>'+esc(r.messageText)+'</td><td class="mono">'+esc(r.threadId)+'</td></tr>').join('')||'<tr><td colspan="4" class="empty">尚無訊息</td></tr>'}async function loadWebhooks(){const rows=await api('/api/admin/webhooks');qs('#webhookRows').innerHTML=rows.map(r=>{const s=r.summary||{};const cls=s.invalidSignature?'bad':(s.hasReplyPayload?'good':'');return '<tr><td>'+esc(r.createdAt)+'</td><td>'+esc(r.source)+'</td><td>'+esc(r.messageText)+'</td><td>'+esc(r.motherStatus)+'</td><td><span class="pill '+cls+'">'+(s.invalidSignature?'簽章錯誤':(s.hasReplyPayload?'有回覆':'已送達'))+'</span><pre class="log">'+esc(s.bodyTail||'')+'</pre></td></tr>'}).join('')||'<tr><td colspan="5" class="empty">尚無紀錄</td></tr>'}async function loadAi(){const rows=await api('/api/ai-monitor/insights?limit=100');qs('#aiRows').innerHTML=rows.map(r=>'<tr><td>'+esc(r.createdAt)+'</td><td><span class="pill '+(r.riskLevel==='high'?'bad':r.riskLevel==='medium'?'':'good')+'">'+esc(r.riskLevel)+'</span></td><td>'+esc(r.category)+'</td><td>'+esc(r.summary)+'</td><td>'+esc(r.recommendedAction)+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">尚無 AI 洞察</td></tr>'}async function loadAll(){try{await Promise.all([loadSummary(),loadSales(),loadCustomers(),loadProducts(),loadMessages(),loadWebhooks(),loadAi()])}catch(e){qs('#latestMother').innerHTML='<span style="color:#b91c1c">'+esc(e.message)+'</span>'}}loadAll();</script></body></html>`, { headers: HTML_HEADERS });
}
function renderHome(env) {
  const publicUrl = env.WORKER_PUBLIC_URL || "https://gusys.fangwl591021.workers.dev";
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gusys 經銷商系統</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#0f172a}
    main{max-width:860px;margin:0 auto;padding:32px 20px}
    h1{font-size:30px;margin:0 0 8px}
    section{background:white;border:1px solid #e2e8f0;border-radius:8px;padding:18px;margin-top:16px}
    code{background:#f1f5f9;border-radius:6px;padding:2px 6px}
    li{margin:8px 0}
  </style>
</head>
<body>
  <main>
    <h1>Gusys 經銷商 LINE OA 系統</h1>
    <p>公司 > 業務 > 用戶；業務 QR 綁定後作為訂單業績歸屬依據。</p>
    <section>
      <h2>Webhook</h2>
      <ul>
        <li>LINE Webhook URL：<code>${escapeHtml(publicUrl)}/line-webhook</code></li>
        <li>診斷頁：<code>${escapeHtml(publicUrl)}/hub-test</code></li>
        <li>母站 webhook：<code>${escapeHtml(env.MOTHER_WEBHOOK_URL || "")}</code></li>
      </ul>
    </section>
    <section>
      <h2>第一階段功能</h2>
      <ul>
        <li>雙 webhook：LINE OA -> Gusys Worker -> 母站 10279</li>
        <li>LINE 訊息紀錄：D1 有綁定時寫入 line_threads / line_messages</li>
        <li>業務 QR：每位業務產生 invite URL 與 QR URL</li>
        <li>用戶歸屬：customer_sales_bindings 鎖定業務</li>
        <li>點數 adapter：會員建立、贈點/扣點、點數紀錄查詢</li>
        <li>AI 監控：LINE 訊息分類、摘要、風險標籤</li>
      </ul>
    </section>
  </main>
</body>
</html>`, { headers: HTML_HEADERS });
}

async function handleHubTest(env) {
  const motherUrl = env.MOTHER_WEBHOOK_URL || "";
  const mother = motherUrl
    ? await testMotherWebhook(motherUrl)
    : { configured: false, ok: false, status: 0 };

  return json({
    ok: true,
    worker: "gusys",
    time: new Date().toISOString(),
    bindings: {
      DB: Boolean(env.DB),
      LINE_CHANNEL_SECRET: Boolean(env.LINE_CHANNEL_SECRET),
      LINE_CHANNEL_ACCESS_TOKEN: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN),
      MOTHER_WEBHOOK_URL: Boolean(env.MOTHER_WEBHOOK_URL),
      MOTHER_LINE_CHANNEL_SECRET: Boolean(env.MOTHER_LINE_CHANNEL_SECRET),
      WETW_API_KEY: Boolean(env.WETW_API_KEY),
      WETW_SHOP_ID: Boolean(env.WETW_SHOP_ID),
      OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
    },
    wetw: wetwConfig(env).configured,
    motherWebhook: {
      url: motherUrl,
      ...mother,
    },
    line: {
      webhookUrl: `${env.WORKER_PUBLIC_URL || "https://gusys.fangwl591021.workers.dev"}/line-webhook`,
    },
  });
}

async function testMotherWebhook(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "HUB_TEST", source: "gusys" }),
    });
    return {
      configured: true,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      error: String(error?.message || error),
    };
  }
}

async function verifyLineSignature(rawBody, signature, secret) {
  if (!secret) return { ok: true, reason: "secret_not_configured" };
  if (!signature) return { ok: false, reason: "missing_signature" };

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = arrayBufferToBase64(digest);
  return {
    ok: timingSafeEqual(expected, signature),
    reason: "checked",
  };
}

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function recordWebhookDebug(env, key, value) {
  if (!env.GUSYS_KV) return;
  await env.GUSYS_KV.put(key, JSON.stringify(value), { expirationTtl: 86400 * 7 }).catch(() => {});
}

function buildSalesInviteUrl(env, salesCode) {
  const base = String(env.WORKER_PUBLIC_URL || "https://gusys.fangwl591021.workers.dev").replace(/\/+$/, "");
  const url = new URL(`${base}/sales/invite`);
  url.searchParams.set("sales", salesCode);
  url.searchParams.set("source", "sales_qr");
  return url.toString();
}

function buildQrUrl(inviteUrl) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=18&data=${encodeURIComponent(inviteUrl)}`;
}

function makeSalesCode(name) {
  const base = String(name || "SALES")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 10)
    .toUpperCase() || "SALES";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${base}-${suffix}`;
}

function normalizeSalesCode(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .toUpperCase()
    .slice(0, 40);
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function nextPeriodStart(period) {
  const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return new Date().toISOString();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const next = month === 12
    ? new Date(Date.UTC(year + 1, 0, 1))
    : new Date(Date.UTC(year, month, 1));
  return next.toISOString();
}

function requireDb(env) {
  if (!env.DB) throw new Error("D1 DB binding is not configured");
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHookteaAdminPage(env) {
  const publicUrl = env.WORKER_PUBLIC_URL || "https://gusys.fangwl591021.workers.dev";
  const motherUrl = env.MOTHER_WEBHOOK_URL || "";
  const lineWebhookUrl = `${publicUrl}/line-webhook`;
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Gusys 管理站</title>
  <style>
    :root{--line:#06c755;--dark:#111827;--muted:#6b7280;--border:#e5e7eb;--bg:#f5f6f8;--danger:#dc2626;--warn:#b45309}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--dark);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}button,input{font:inherit}
    .sidebar{position:fixed;inset:0 auto 0 0;width:240px;background:#fff;border-right:1px solid var(--border);z-index:20;display:flex;flex-direction:column}.sidebar-brand{padding:18px;border-bottom:1px solid var(--border)}.brand-title{font-size:20px;font-weight:800}.brand-subtitle{margin-top:4px;color:var(--muted)}.nav{padding:14px 10px;overflow:auto}.nav-group-header{padding:14px 10px 8px;color:#374151;font-size:12px;font-weight:800;letter-spacing:.04em}.nav-item{width:100%;border:0;background:transparent;border-radius:8px;color:#111827;display:flex;align-items:center;gap:10px;padding:10px 12px;text-align:left;cursor:pointer}.nav-item:hover{background:#f3f4f6}.nav-active{background:#e9fbea;color:#047a32;font-weight:800}
    .main-content{margin-left:240px;min-height:100vh}.page-header{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.96);border-bottom:1px solid var(--border);padding:14px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px}.page-title{font-size:21px;font-weight:800}.page-subtitle{margin-top:3px;color:var(--muted)}.header-actions{display:flex;align-items:center;gap:8px}.content{padding:20px 22px 36px;max-width:1280px}.view{display:none}.view.active{display:block}
    .stats-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:14px}.stat-card,.panel{background:#fff;border:1px solid var(--border);border-radius:8px}.stat-card{padding:16px}.stat-label{color:var(--muted);font-size:13px}.stat-value{font-size:30px;font-weight:800;margin-top:8px}.panel{margin-bottom:14px;overflow:hidden}.panel-header{padding:13px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px}.section-title{font-size:16px;font-weight:800}.panel-body{padding:16px}.admin-table-container{overflow:auto}.admin-table{width:100%;border-collapse:collapse;min-width:760px}.admin-table th,.admin-table td{padding:11px 12px;border-bottom:1px solid #edf0f3;text-align:left;vertical-align:top}.admin-table th{background:#fafafa;color:#667085;font-size:12px;font-weight:800}.admin-table tr:hover td{background:#fbfbfb}
    .form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}input{border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:10px 11px;min-width:0}.btn-green-main{border:1px solid #079447;background:var(--line);color:#fff;border-radius:8px;padding:10px 14px;font-weight:800;cursor:pointer}.btn-outline{border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:8px;padding:10px 14px;cursor:pointer}.btn-small{padding:7px 10px;border-radius:7px}.status-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;background:#ecfdf3;color:#067647;font-size:12px;font-weight:800}.status-badge.warn{background:#fffaeb;color:var(--warn)}.status-badge.danger{background:#fef2f2;color:var(--danger)}.muted{color:var(--muted)}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.empty{padding:24px;text-align:center;color:var(--muted)}.ops-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.ops-item{border:1px solid var(--border);border-radius:8px;padding:14px;background:#fff}.ops-label{color:var(--muted);font-size:13px}.ops-value{margin-top:6px;font-weight:800;word-break:break-all}.qr{width:76px;height:76px;border:1px solid var(--border);border-radius:8px;background:#fff}.summary-text{max-width:360px;white-space:normal;word-break:break-word}.login-cover{position:fixed;inset:0;background:rgba(17,24,39,.34);z-index:50;display:none;align-items:center;justify-content:center;padding:18px}.login-box{width:min(420px,100%);background:#fff;border-radius:10px;border:1px solid var(--border);padding:20px}.login-title{font-size:20px;font-weight:800;margin-bottom:6px}.login-box input{width:100%;margin:14px 0 10px}
    .crm-toolbar{padding:18px 0;display:flex;align-items:center;gap:14px;border-bottom:1px solid #eef2f7}.crm-search{width:min(480px,100%);font-weight:800;color:#334155}.member-cell{display:flex;align-items:center;gap:14px}.member-avatar{width:50px;height:50px;border-radius:999px;background:#f1f5f9;border:1px solid #dbe3ee;display:inline-flex;align-items:center;justify-content:center;color:#64748b;font-weight:900;overflow:hidden;object-fit:cover}.member-name{font-size:16px;font-weight:900;color:#0f172a}.crm-action{background:#eff6ff;color:#1d4ed8;border:0;border-radius:6px;padding:8px 13px;font-weight:900;cursor:pointer}.tier-badge{display:inline-flex;padding:6px 10px;border-radius:6px;background:#fff7ed;border:1px solid #fed7aa;color:#c2410c;font-weight:900}.crm-modal-mask{position:fixed;inset:0;background:rgba(15,23,42,.32);z-index:100;display:none;align-items:flex-start;justify-content:center;overflow:auto}.crm-modal-body{width:min(1180px,calc(100vw - 36px));margin:18px auto;background:#f8fafc;border-radius:0 0 10px 10px;box-shadow:0 24px 60px rgba(15,23,42,.24);overflow:hidden}.crm-modal-header{height:90px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;padding:0 28px}.crm-modal-title{display:flex;align-items:center;gap:14px;font-size:24px;font-weight:900}.crm-member-id{font-size:13px;background:#f1f5f9;border:1px solid #dbe3ee;border-radius:10px;padding:9px 14px;color:#64748b;font-weight:900}.crm-close{border:0;background:transparent;color:#94a3b8;font-size:36px;line-height:1;cursor:pointer}.crm-modal-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(360px,.8fr);gap:38px;padding:40px}.crm-card{background:#fff;border:1px solid #dbe3ee;border-radius:18px;box-shadow:0 1px 2px rgba(15,23,42,.04);overflow:hidden}.crm-card-body{padding:30px}.crm-card-title{font-size:22px;font-weight:900;margin-bottom:20px;color:#172033}.crm-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px 24px}.crm-label{display:block;color:#64748b;font-weight:900;margin-bottom:8px}.crm-input{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:14px 16px;font-weight:900;color:#0f172a}.crm-tag-grid{border:1px solid #dbe3ee;background:#f8fafc;border-radius:14px;padding:14px;display:flex;gap:10px;flex-wrap:wrap}.crm-tag{border:1px solid #dbe3ee;background:#fff;border-radius:999px;padding:8px 14px;font-weight:900;color:#334155}.point-summary{text-align:center;position:relative;padding:32px}.point-label{font-weight:900;color:#94a3b8}.point-balance{font-size:52px;font-weight:900;color:#dc2626;margin:14px 0 26px}.point-actions{display:flex;gap:14px}.point-btn{flex:1;border-radius:12px;padding:16px;border:1px solid;font-weight:900;cursor:pointer}.point-add{background:#ecfdf3;border-color:#bbf7d0;color:#16a34a}.point-deduct{background:#fff1f2;border-color:#fecdd3;color:#dc2626}.point-history{height:318px;overflow:auto}.point-log{display:flex;justify-content:space-between;gap:16px;padding:18px 24px;border-bottom:1px solid #eef2f7}.point-log-title{font-weight:900;color:#1e293b}.point-log-date{font-size:12px;color:#94a3b8;margin-top:4px}.point-log-amt{font-size:20px;font-weight:900}.crm-modal-footer{background:#fff;border-top:1px solid #e2e8f0;padding:24px 34px;display:flex;justify-content:flex-end;gap:24px}.crm-save{min-width:230px;box-shadow:0 16px 30px rgba(6,199,85,.22)}
    @media(max-width:980px){.sidebar{position:static;width:auto}.main-content{margin-left:0}.page-header{position:static;align-items:flex-start;flex-direction:column}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ops-list{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.header-actions{width:100%;flex-wrap:wrap}.header-actions input{flex:1}.crm-modal-grid{grid-template-columns:1fr;padding:18px}.crm-field-grid{grid-template-columns:1fr}.crm-modal-header{height:auto;padding:18px;align-items:flex-start}.crm-modal-title{font-size:18px}.point-actions{flex-direction:column}}
  </style>
</head>
<body>
  <aside class="sidebar"><div class="sidebar-brand"><div class="brand-title">Gusys 管理站</div><div class="brand-subtitle">HookTea 架構 / 經銷商 OA</div></div><nav class="nav" id="nav"><div class="nav-group-header">營運中心</div><button class="nav-item nav-active" data-view="dashboard">營運統計</button><button class="nav-item" data-view="customers">客戶 CRM</button><button class="nav-item" data-view="inventory">商城商品</button><button class="nav-item" data-view="orders">訂單維護</button><button class="nav-item" data-view="points">點數總表</button><div class="nav-group-header">經銷商中心</div><button class="nav-item" data-view="sales">業務 QR</button><button class="nav-item" data-view="reports">業績報表</button><div class="nav-group-header">營運工具</div><button class="nav-item" data-view="messages">LINE 訊息</button><button class="nav-item" data-view="ai">AI 後台監控</button><button class="nav-item" data-view="richmenu">圖文選單</button><button class="nav-item" data-view="webhooks">雙 Webhook</button><button class="nav-item" data-view="audit">操作紀錄</button><button class="nav-item" data-view="settings">系統設定</button></nav></aside>
  <main class="main-content"><header class="page-header"><div><div class="page-title" id="pageTitle">營運統計</div><div class="page-subtitle" id="pageSubtitle">以 HookTea 後台結構管理 CRM、商城、點數與經銷商歸屬</div></div><div class="header-actions"><span class="status-badge" id="systemStatus">連線中</span><input id="adminToken" type="password" placeholder="Admin token"><button class="btn-outline" id="saveToken">儲存</button><button class="btn-green-main" id="refreshAll">更新</button></div></header><div class="content">
    <section class="view active" id="view-dashboard"><div class="stats-grid" id="metrics"></div><section class="panel"><div class="panel-header"><div class="section-title">營運摘要</div><span class="muted" id="lastRefresh"></span></div><div class="panel-body"><div class="ops-list" id="opsSummary"></div></div></section><section class="panel"><div class="panel-header"><div class="section-title">最近 LINE 訊息</div><button class="btn-outline btn-small" data-jump="messages">查看全部</button></div><div class="admin-table-container"><table class="admin-table"><thead><tr><th>時間</th><th>用戶</th><th>內容</th><th>Thread</th></tr></thead><tbody id="dashboardMessages"></tbody></table></div></section></section>
    <section class="view" id="view-sales"><section class="panel"><div class="panel-header"><div class="section-title">新增業務與專屬 QR</div><span class="muted" id="salesStatus"></span></div><div class="panel-body"><div class="form-grid"><input id="salesName" placeholder="業務姓名"><input id="salesPhone" placeholder="電話"><input id="salesLine" placeholder="LINE User ID"><input id="salesCode" placeholder="業務代碼，可空白"></div><button class="btn-green-main" id="createSales">建立業務 QR</button></div></section><section class="panel"><div class="panel-header"><div class="section-title">業務清單</div></div><div class="admin-table-container"><table class="admin-table"><thead><tr><th>業務</th><th>代碼</th><th>QR</th><th>邀請連結</th><th>狀態</th></tr></thead><tbody id="salesRows"></tbody></table></div></section></section>
    <section class="view" id="view-customers"><section class="panel"><div class="panel-header"><div class="section-title">客戶 CRM</div></div><div class="crm-toolbar"><input id="customerSearch" class="crm-search" placeholder="搜尋姓名、電話、ID..."><button class="btn-outline">隱藏名單</button><button class="btn-outline" id="syncProfiles">重新同步 LINE 資料</button><button class="btn-green-main">會員 Excel 下載</button><span class="muted" id="syncProfileStatus"></span></div><div class="admin-table-container"><table class="admin-table"><thead><tr><th>姓名</th><th>LINE UID</th><th>目前等級</th><th>註冊日期</th><th>操作</th></tr></thead><tbody id="customerRows"></tbody></table></div></section></section>
    <section class="view" id="view-inventory"><section class="panel"><div class="panel-header"><div class="section-title">新增商品</div><span class="muted" id="productStatus"></span></div><div class="panel-body"><div class="form-grid"><input id="productSku" placeholder="SKU"><input id="productCategory" placeholder="分類"><input id="productName" placeholder="商品名稱"><input id="productPrice" type="number" placeholder="售價"><input id="productCost" type="number" placeholder="成本"><input id="productStock" type="number" placeholder="庫存"><input id="productSafety" type="number" placeholder="安全庫存"></div><button class="btn-green-main" id="createProduct">建立商品</button></div></section><section class="panel"><div class="panel-header"><div class="section-title">商品庫存</div></div><div class="admin-table-container"><table class="admin-table"><thead><tr><th>商品</th><th>SKU</th><th>分類</th><th>售價</th><th>庫存</th><th>狀態</th></tr></thead><tbody id="productRows"></tbody></table></div></section></section>
    <section class="view" id="view-reports"><section class="panel"><div class="panel-header"><div class="section-title">每月業績報表</div><div><input id="reportPeriod" type="month"><button class="btn-outline btn-small" id="loadReport">查詢</button></div></div><div class="admin-table-container"><table class="admin-table"><thead><tr><th>業務</th><th>代碼</th><th>訂單數</th><th>營收</th><th>毛利</th></tr></thead><tbody id="reportRows"></tbody></table></div></section></section>
    <section class="view" id="view-orders"><section class="panel"><div class="panel-header"><div class="section-title">訂單維護</div><span class="status-badge warn">待串接</span></div><div class="panel-body"><div class="ops-list"><div class="ops-item"><div class="ops-label">HookTea 對應功能</div><div class="ops-value">訂單查詢、付款狀態、出貨狀態、取消保護</div></div><div class="ops-item"><div class="ops-label">Gusys 下一步</div><div class="ops-value">建立 orders / order_items，並綁定 sales_rep_id 供業績歸屬</div></div><div class="ops-item"><div class="ops-label">目前來源</div><div class="ops-value">尚未有 Gusys 訂單 API</div></div></div></div></section></section>
    <section class="view" id="view-points"><section class="panel"><div class="panel-header"><div class="section-title">點數總表</div><span class="status-badge warn">母站 API</span></div><div class="panel-body"><div class="ops-list"><div class="ops-item"><div class="ops-label">已設定</div><div class="ops-value">/api/points/adjust、/api/points/list</div></div><div class="ops-item"><div class="ops-label">用途</div><div class="ops-value">查詢會員點數、贈點、扣點，對接 AIWE / WETW 點數系統</div></div><div class="ops-item"><div class="ops-label">下一步</div><div class="ops-value">加入會員搜尋欄與點數異動表格</div></div></div></div></section></section>
    <section class="view" id="view-messages"><section class="panel"><div class="panel-header"><div class="section-title">LINE 訊息紀錄</div><div><button class="btn-green-main btn-small" id="runAi">AI 分析最新訊息</button> <span class="muted" id="aiRunStatus"></span></div></div><div class="admin-table-container"><table class="admin-table"><thead><tr><th>時間</th><th>LINE UID</th><th>內容</th><th>Thread</th></tr></thead><tbody id="messageRows"></tbody></table></div></section></section>
    <section class="view" id="view-ai"><section class="panel"><div class="panel-header"><div class="section-title">AI 後台監控</div></div><div class="admin-table-container"><table class="admin-table"><thead><tr><th>時間</th><th>風險</th><th>分類</th><th>摘要</th><th>建議動作</th></tr></thead><tbody id="aiRows"></tbody></table></div></section></section>
    <section class="view" id="view-webhooks"><section class="panel"><div class="panel-header"><div class="section-title">雙 Webhook 轉送狀態</div><span class="muted">LINE OA -> Gusys Worker -> 母站</span></div><div class="admin-table-container"><table class="admin-table"><thead><tr><th>時間</th><th>來源</th><th>訊息</th><th>母站狀態</th><th>摘要</th></tr></thead><tbody id="webhookRows"></tbody></table></div></section></section>
    <section class="view" id="view-richmenu"><section class="panel"><div class="panel-header"><div class="section-title">圖文選單</div><span class="status-badge warn">規劃中</span></div><div class="panel-body"><div class="ops-list"><div class="ops-item"><div class="ops-label">HookTea 對應功能</div><div class="ops-value">圖文選單管理、LIFF 入口、Postback 綁定</div></div><div class="ops-item"><div class="ops-label">Gusys 建議入口</div><div class="ops-value">會員分享、業務綁定、點數查詢、商品/訂單</div></div><div class="ops-item"><div class="ops-label">下一步</div><div class="ops-value">串 LINE rich menu API 與後台可視化設定</div></div></div></div></section></section>
    <section class="view" id="view-audit"><section class="panel"><div class="panel-header"><div class="section-title">操作紀錄</div><span class="status-badge">Webhook 事件</span></div><div class="admin-table-container"><table class="admin-table"><thead><tr><th>類型</th><th>目前紀錄來源</th><th>狀態</th></tr></thead><tbody><tr><td>LINE 訊息</td><td>/api/admin/line-messages</td><td>已串接</td></tr><tr><td>母站轉送</td><td>/api/admin/webhooks</td><td>已串接</td></tr><tr><td>後台操作</td><td>audit_logs</td><td>待建立</td></tr></tbody></table></div></section></section>
    <section class="view" id="view-settings"><section class="panel"><div class="panel-header"><div class="section-title">系統設定</div></div><div class="panel-body"><div class="ops-list"><div class="ops-item"><div class="ops-label">Worker</div><div class="ops-value mono">${escapeHtml(publicUrl)}</div></div><div class="ops-item"><div class="ops-label">LINE Webhook</div><div class="ops-value mono">${escapeHtml(lineWebhookUrl)}</div></div><div class="ops-item"><div class="ops-label">母站 Webhook</div><div class="ops-value mono">${escapeHtml(motherUrl)}</div></div></div><p class="muted">若有設定 ADMIN_TOKEN，後台 API 會要求輸入 token；未設定時可直接讀取。</p></div></section></section>
  </div></main><div class="crm-modal-mask" id="crmModal">
  <div class="crm-modal-body">
    <div class="crm-modal-header">
      <div class="crm-modal-title">
        <span class="member-avatar" id="crmAvatar">會</span>
        <span id="crmTitle">會員檔案</span>
        <span class="crm-member-id" id="crmMemberId">LINE UID</span>
      </div>
      <button class="crm-close" id="crmClose">×</button>
    </div>
    <div class="crm-modal-grid">
      <section class="crm-card">
        <div class="crm-card-body">
          <div class="crm-card-title">基本資料</div>
          <div class="crm-field-grid">
            <div><label class="crm-label">LINE 名稱</label><input id="crmName" class="crm-input"></div>
            <div><label class="crm-label">LINE UID</label><input id="crmUid" class="crm-input" readonly></div>
            <div><label class="crm-label">業務歸屬</label><input id="crmSales" class="crm-input" readonly></div>
            <div><label class="crm-label">註冊日期</label><input id="crmDate" class="crm-input" readonly></div>
            <div style="grid-column:1/-1"><label class="crm-label">會員標籤（可複選）</label><div class="crm-tag-grid" id="crmTags"></div></div>
          </div>
        </div>
      </section>
      <div>
        <section class="crm-card">
          <div class="point-summary">
            <div class="point-label">可用紅包餘額</div>
            <div class="point-balance"><span id="pointBalance">0</span> <span style="font-size:18px;color:#94a3b8">點</span></div>
            <div class="point-actions">
              <button class="point-btn point-add" id="grantPoints">＋ 贈點</button>
              <button class="point-btn point-deduct" id="deductPoints">－ 扣點</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">
              <input id="pointAmount" class="crm-input" type="number" placeholder="點數">
              <input id="pointReason" class="crm-input" placeholder="原因">
            </div>
            <div class="muted" id="pointStatus" style="margin-top:10px">尚未讀取</div>
          </div>
        </section>
        <section class="crm-card" style="margin-top:28px">
          <div class="panel-header"><div class="section-title">紅包歷史紀錄</div></div>
          <div class="point-history" id="pointRows"></div>
        </section>
      </div>
    </div>
    <div class="crm-modal-footer">
      <button class="btn-outline" id="crmCancel">取消</button>
      <button class="btn-green-main crm-save" id="crmSave">儲存檔案變更</button>
    </div>
  </div>
</div><div class="login-cover" id="loginCover"><div class="login-box"><div class="login-title">需要 Admin token</div><div class="muted">請輸入 Worker 環境變數 ADMIN_TOKEN。</div><input id="loginToken" type="password" placeholder="Admin token"><button class="btn-green-main" id="loginSubmit">進入後台</button></div></div>
  <script>
    const publicUrl = ${JSON.stringify(publicUrl)}; const motherUrl = ${JSON.stringify(motherUrl)};
    const titles = {dashboard:["營運統計","即時掌握業務、客戶、商品、LINE 訊息與母站轉送"],sales:["業務 QR","建立業務專屬 QR，作為日後業績歸屬依據"],customers:["客戶 CRM","所有加入官方帳號者自動建檔，並追蹤互動與業務歸屬"],inventory:["商城商品","管理商品、售價、成本與安全庫存"],reports:["業績報表","每月業務績效與毛利彙整"],orders:["訂單維護","HookTea 同款訂單工作區，待串接 Gusys 訂單資料表"],points:["點數總表","對接母站點數 API，集中查詢會員點數紀錄"],messages:["LINE 訊息","查詢 LINE OA 對話紀錄"],ai:["AI 後台監控","追蹤高風險訊息、分類與建議動作"],webhooks:["雙 Webhook","查看母站轉送狀態，不顯示整段 HTML 原始碼"],richmenu:["圖文選單","規劃 LINE 圖文選單與 LIFF 入口"],audit:["操作紀錄","記錄後台操作與 webhook 重要事件"],settings:["系統設定","確認 Worker、LINE Webhook 與母站 Webhook"]};
    let adminToken = localStorage.getItem("gusys_admin_token") || ""; let adminCustomers = []; let activeCustomer = null; const qs = s => document.querySelector(s); const qsa = s => Array.from(document.querySelectorAll(s));
    const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); const money = v => new Intl.NumberFormat("zh-TW").format(Number(v || 0));
    qs("#adminToken").value = adminToken; function headers(){ return adminToken ? {"x-admin-token":adminToken} : {}; } function badge(text,tone){ return '<span class="status-badge '+(tone||"")+'">'+esc(text)+'</span>'; }
    async function api(path,opt){ const init = opt || {}; init.headers = Object.assign({"content-type":"application/json"}, headers(), init.headers || {}); const res = await fetch(path, init); const data = await res.json().catch(() => ({ok:false,error:"bad_json"})); if(!res.ok || !data.ok){ const err = new Error(data.error || data.message || ("HTTP "+res.status)); err.status = res.status; throw err; } return data.data || data; }
    function setView(view){ qsa(".nav-item").forEach(btn => btn.classList.toggle("nav-active", btn.dataset.view === view)); qsa(".view").forEach(section => section.classList.toggle("active", section.id === "view-" + view)); const title = titles[view] || titles.dashboard; qs("#pageTitle").textContent = title[0]; qs("#pageSubtitle").textContent = title[1]; }
    qs("#nav").addEventListener("click", e => { const btn = e.target.closest(".nav-item"); if(btn) setView(btn.dataset.view); }); document.body.addEventListener("click", e => { const jump = e.target.closest("[data-jump]"); if(jump) setView(jump.dataset.jump); });
    qs("#saveToken").onclick = () => { adminToken = qs("#adminToken").value.trim(); localStorage.setItem("gusys_admin_token", adminToken); qs("#loginCover").style.display = "none"; loadAll(); }; qs("#loginSubmit").onclick = () => { adminToken = qs("#loginToken").value.trim(); qs("#adminToken").value = adminToken; localStorage.setItem("gusys_admin_token", adminToken); qs("#loginCover").style.display = "none"; loadAll(); }; qs("#refreshAll").onclick = () => loadAll();
    qs("#createSales").onclick = async () => { try{ await api("/api/sales/reps",{method:"POST",body:JSON.stringify({name:qs("#salesName").value,phone:qs("#salesPhone").value,lineUserId:qs("#salesLine").value,salesCode:qs("#salesCode").value})}); qs("#salesStatus").textContent = "已建立"; await Promise.all([loadSales(),loadSummary()]); }catch(err){ qs("#salesStatus").textContent = err.message; } };
    qs("#createProduct").onclick = async () => { try{ await api("/api/products",{method:"POST",body:JSON.stringify({sku:qs("#productSku").value,category:qs("#productCategory").value,name:qs("#productName").value,price:qs("#productPrice").value,cost:qs("#productCost").value,stockQty:qs("#productStock").value,safetyStockQty:qs("#productSafety").value})}); qs("#productStatus").textContent = "已建立"; await Promise.all([loadProducts(),loadSummary()]); }catch(err){ qs("#productStatus").textContent = err.message; } };
    qs("#runAi").onclick = async () => { qs("#aiRunStatus").textContent = "分析中"; try{ await api("/api/ai-monitor/analyze",{method:"POST",body:JSON.stringify({limit:30})}); qs("#aiRunStatus").textContent = "完成"; await loadAi(); }catch(err){ qs("#aiRunStatus").textContent = err.message; } }; qs("#loadReport").onclick = () => loadReports(); qs("#customerSearch").addEventListener("input", () => renderCustomers()); qs("#crmClose").onclick = closeCrmModal; qs("#crmCancel").onclick = closeCrmModal; qs("#crmSave").onclick = closeCrmModal; qs("#syncProfiles").onclick = syncProfiles; qs("#grantPoints").onclick = () => submitPointAdjust("earn"); qs("#deductPoints").onclick = () => submitPointAdjust("spend");
    function showUnauthorized(){ qs("#systemStatus").textContent = "需要 token"; qs("#systemStatus").className = "status-badge warn"; qs("#loginCover").style.display = "flex"; } function tableEmpty(cols,text){ return '<tr><td colspan="'+cols+'" class="empty">'+esc(text)+'</td></tr>'; }
    async function loadSummary(){ const s = await api("/api/admin/summary"); qs("#metrics").innerHTML = [["業務",s.sales],["用戶",s.customers],["商品",s.products],["LINE 訊息",s.messages],["母站轉送",s.webhooks],["高風險",s.highRisk]].map(i => '<div class="stat-card"><div class="stat-label">'+esc(i[0])+'</div><div class="stat-value">'+money(i[1])+'</div></div>').join(""); const latest = s.latestMother || {}; const motherState = latest.motherStatus ? "HTTP " + latest.motherStatus : "尚無紀錄"; qs("#opsSummary").innerHTML = [["Worker",publicUrl],["LINE Webhook",publicUrl+"/line-webhook"],["母站 Webhook",motherUrl],["最近母站轉送",motherState],["最近訊息",latest.messageText||"尚無"],["最近時間",latest.createdAt||"尚無"]].map(i => '<div class="ops-item"><div class="ops-label">'+esc(i[0])+'</div><div class="ops-value">'+esc(i[1])+'</div></div>').join(""); qs("#lastRefresh").textContent = new Date().toLocaleString("zh-TW"); qs("#systemStatus").textContent = "正常"; qs("#systemStatus").className = "status-badge"; }
    async function loadSales(){ const rows = await api("/api/sales/reps"); qs("#salesRows").innerHTML = rows.map(r => '<tr><td><strong>'+esc(r.name)+'</strong><div class="muted">'+esc(r.phone)+'</div></td><td class="mono">'+esc(r.salesCode)+'</td><td>'+(r.qrUrl?'<img class="qr" src="'+esc(r.qrUrl)+'" alt="QR">':"-")+'</td><td><a href="'+esc(r.inviteUrl)+'" target="_blank">開啟</a><div class="mono summary-text">'+esc(r.inviteUrl)+'</div></td><td>'+badge(r.status||"active")+'</td></tr>').join("") || tableEmpty(5,"尚無業務"); }
    async function loadCustomers(){ adminCustomers = await api("/api/admin/customers"); renderCustomers(); } function displayMemberName(r){ const name = String(r.displayName || "").trim(); const uid = String(r.lineUserId || "").trim(); return name && name !== uid ? name : "LINE 會員"; } function memberInitial(r){ return displayMemberName(r).trim().slice(0,1).toUpperCase(); } function memberAvatarHtml(r){ return r.pictureUrl ? '<img class="member-avatar" src="'+esc(r.pictureUrl)+'" alt="">' : '<span class="member-avatar">'+esc(memberInitial(r))+'</span>'; } function renderCustomers(){ const q = (qs("#customerSearch")?.value || "").trim().toLowerCase(); const rows = adminCustomers.filter(r => !q || [displayMemberName(r),r.displayName,r.lineUserId,r.salesName,r.salesCode].join(" ").toLowerCase().includes(q)); qs("#customerRows").innerHTML = rows.map(r => '<tr><td><div class="member-cell">'+memberAvatarHtml(r)+'<div><div class="member-name">'+esc(displayMemberName(r))+'</div><div class="muted">'+esc(r.status||"active")+'</div></div></div></td><td class="mono">'+esc(r.lineUserId)+'</td><td><span class="tier-badge">一般會員</span></td><td>'+esc((r.firstSeenAt||"").slice(0,10))+'</td><td><button class="crm-action" data-crm="'+esc(r.lineUserId)+'">CRM 檔案</button></td></tr>').join("") || tableEmpty(5,"尚無會員"); qsa("[data-crm]").forEach(btn => btn.onclick = () => openCustomerDetail(btn.dataset.crm)); } async function syncProfiles(){ qs("#syncProfileStatus").textContent = "同步中"; try{ const result = await api("/api/admin/customers/sync-profiles",{method:"POST",body:JSON.stringify({limit:200})}); qs("#syncProfileStatus").textContent = "已更新 " + money(result.updated || 0) + " 位"; await loadCustomers(); }catch(err){ qs("#syncProfileStatus").textContent = err.message; } } function closeCrmModal(){ activeCustomer = null; qs("#crmModal").style.display = "none"; } async function openCustomerDetail(lineUserId){ activeCustomer = adminCustomers.find(r => r.lineUserId === lineUserId); if(!activeCustomer) return; qs("#crmModal").style.display = "flex"; qs("#crmAvatar").outerHTML = activeCustomer.pictureUrl ? '<img class="member-avatar" id="crmAvatar" src="'+esc(activeCustomer.pictureUrl)+'" alt="">' : '<span class="member-avatar" id="crmAvatar">'+esc(memberInitial(activeCustomer))+'</span>'; qs("#crmTitle").textContent = "會員檔案：" + displayMemberName(activeCustomer); qs("#crmMemberId").textContent = "LINE UID：" + activeCustomer.lineUserId; qs("#crmName").value = displayMemberName(activeCustomer) === "LINE 會員" ? "" : displayMemberName(activeCustomer); qs("#crmUid").value = activeCustomer.lineUserId; qs("#crmSales").value = (activeCustomer.salesName||"未綁定") + (activeCustomer.salesCode ? " / " + activeCustomer.salesCode : ""); qs("#crmDate").value = (activeCustomer.firstSeenAt||"").slice(0,10); qs("#crmTags").innerHTML = ["一般會員","VIP","團購主","企業客戶","經銷夥伴","LINE 會員","購物會員","點數轉入","高風險","黑名單","A-首購客","B-回購客","C-潛在顧客"].map(t => '<span class="crm-tag">'+esc(t)+'</span>').join(""); await loadCustomerPoints(); } function normalizePointLogs(result){ const nested = result?.data?.data?.data || result?.data?.data || result?.data || {}; return Array.isArray(result.logs) ? result.logs : (Array.isArray(nested.list) ? nested.list : (Array.isArray(result.items) ? result.items : [])); } function pointAmount(log){ return Number(log.get_point||log.points||log.amount||log.point||0) || 0; } function pointBalance(result, logs){ const first = logs[0] || {}; return Number(result.balance ?? first.point_balance ?? first.balance ?? first.after_balance ?? 0) || 0; } function pointEmptyReason(result){ const query = result.query || result?.data?.data?.data?.query || {}; if(result.ok && Number(result?.pagination?.total || 0) === 0) return "母站查得到會員，但此 LINE UID 目前沒有點數紀錄"; return result.message || result.error || "目前尚無紀錄"; } async function loadCustomerPoints(){ if(!activeCustomer) return; qs("#pointStatus").textContent = "點數讀取中"; qs("#pointBalance").textContent = "0"; try{ const result = await api("/api/points/list?lineUserId=" + encodeURIComponent(activeCustomer.lineUserId)); const logs = normalizePointLogs(result); const balance = pointBalance(result, logs); qs("#pointBalance").textContent = money(balance); qs("#pointStatus").textContent = result.skipped ? (result.error || "點數 API 尚未設定") : "點數已更新"; qs("#pointRows").innerHTML = logs.map(log => { const amt = pointAmount(log); const sign = amt >= 0 ? "+" : "-"; return '<div class="point-log"><div><div class="point-log-title">'+esc(log.event_content||log.eventContent||log.reason||log.event_name||log.eventName||"點數異動")+'</div><div class="point-log-date">'+esc(log.created_at||log.createdAt||log.date||"")+'</div></div><div class="point-log-amt" style="color:'+(amt>=0?'#06c755':'#dc2626')+'">'+sign+money(Math.abs(amt))+'</div></div>'; }).join("") || '<div class="empty">'+esc(pointEmptyReason(result))+'</div>'; }catch(err){ qs("#pointStatus").textContent = err.message; qs("#pointRows").innerHTML = '<div class="empty">點數資料讀取失敗</div>'; } } async function submitPointAdjust(type){ if(!activeCustomer) return; const raw = Number(qs("#pointAmount").value || 0); const reason = qs("#pointReason").value.trim(); if(!raw || raw <= 0){ qs("#pointStatus").textContent = "請輸入大於 0 的點數"; return; } if(!reason){ qs("#pointStatus").textContent = "請填寫異動原因"; return; } const points = type === "spend" ? -Math.abs(raw) : Math.abs(raw); qs("#pointStatus").textContent = "送出中"; try{ const result = await api("/api/points/adjust",{method:"POST",body:JSON.stringify({lineUserId:activeCustomer.lineUserId,eventName:type === "spend" ? "後台扣點" : "後台贈點",eventContent:reason,points})}); qs("#pointStatus").textContent = result.skipped ? (result.error || "點數 API 尚未設定") : "點數調整完成"; await loadCustomerPoints(); }catch(err){ qs("#pointStatus").textContent = err.message; } }
    async function loadProducts(){ const rows = await api("/api/products"); qs("#productRows").innerHTML = rows.map(r => '<tr><td><strong>'+esc(r.name)+'</strong></td><td class="mono">'+esc(r.sku)+'</td><td>'+esc(r.category||"")+'</td><td>'+money(r.price)+'</td><td>'+money(r.stockQty)+' / '+money(r.safetyStockQty)+'</td><td>'+badge(r.status||"active", Number(r.stockQty) <= Number(r.safetyStockQty) ? "warn" : "")+'</td></tr>').join("") || tableEmpty(6,"尚無商品"); }
    async function loadMessages(){ const rows = await api("/api/admin/line-messages"); const html = rows.map(r => '<tr><td>'+esc(r.createdAt)+'</td><td class="mono">'+esc(r.senderId)+'</td><td class="summary-text">'+esc(r.messageText)+'</td><td class="mono">'+esc(r.threadId)+'</td></tr>').join("") || tableEmpty(4,"尚無訊息"); qs("#messageRows").innerHTML = html; qs("#dashboardMessages").innerHTML = rows.slice(0,6).map(r => '<tr><td>'+esc(r.createdAt)+'</td><td class="mono">'+esc(r.senderId)+'</td><td class="summary-text">'+esc(r.messageText)+'</td><td class="mono">'+esc(r.threadId)+'</td></tr>').join("") || tableEmpty(4,"尚無訊息"); }
    async function loadWebhooks(){ const rows = await api("/api/admin/webhooks"); qs("#webhookRows").innerHTML = rows.map(r => { const s = r.summary || {}; const tone = s.invalidSignature ? "danger" : (s.hasReplyPayload ? "" : "warn"); const label = s.invalidSignature ? "簽章錯誤" : (s.hasReplyPayload ? "有回覆" : "已轉送"); const detail = s.contentType || "無 content-type"; return '<tr><td>'+esc(r.createdAt)+'</td><td>'+esc(r.source)+'</td><td class="summary-text">'+esc(r.messageText||"")+'</td><td>'+esc(r.motherStatus||"")+'</td><td>'+badge(label,tone)+'<div class="muted">'+esc(detail)+'</div></td></tr>'; }).join("") || tableEmpty(5,"尚無紀錄"); }
    async function loadAi(){ const rows = await api("/api/ai-monitor/insights?limit=100"); qs("#aiRows").innerHTML = rows.map(r => '<tr><td>'+esc(r.createdAt)+'</td><td>'+badge(r.riskLevel||"-", r.riskLevel === "high" ? "danger" : (r.riskLevel === "medium" ? "warn" : ""))+'</td><td>'+esc(r.category||"")+'</td><td class="summary-text">'+esc(r.summary||"")+'</td><td class="summary-text">'+esc(r.recommendedAction||"")+'</td></tr>').join("") || tableEmpty(5,"尚無 AI 洞察"); }
    async function loadReports(){ const period = qs("#reportPeriod").value || new Date().toISOString().slice(0,7); qs("#reportPeriod").value = period; const rows = await api("/api/reports/monthly-sales?period=" + encodeURIComponent(period)); qs("#reportRows").innerHTML = rows.map(r => '<tr><td>'+esc(r.salesName||"-")+'</td><td class="mono">'+esc(r.salesCode||"")+'</td><td>'+money(r.orderCount)+'</td><td>'+money(r.revenue)+'</td><td>'+money(r.grossProfit)+'</td></tr>').join("") || tableEmpty(5,"尚無業績資料"); }
    async function loadAll(){ try{ await Promise.all([loadSummary(),loadSales(),loadCustomers(),loadProducts(),loadMessages(),loadWebhooks(),loadAi(),loadReports()]); }catch(err){ if(err.status === 401 || err.message === "admin_unauthorized") showUnauthorized(); else { qs("#systemStatus").textContent = "異常"; qs("#systemStatus").className = "status-badge danger"; qs("#opsSummary").innerHTML = '<div class="ops-item"><div class="ops-label">錯誤</div><div class="ops-value">'+esc(err.message)+'</div></div>'; } } }
    setView("dashboard"); loadAll();
  </script>
</body>
</html>`, { headers: HTML_HEADERS });
}