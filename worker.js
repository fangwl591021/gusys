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
      if (url.pathname === "/" && request.method === "POST") return handleHookteaMenuAction(request, env);
      if (url.pathname === "/action" && request.method === "POST") return handleHookteaMenuAction(request, env);
      if (url.pathname === "/menu.html") return renderRichMenuEditorPage();
      if (url.pathname === "/") return renderHome(env);
      if (url.pathname === "/admin") return renderHookteaAdminPage(env);
      if (url.pathname === "/hub-test") return handleHubTest(env);
      if (url.pathname === "/line-webhook") return handleLineWebhook(request, env, ctx);
      if (url.pathname === "/sales/invite") return renderSalesInvitePage(request, env);
      if (url.pathname.startsWith("/api/admin/webhook") && request.method === "GET") return listAdminWebhookEvents(request, env);
      if (url.pathname === "/api/admin/summary" && request.method === "GET") return adminSummary(request, env);
      if (url.pathname === "/api/admin/customers" && request.method === "GET") return listAdminCustomers(request, env);
      if (url.pathname === "/api/admin/customers" && request.method === "PATCH") return updateAdminCustomer(request, env);
      if (url.pathname === "/api/admin/customers/sync-profiles" && request.method === "POST") return syncAdminCustomerProfiles(request, env);
      if (url.pathname === "/api/admin/line-messages" && request.method === "GET") return listAdminLineMessages(request, env);
      if ((url.pathname === "/api/admin/webhook-events" || url.pathname === "/api/admin/webhooks") && request.method === "GET") return listAdminWebhookEvents(request, env);
      if (url.pathname === "/api/products" && request.method === "GET") return listProducts(request, env);
      if (url.pathname === "/api/products" && request.method === "POST") return createProduct(request, env);
      if (url.pathname === "/api/sales/reps" && request.method === "POST") return createSalesRep(request, env);
      if (url.pathname === "/api/sales/reps" && request.method === "GET") return listSalesReps(env);
      if (url.pathname === "/api/sales/bind" && (request.method === "POST" || request.method === "GET")) return bindCustomerToSalesRep(request, env);
      if (url.pathname === "/api/members/check-or-create" && request.method === "POST") return checkOrCreateMember(request, env);
      if (url.pathname === "/api/points/adjust" && request.method === "POST") return adjustMemberPoints(request, env);
      if (url.pathname === "/api/points/list" && request.method === "GET") return listMemberPoints(request, env);
      if (url.pathname === "/api/ai-monitor/analyze" && request.method === "POST") return analyzeLineMonitor(request, env);
      if (url.pathname === "/api/ai-monitor/insights" && request.method === "GET") return listAiMonitorInsights(request, env);
      if (url.pathname === "/api/admin/rich-menus" && request.method === "GET") return listRichMenus(request, env);
      if (url.pathname === "/api/admin/rich-menus" && request.method === "POST") return saveRichMenu(request, env);
      if (url.pathname === "/api/admin/rich-menus" && request.method === "DELETE") return deleteRichMenu(request, env);
      if (url.pathname === "/api/admin/rich-menus/deploy" && request.method === "POST") return deployRichMenu(request, env);
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
    if (!event) continue;
    const lineUserId = String(event.source?.userId || "").trim();
    if (!lineUserId) continue;

    if (event.type === "follow") {
      const profile = await ensureCustomerFromLineEvent(env, event);
      await syncWetwMember(env, {
        lineUserId,
        displayName: profile?.displayName || "",
        pictureUrl: profile?.pictureUrl || "",
      }).catch(error => {
        console.error(JSON.stringify({ level: "error", message: "sync_follow_member_failed", error: String(error?.message || error) }));
      });
      continue;
    }

    if (event.type !== "message" || event.message?.type !== "text") continue;
    const text = String(event.message.text || "").trim();
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
           c.customer_type AS customerType, c.referrer_line_user_id AS referrerLineUserId,
           ref.display_name AS referrerName,
           c.phone, c.address, c.status, c.first_seen_at AS firstSeenAt,
           c.updated_at AS updatedAt,
           sr.sales_code AS salesCode, sr.name AS salesName, b.bound_at AS boundAt,
           lt.last_message_at AS lastMessageAt,
           COUNT(lm.id) AS messageCount
    FROM customers c
    LEFT JOIN customers ref ON ref.line_user_id = c.referrer_line_user_id
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

async function updateAdminCustomer(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const payload = await request.json().catch(() => ({}));
  const lineUserId = String(payload.lineUserId || payload.LINE_user_id || "").trim();
  if (!lineUserId) return json({ ok: false, error: "missing_line_user_id" }, 400);
  const customerType = String(payload.customerType || payload.customer_type || "customer").trim() === "sales" ? "sales" : "customer";
  const referrerLineUserId = String(payload.referrerLineUserId || payload.referrer_line_user_id || "").trim();
  const displayName = String(payload.displayName || "").trim();
  await env.DB.prepare(`
    UPDATE customers
    SET customer_type = ?,
        referrer_line_user_id = ?,
        display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
        updated_at = datetime('now')
    WHERE line_user_id = ?
  `).bind(customerType, referrerLineUserId, displayName, displayName, lineUserId).run();
  const row = await env.DB.prepare(`
    SELECT c.id, c.line_user_id AS lineUserId, c.display_name AS displayName,
           c.picture_url AS pictureUrl, c.customer_type AS customerType,
           c.referrer_line_user_id AS referrerLineUserId, ref.display_name AS referrerName,
           c.phone, c.address, c.status, c.first_seen_at AS firstSeenAt,
           c.updated_at AS updatedAt
    FROM customers c
    LEFT JOIN customers ref ON ref.line_user_id = c.referrer_line_user_id
    WHERE c.line_user_id = ?
    LIMIT 1
  `).bind(lineUserId).first();
  return json({ ok: true, data: row });
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
function crmSalesCode(lineUserId) {
  return normalizeSalesCode(`CRM-${String(lineUserId || "").trim().slice(-10)}`);
}

async function ensureCrmSalesRep(env, customer) {
  const lineUserId = String(customer.lineUserId || customer.line_user_id || "").trim();
  if (!lineUserId) return null;
  const existing = await env.DB.prepare(`
    SELECT id, sales_code AS salesCode, name, line_user_id AS lineUserId,
           phone, status, invite_url AS inviteUrl, qr_url AS qrUrl,
           external_invite_url AS externalInviteUrl,
           created_at AS createdAt, updated_at AS updatedAt
    FROM sales_reps
    WHERE line_user_id = ?
    LIMIT 1
  `).bind(lineUserId).first();
  if (existing) return existing;
  const salesCode = crmSalesCode(lineUserId);
  const inviteUrl = buildSalesInviteUrl(env, salesCode);
  const qrUrl = buildQrUrl(inviteUrl);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO sales_reps (
      id, company_id, sales_code, name, line_user_id, phone, status,
      invite_url, qr_url, created_at, updated_at
    ) VALUES (?, 'default', ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
  `).bind(
    crypto.randomUUID(),
    salesCode,
    String(customer.displayName || customer.display_name || lineUserId).trim() || lineUserId,
    lineUserId,
    String(customer.phone || "").trim(),
    inviteUrl,
    qrUrl,
  ).run();
  return env.DB.prepare(`
    SELECT id, sales_code AS salesCode, name, line_user_id AS lineUserId,
           phone, status, invite_url AS inviteUrl, qr_url AS qrUrl,
           external_invite_url AS externalInviteUrl,
           created_at AS createdAt, updated_at AS updatedAt
    FROM sales_reps
    WHERE line_user_id = ?
    LIMIT 1
  `).bind(lineUserId).first();
}

async function syncCrmSalesCustomersToSalesReps(env) {
  const { results } = await env.DB.prepare(`
    SELECT c.line_user_id AS lineUserId, c.display_name AS displayName, c.phone
    FROM customers c
    LEFT JOIN sales_reps sr ON sr.line_user_id = c.line_user_id
    WHERE c.customer_type = 'sales'
      AND c.status = 'active'
      AND c.line_user_id <> ''
      AND sr.id IS NULL
    ORDER BY c.updated_at DESC
    LIMIT 200
  `).all();
  for (const customer of results || []) {
    const lineUserId = String(customer.lineUserId || '').trim();
    if (!lineUserId) continue;
    const salesCode = crmSalesCode(lineUserId);
    const inviteUrl = buildSalesInviteUrl(env, salesCode);
    const qrUrl = buildQrUrl(inviteUrl);
    await env.DB.prepare(`
      INSERT OR IGNORE INTO sales_reps (
        id, company_id, sales_code, name, line_user_id, phone, status,
        invite_url, qr_url, created_at, updated_at
      ) VALUES (?, 'default', ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
    `).bind(
      crypto.randomUUID(),
      salesCode,
      String(customer.displayName || lineUserId).trim() || lineUserId,
      lineUserId,
      String(customer.phone || '').trim(),
      inviteUrl,
      qrUrl,
    ).run();
  }
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
  await syncCrmSalesCustomersToSalesReps(env);
  const { results } = await env.DB.prepare(`
    SELECT id, sales_code AS salesCode, name, line_user_id AS lineUserId,
           phone, status, invite_url AS inviteUrl, qr_url AS qrUrl,
           external_invite_url AS externalInviteUrl,
           created_at AS createdAt, updated_at AS updatedAt
    FROM sales_reps
    ORDER BY created_at DESC
    LIMIT 200
  `).all();
  const rows = results || [];
  for (const row of rows) {
    const externalInviteUrl = String(row.externalInviteUrl || "").trim();
    const freshInviteUrl = externalInviteUrl || buildSalesInviteUrl(env, row.salesCode);
    const freshQrUrl = buildQrUrl(freshInviteUrl);
    if (row.inviteUrl !== freshInviteUrl || row.qrUrl !== freshQrUrl) {
      await env.DB.prepare(`
        UPDATE sales_reps
        SET invite_url = ?, qr_url = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(freshInviteUrl, freshQrUrl, row.id).run();
      row.inviteUrl = freshInviteUrl;
      row.qrUrl = freshQrUrl;
    }
  }
  const { results: crmSales } = await env.DB.prepare(`
    SELECT c.line_user_id AS lineUserId, c.display_name AS displayName, c.phone,
           c.created_at AS createdAt, c.updated_at AS updatedAt, sr.id AS salesRepId
    FROM customers c
    LEFT JOIN sales_reps sr ON sr.line_user_id = c.line_user_id
    WHERE c.customer_type = 'sales'
      AND c.status = 'active'
      AND c.line_user_id <> ''
    ORDER BY c.updated_at DESC
    LIMIT 200
  `).all();
  const known = new Set(rows.map(row => String(row.lineUserId || '')));
  for (const customer of crmSales || []) {
    if (known.has(String(customer.lineUserId || ''))) continue;
    const salesCode = crmSalesCode(customer.lineUserId);
    const inviteUrl = buildSalesInviteUrl(env, salesCode);
    rows.push({
      id: `crm_${customer.lineUserId}`,
      salesCode,
      name: customer.displayName || customer.lineUserId,
      lineUserId: customer.lineUserId,
      phone: customer.phone || '',
      status: 'active',
      inviteUrl,
      qrUrl: buildQrUrl(inviteUrl),
      createdAt: customer.createdAt || customer.updatedAt || '',
      updatedAt: customer.updatedAt || '',
      source: 'crm',
    });
  }
  return json({ ok: true, data: rows });
}

async function bindCustomerToSalesRep(request, env) {
  requireDb(env);
  const url = new URL(request.url);
  const queryPayload = Object.fromEntries(url.searchParams.entries());
  const bodyPayload = request.method === "GET" ? {} : await request.json().catch(() => ({}));
  const payload = { ...queryPayload, ...bodyPayload };
  const lineUserId = payload.lineUserId || payload.LINE_user_id || payload.uid || payload.userId;
  const salesCode = payload.salesCode || payload.sales_code || payload.sales || payload.ref;
  if (!lineUserId) {
    return json({ ok: false, error: "missing_line_user_id", message: "請由母站 LINE 登入後帶 LINE UID 回寫 Gusys" }, 400);
  }
  const result = await bindCustomerBySalesCode(env, {
    lineUserId,
    displayName: payload.displayName || payload.LINE_display_name || payload.name,
    phone: payload.phone,
    address: payload.address,
    salesCode,
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
  if (!result.ok && result.status === 404) {
    const empty = { ...result, ok: true, status: 200, balance: 0, logs: [], pagination: { page: 1, per_page: 20, total: 0, total_pages: 0 }, notFoundAsEmpty: true };
    return json({ ok: true, data: empty });
  }
  return json({ ok: result.ok, data: result }, result.ok ? 200 : result.status || 400);
}
async function bindCustomerBySalesCode(env, input) {
  const lineUserId = String(input.lineUserId || "").trim();
  const salesCode = normalizeSalesCode(input.salesCode || "");
  if (!lineUserId) throw new Error("missing_line_user_id");
  if (!salesCode) throw new Error("missing_sales_code");

  let salesRep = await env.DB.prepare(`
    SELECT id, sales_code, name
    FROM sales_reps
    WHERE sales_code = ? AND status = 'active'
    LIMIT 1
  `).bind(salesCode).first();
  if (!salesRep) {
    const { results: crmSales } = await env.DB.prepare(`
      SELECT line_user_id AS lineUserId, display_name AS displayName, phone
      FROM customers
      WHERE customer_type = 'sales' AND status = 'active' AND line_user_id <> ''
      LIMIT 200
    `).all();
    const crmCustomer = (crmSales || []).find(customer => crmSalesCode(customer.lineUserId) === salesCode);
    if (crmCustomer) {
      await ensureCrmSalesRep(env, crmCustomer);
      salesRep = await env.DB.prepare(`
        SELECT id, sales_code, name
        FROM sales_reps
        WHERE sales_code = ? AND status = 'active'
        LIMIT 1
      `).bind(salesCode).first();
    }
  }
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
    point_type: String(input.pointType || cfg.pointType || "gift_point").trim(),
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
  const shopId = String(input.shopId || (!lineUserId ? cfg.shopId : "") || "").trim();
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
  const balance = list.reduce((sum, log) => sum + pointLogAmount(log), 0);
  return {
    ...result,
    balance,
    logs: list,
    pagination: payload?.pagination || {},
    query: payload?.query || {},
  };
}

function pointLogAmount(log) {
  return Number(log?.get_point ?? log?.points ?? log?.amount ?? log?.point ?? 0) || 0;
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
  const pointType = String(env.WETW_POINT_TYPE || "gift_point").trim();
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
const GUSYS_HOOKTEA_MENU_HTML_BASE64 = "PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9InpoLVRXIj4KCjxoZWFkPgogICAgPG1ldGEgY2hhcnNldD0iVVRGLTgiPgogICAgPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiPgogICAgPHRpdGxlPkd1c3lzIOWcluaWh+mBuOWWrue3qOi8r+WZqDwvdGl0bGU+CiAgICA8IS0tIFZlcnNpb246IDIwMjYuMDUuMDguVjI5MV9Qb3N0YmFja19GaXggLS0+CiAgICA8c2NyaXB0IHNyYz0iaHR0cHM6Ly9jZG4udGFpbHdpbmRjc3MuY29tIj48L3NjcmlwdD4KICAgIDxzY3JpcHQgc3JjPSJodHRwczovL2NkbmpzLmNsb3VkZmxhcmUuY29tL2FqYXgvbGlicy9mYWJyaWMuanMvNS4zLjEvZmFicmljLm1pbi5qcyI+PC9zY3JpcHQ+CiAgICA8bGluayByZWw9InN0eWxlc2hlZXQiIGhyZWY9Imh0dHBzOi8vY2RuanMuY2xvdWRmbGFyZS5jb20vYWpheC9saWJzL2ZvbnQtYXdlc29tZS82LjQuMC9jc3MvYWxsLm1pbi5jc3MiPgogICAgPHN0eWxlPgogICAgICAgIGJvZHkgeyBmb250LWZhbWlseTogLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCAiU2Vnb2UgVUkiLCBSb2JvdG8sIHNhbnMtc2VyaWY7IH0KICAgICAgICAuaGlkZS1zY3JvbGxiYXI6Oi13ZWJraXQtc2Nyb2xsYmFyIHsgZGlzcGxheTogbm9uZTsgfQogICAgICAgIC5zaWRlYmFyLXRyYW5zaXRpb24geyB0cmFuc2l0aW9uOiBtYXJnaW4tbGVmdCAwLjNzIGN1YmljLWJlemllcigwLjQsIDAsIDAuMiwgMSk7IH0KICAgIDwvc3R5bGU+CjwvaGVhZD4KCjxib2R5IGNsYXNzPSJiZy1zbGF0ZS0xMDAgZmxleCBoLXNjcmVlbiBvdmVyZmxvdy1oaWRkZW4gdGV4dC1zbGF0ZS04MDAiPgoKICAgIDxhc2lkZSBpZD0ic2lkZWJhciIgY2xhc3M9InctWzM2MHB4XSBzaHJpbmstMCBiZy1bI0Y4RjlGQV0gYm9yZGVyLXIgYm9yZGVyLXNsYXRlLTIwMCBoLWZ1bGwgZmxleCBmbGV4LWNvbCBzaWRlYmFyLXRyYW5zaXRpb24gcmVsYXRpdmUgei00MCBzaGFkb3cteGwiPgogICAgICAgIDxkaXYgY2xhc3M9InB4LTUgcHktNCBib3JkZXItYiBib3JkZXItc2xhdGUtMjAwIGZsZXgganVzdGlmeS1iZXR3ZWVuIGl0ZW1zLWNlbnRlciBiZy13aGl0ZSI+CiAgICAgICAgICAgIDxoMiBjbGFzcz0iZm9udC1ibGFjayB0ZXh0LXNsYXRlLTgwMCB0ZXh0LVsxN3B4XSI+PGkgY2xhc3M9ImZhcyBmYS1sYXllci1ncm91cCB0ZXh0LVsjMDZDNzU1XSBtci0yIj48L2k+R3VzeXMg5ZyW5paH6YG45Zau57eo6Lyv5ZmoPC9oMj4KICAgICAgICAgICAgPGJ1dHRvbiBvbmNsaWNrPSJ0b2dnbGVTaWRlYmFyKCkiIGNsYXNzPSJ0ZXh0LXNsYXRlLTQwMCBob3Zlcjp0ZXh0LXNsYXRlLTYwMCB0cmFuc2l0aW9uIHAtMS41IHJvdW5kZWQtbGcgaG92ZXI6Ymctc2xhdGUtMTAwIj48aSBjbGFzcz0iZmFzIGZhLWNoZXZyb24tbGVmdCB0ZXh0LWxnIj48L2k+PC9idXR0b24+CiAgICAgICAgPC9kaXY+CiAgICAgICAgCiAgICAgICAgPGRpdiBjbGFzcz0iZmxleC0xIG92ZXJmbG93LXktYXV0byBoaWRlLXNjcm9sbGJhciI+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9InAtNSBzcGFjZS15LTUgYm9yZGVyLWIgYm9yZGVyLXNsYXRlLTIwMCBiZy13aGl0ZSI+CiAgICAgICAgICAgICAgICA8ZGl2PgogICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz0iYmxvY2sgdGV4dC1zbSBmb250LWJvbGQgdGV4dC1zbGF0ZS03MDAgbWItMiI+MS4g6LyJ5YWl5bqV5ZyWIChKUEcvUE5HKTwvbGFiZWw+CiAgICAgICAgICAgICAgICAgICAgPGlucHV0IHR5cGU9ImZpbGUiIGlkPSJpbWFnZS11cGxvYWQiIGFjY2VwdD0iaW1hZ2UvanBlZywgaW1hZ2UvcG5nIiBjbGFzcz0iaGlkZGVuIj4KICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIG9uY2xpY2s9ImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbWFnZS11cGxvYWQnKS5jbGljaygpIiBjbGFzcz0idy1mdWxsIHB5LTMgYmctYmx1ZS01MCB0ZXh0LWJsdWUtNjAwIGJvcmRlciBib3JkZXItYmx1ZS0yMDAgaG92ZXI6YmctYmx1ZS0xMDAgcm91bmRlZC14bCBmb250LWJvbGQgZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1jZW50ZXIgZ2FwLTIgc2hhZG93LXNtIHRyYW5zaXRpb24gYWN0aXZlOnNjYWxlLTk1Ij7kuIrlgrPpgbjllq7lnJbniYfmqpQ8L2J1dHRvbj4KICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgICAgPGRpdj48bGFiZWwgY2xhc3M9ImJsb2NrIHRleHQtc20gZm9udC1ib2xkIHRleHQtc2xhdGUtNzAwIG1iLTEiPjIuIOmBuOWWruWQjeeosTwvbGFiZWw+PGlucHV0IHR5cGU9InRleHQiIGlkPSJzYXZlLWZpbGVuYW1lIiBjbGFzcz0idy1mdWxsIGJvcmRlciBib3JkZXItc2xhdGUtMzAwIHJvdW5kZWQtbGcgcHgtMyBweS0yLjUgdGV4dC1zbSBmb250LWJvbGQgdGV4dC1zbGF0ZS02MDAgYmctc2xhdGUtNTAiIHZhbHVlPSJOZXcgUmljaCBNZW51IiBtYXhsZW5ndGg9IjMwMCI+PC9kaXY+CiAgICAgICAgICAgICAgICA8ZGl2PjxsYWJlbCBjbGFzcz0iYmxvY2sgdGV4dC1zbSBmb250LWJvbGQgdGV4dC1zbGF0ZS03MDAgbWItMSI+My4g6YG45Zau5YiX5paH5a2XIChDaGF0QmFyKTwvbGFiZWw+PGlucHV0IHR5cGU9InRleHQiIGlkPSJyaWNoLW1lbnUtY2hhdGJhciIgY2xhc3M9InctZnVsbCBib3JkZXIgYm9yZGVyLXNsYXRlLTMwMCByb3VuZGVkLWxnIHB4LTMgcHktMi41IHRleHQtc20gZm9udC1ib2xkIHRleHQtc2xhdGUtNjAwIGJnLXNsYXRlLTUwIiB2YWx1ZT0i6YG45ZauIiBtYXhsZW5ndGg9IjE0IiBwbGFjZWhvbGRlcj0i5pyA5aSaIDE0IOWAi+WtlyI+PC9kaXY+CiAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAKICAgICAgICAgICAgPGRpdiBpZD0iZWRpdG9yLXVpIiBjbGFzcz0iYmctWyNGOEY5RkFdIHBiLTYgc3BhY2UteS00Ij48L2Rpdj4KICAgICAgICA8L2Rpdj4KCiAgICAgICAgPGRpdiBjbGFzcz0icC01IGJnLXdoaXRlIGJvcmRlci10IGJvcmRlci1zbGF0ZS0yMDAgc2hyaW5rLTAiPgogICAgICAgICAgICA8bGFiZWwgY2xhc3M9ImJsb2NrIHRleHQtc20gZm9udC1ib2xkIHRleHQtc2xhdGUtNzAwIG1iLTIiPkpTT04g6Ly45Ye6PC9sYWJlbD4KICAgICAgICAgICAgPHRleHRhcmVhIGlkPSJqc29uLW91dHB1dCIgY2xhc3M9InctZnVsbCBib3JkZXIgYm9yZGVyLXNsYXRlLTMwMCByb3VuZGVkLWxnIHB4LTMgcHktMiB0ZXh0LXhzIGZvbnQtbW9ubyBoLTI0IGJnLXNsYXRlLTUwIHJlc2l6ZS1ub25lIiByZWFkb25seT48L3RleHRhcmVhPgogICAgICAgIDwvZGl2PgogICAgPC9hc2lkZT4KCiAgICA8bWFpbiBjbGFzcz0iZmxleC0xIGZsZXggZmxleC1jb2wgaC1mdWxsIHJlbGF0aXZlIG92ZXJmbG93LWhpZGRlbiBiZy1zbGF0ZS0xMDAiPgogICAgICAgIDxidXR0b24gaWQ9ImV4cGFuZC1idG4iIG9uY2xpY2s9InRvZ2dsZVNpZGViYXIoKSIgY2xhc3M9ImFic29sdXRlIHRvcC00IGxlZnQtNCB6LTUwIGJnLXdoaXRlIHRleHQtc2xhdGUtNjAwIGJvcmRlciBib3JkZXItc2xhdGUtMjAwIHNoYWRvdy1tZCByb3VuZGVkLWxnIHAtMi41IHRyYW5zaXRpb24gaGlkZGVuIj48aSBjbGFzcz0iZmFzIGZhLWJhcnMgdGV4dC1sZyI+PC9pPjwvYnV0dG9uPgoKICAgICAgICA8ZGl2IGNsYXNzPSJiZy13aGl0ZS85MCBib3JkZXItYiBib3JkZXItZ3JheS0yMDAgdy1mdWxsIHB5LTMgZmxleCBqdXN0aWZ5LWJldHdlZW4gaXRlbXMtY2VudGVyIHB4LTYgc3RpY2t5IHRvcC0wIHotMzAgc2hhZG93LXNtIj4KICAgICAgICAgICAgPGJ1dHRvbiBvbmNsaWNrPSJNZW51TW9kdWxlLnRvZ2dsZURyYXdNb2RlKCkiIGlkPSJtZW51LWRyYXctYnRuIiBjbGFzcz0icHgtMTAgcHktMi41IHJvdW5kZWQtbWQgdGV4dC1zbSBmb250LWJsYWNrIGJnLXNsYXRlLTgwMCB0ZXh0LXdoaXRlIHNoYWRvdy1tZCI+6ZaL5aeL5YqD5a6a5Y2A5Z+fPC9idXR0b24+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9ImZsZXggaXRlbXMtY2VudGVyIHNwYWNlLXgtMiI+CiAgICAgICAgICAgICAgICA8YnV0dG9uIG9uY2xpY2s9IlN0b3JhZ2VNb2R1bGUudG9nZ2xlRHJhd2VyKCkiIGNsYXNzPSJweC02IHB5LTIuNSByb3VuZGVkLW1kIHRleHQtc20gZm9udC1ibGFjayB0ZXh0LW9yYW5nZS02MDAgYmctb3JhbmdlLTUwIGJvcmRlciBib3JkZXItb3JhbmdlLTIwMCBzaGFkb3ctc20gZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTIiPjxpIGNsYXNzPSJmYXMgZmEtZm9sZGVyLW9wZW4iPjwvaT4g5qqU5qGI5bqrPC9idXR0b24+CiAgICAgICAgICAgICAgICA8YnV0dG9uIG9uY2xpY2s9Ik1lbnVNb2R1bGUub3BlbkRlcGxveU1vZGFsKCkiIGNsYXNzPSJweC04IHB5LTIuNSByb3VuZGVkLW1kIHRleHQtc20gZm9udC1ibGFjayB0ZXh0LXdoaXRlIGJnLWluZGlnby02MDAgc2hhZG93LW1kIj7pg6jnvbLoh7MgTElORTwvYnV0dG9uPgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICA8L2Rpdj4KCiAgICAgICAgPGRpdiBjbGFzcz0icC0xMCBmbGV4IGZsZXgtY29sIGl0ZW1zLWNlbnRlciB3LWZ1bGwgaC1mdWxsIG92ZXJmbG93LXktYXV0byI+CiAgICAgICAgICAgIDxkaXYgaWQ9Im1lbnUtY2FudmFzLWNvbnRhaW5lciIgY2xhc3M9ImJnLXdoaXRlIHAtNCByb3VuZGVkLTJ4bCBzaGFkb3ctMnhsIGJvcmRlciBib3JkZXItZ3JheS0yMDAgcmVsYXRpdmUgbWluLXctWzYwMHB4XSBtaW4taC1bNDAwcHhdIGZsZXggaXRlbXMtY2VudGVyIGp1c3RpZnktY2VudGVyIj4KICAgICAgICAgICAgICAgIDxjYW52YXMgaWQ9Im1lbnUtY2FudmFzIj48L2NhbnZhcz4KICAgICAgICAgICAgICAgIDxkaXYgaWQ9ImNhbnZhcy1wbGFjZWhvbGRlciIgY2xhc3M9ImFic29sdXRlIGluc2V0LTAgZmxleCBmbGV4LWNvbCBpdGVtcy1jZW50ZXIganVzdGlmeS1jZW50ZXIgdGV4dC1zbGF0ZS00MDAgYmctc2xhdGUtNTAvODAgcG9pbnRlci1ldmVudHMtbm9uZSI+PGkgY2xhc3M9ImZhciBmYS1pbWFnZXMgdGV4dC02eGwgbWItNCB0ZXh0LXNsYXRlLTMwMCI+PC9pPjxwIGNsYXNzPSJmb250LWJsYWNrIHRleHQtbGcgdHJhY2tpbmctd2lkZXN0IHRleHQtc2xhdGUtNDAwIj7oq4vlvp7lt6blgbTkuIrlgrPlupXlnJY8L3A+PC9kaXY+CiAgICAgICAgICAgIDwvZGl2PgogICAgICAgIDwvZGl2PgogICAgPC9tYWluPgoKICAgIDwhLS0g5qqU5qGI5bqr5oq95bGcIC0tPgogICAgPGRpdiBpZD0icmlnaHQtZHJhd2VyLW92ZXJsYXkiIG9uY2xpY2s9IlN0b3JhZ2VNb2R1bGUudG9nZ2xlRHJhd2VyKCkiIGNsYXNzPSJoaWRkZW4gZml4ZWQgaW5zZXQtMCBiZy1zbGF0ZS04MDAvMjAgei00MCBiYWNrZHJvcC1ibHVyLXNtIj48L2Rpdj4KICAgIDxhc2lkZSBpZD0icmlnaHQtZHJhd2VyIiBjbGFzcz0iZml4ZWQgcmlnaHQtMCB0b3AtMCBoLWZ1bGwgdy1bMzYwcHhdIGJnLVsjRjhGOUZBXSBzaGFkb3ctMnhsIHRyYW5zbGF0ZS14LWZ1bGwgdHJhbnNpdGlvbi10cmFuc2Zvcm0gZHVyYXRpb24tMzAwIHotNTAgZmxleCBmbGV4LWNvbCBib3JkZXItbCBib3JkZXItc2xhdGUtMjAwIj4KICAgICAgICA8ZGl2IGNsYXNzPSJweC02IHB5LTUgYm9yZGVyLWIgYm9yZGVyLXNsYXRlLTIwMCBmbGV4IGp1c3RpZnktYmV0d2VlbiBpdGVtcy1jZW50ZXIgYmctd2hpdGUiPjxoMiBjbGFzcz0iZm9udC1ibGFjayB0ZXh0LXNsYXRlLTgwMCB0ZXh0LWxnIj7pgbjllq7mqpTmoYjluqs8L2gyPjxidXR0b24gb25jbGljaz0iU3RvcmFnZU1vZHVsZS50b2dnbGVEcmF3ZXIoKSIgY2xhc3M9InRleHQtc2xhdGUtNDAwIHAtMiBob3ZlcjpiZy1zbGF0ZS01MCI+PGkgY2xhc3M9ImZhcyBmYS10aW1lcyI+PC9pPjwvYnV0dG9uPjwvZGl2PgogICAgICAgIDxkaXYgY2xhc3M9InAtNiBiZy13aGl0ZSBib3JkZXItYiBib3JkZXItc2xhdGUtMjAwIGZsZXggZ2FwLTIiPjxidXR0b24gb25jbGljaz0iU3RvcmFnZU1vZHVsZS5zYXZlQ3VycmVudCh0cnVlKSIgY2xhc3M9ImZsZXgtMSBweS0zIGJnLXNsYXRlLTgwMCB0ZXh0LXdoaXRlIHJvdW5kZWQteGwgZm9udC1ib2xkIHNoYWRvdy1tZCB0ZXh0LXhzIj7lj6blrZjmlrDmqpQ8L2J1dHRvbj48YnV0dG9uIG9uY2xpY2s9IlN0b3JhZ2VNb2R1bGUuc2F2ZUN1cnJlbnQoZmFsc2UpIiBjbGFzcz0iZmxleC0xIHB5LTMgYmctZ3JlZW4tNTAgdGV4dC1bIzA2Qzc1NV0gYm9yZGVyIGJvcmRlci1bIzA2Qzc1NV0gcm91bmRlZC14bCBmb250LWJvbGQgdGV4dC14cyI+5pu05paw54++5pyJPC9idXR0b24+PC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0iZmxleC0xIG92ZXJmbG93LXktYXV0byBwLTUgc3BhY2UteS00IiBpZD0ic2F2ZWQtZmlsZXMtbGlzdCI+PC9kaXY+CiAgICA8L2FzaWRlPgoKICAgIDwhLS0g6YOo572y5b2I56qXIC0tPgogICAgPGRpdiBpZD0iZGVwbG95LW1vZGFsIiBjbGFzcz0iaGlkZGVuIGZpeGVkIGluc2V0LTAgYmctYmxhY2svNjAgei1bMTAwXSBmbGV4IGl0ZW1zLWNlbnRlciBqdXN0aWZ5LWNlbnRlciBiYWNrZHJvcC1ibHVyLXNtIj4KICAgICAgICA8ZGl2IGNsYXNzPSJiZy13aGl0ZSByb3VuZGVkLTJ4bCBzaGFkb3ctMnhsIHctWzkwJV0gbWF4LXctbGcgcC04Ij4KICAgICAgICAgICAgPGgzIGNsYXNzPSJmb250LWJsYWNrIHRleHQteGwgbWItMiB0ZXh0LWluZGlnby05MDAiPueiuuiqjemDqOe9suiHsyBMSU5FPC9oMz4KICAgICAgICAgICAgPHAgY2xhc3M9InRleHQtc20gdGV4dC1zbGF0ZS01MDAgZm9udC1ib2xkIG1iLTYiPuezu+e1seWwh+ebtOaOpemAo+e3muiHsyBMSU5FIOS8uuacjeWZqOmAsuihjOeJiOmdouaKveaPm+OAgueiuuWumuWft+ihjO+8nzwvcD4KICAgICAgICAgICAgCiAgICAgICAgICAgIDxpbnB1dCB0eXBlPSJ0ZXh0IiBpZD0iZGVwbG95LWFwaS11cmwiIGNsYXNzPSJ3LWZ1bGwgYm9yZGVyIGJvcmRlci1zbGF0ZS0yMDAgcC0zIHJvdW5kZWQtbGcgYmctc2xhdGUtNTAgZm9udC1tb25vIHRleHQteHMgdGV4dC1zbGF0ZS00MDAgbWItNCIgcmVhZG9ubHk+CiAgICAgICAgICAgIAogICAgICAgICAgICA8ZGl2IGlkPSJkZXBsb3ktZXJyb3ItbXNnIiBjbGFzcz0iaGlkZGVuIGJnLXJlZC01MCBib3JkZXIgYm9yZGVyLXJlZC0xMDAgdGV4dC1yZWQtNjAwIHAtNCByb3VuZGVkLXhsIHRleHQtc20gZm9udC1ib2xkIG1iLTYgd2hpdGVzcGFjZS1wcmUtd3JhcCBsZWFkaW5nLXJlbGF4ZWQgc2hhZG93LXNtIj48L2Rpdj4KICAgICAgICAgICAgCiAgICAgICAgICAgIDxkaXYgY2xhc3M9ImZsZXgganVzdGlmeS1lbmQgZ2FwLTMgbXQtNCI+CiAgICAgICAgICAgICAgICA8YnV0dG9uIG9uY2xpY2s9Ik1lbnVNb2R1bGUuY2xvc2VEZXBsb3lNb2RhbCgpIiBjbGFzcz0icHgtNiBweS0zIHJvdW5kZWQteGwgdGV4dC1zbSBmb250LWJvbGQgdGV4dC1zbGF0ZS01MDAgYmctc2xhdGUtMTAwIGhvdmVyOmJnLXNsYXRlLTIwMCB0cmFuc2l0aW9uIj7lj5bmtog8L2J1dHRvbj4KICAgICAgICAgICAgICAgIDxidXR0b24gaWQ9ImRlcGxveS1zdWJtaXQtYnRuIiBvbmNsaWNrPSJNZW51TW9kdWxlLmV4ZWN1dGVEZXBsb3koKSIgY2xhc3M9InB4LTggcHktMyByb3VuZGVkLXhsIHRleHQtc20gZm9udC1ibGFjayB0ZXh0LXdoaXRlIGJnLWluZGlnby02MDAgc2hhZG93LW1kIGhvdmVyOmJnLWluZGlnby03MDAgdHJhbnNpdGlvbiBmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiI+5ZWf5YuV6YOo572yPC9idXR0b24+CiAgICAgICAgICAgIDwvZGl2PgogICAgICAgIDwvZGl2PgogICAgPC9kaXY+CgogICAgPHNjcmlwdD4KICAgICAgICBmdW5jdGlvbiB0b2dnbGVTaWRlYmFyKCkgeyBjb25zdCBzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NpZGViYXInKTsgY29uc3QgZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBhbmQtYnRuJyk7IGlmIChzLmNsYXNzTGlzdC5jb250YWlucygnLW1sLVszNjBweF0nKSkgeyBzLmNsYXNzTGlzdC5yZW1vdmUoJy1tbC1bMzYwcHhdJyk7IGUuY2xhc3NMaXN0LmFkZCgnaGlkZGVuJyk7IH0gZWxzZSB7IHMuY2xhc3NMaXN0LmFkZCgnLW1sLVszNjBweF0nKTsgZS5jbGFzc0xpc3QucmVtb3ZlKCdoaWRkZW4nKTsgfSB9CiAgICAgICAgCiAgICAgICAgY29uc3QgQXBpSGVscGVyID0geyAKICAgICAgICAgICAgY2FsbDogYXN5bmMgKGFjdCwgcGwgPSB7fSkgPT4geyAKICAgICAgICAgICAgICAgIHRyeSB7CiAgICAgICAgICAgICAgICAgICAgaWYgKHdpbmRvdy5wYXJlbnQgJiYgd2luZG93LnBhcmVudCAhPT0gd2luZG93ICYmIHR5cGVvZiB3aW5kb3cucGFyZW50LkFDVF9BRE1JTl9BUElfQ0FMTCA9PT0gJ2Z1bmN0aW9uJykgewogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgd2luZG93LnBhcmVudC5BQ1RfQURNSU5fQVBJX0NBTEwoYWN0LCBwbCwgZmFsc2UpOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0gY2F0Y2goZSkgewogICAgICAgICAgICAgICAgICAgIHRocm93IGU7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBjb25zdCB1cmwgPSAod2luZG93LnBhcmVudCAmJiB3aW5kb3cucGFyZW50LldPUktFUl9VUkwpID8gd2luZG93LnBhcmVudC5XT1JLRVJfVVJMIDogKHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4gKyAnLycpOyAKICAgICAgICAgICAgICAgIGNvbnN0IGhhc1BhcmVudFN5c3RlbUFjY2VzcyA9ICgpID0+IHsKICAgICAgICAgICAgICAgICAgICB0cnkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByYXcgPSB3aW5kb3cucGFyZW50Py5sb2NhbFN0b3JhZ2U/LmdldEl0ZW0oJ2FjdF9jcm1fYWNjZXNzJykgfHwgbG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2FjdF9jcm1fYWNjZXNzJykgfHwgJ3t9JzsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWNjZXNzID0gSlNPTi5wYXJzZShyYXcpOwogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gISEoYWNjZXNzLmlzQWRtaW4gfHwgYWNjZXNzLmNhblN5c3RlbVRvb2xzKTsKICAgICAgICAgICAgICAgICAgICB9IGNhdGNoKGUpIHsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH07CiAgICAgICAgICAgICAgICBjb25zdCBuZWVkc0FkbWluID0gKGFjdCA9PT0gJ0RFUExPWV9SSUNIX01FTlUnIHx8IGFjdCA9PT0gJ1VQTE9BRF9JTUFHRScpICYmICFoYXNQYXJlbnRTeXN0ZW1BY2Nlc3MoKTsKICAgICAgICAgICAgICAgIGNvbnN0IGdldFBhcmVudFNlc3Npb25Qd2QgPSAoKSA9PiB7CiAgICAgICAgICAgICAgICAgICAgdHJ5IHsgcmV0dXJuIHdpbmRvdy5wYXJlbnQ/LnNlc3Npb25TdG9yYWdlPy5nZXRJdGVtKCdhY3RfYWRtaW5fcHdkJykgfHwgJyc7IH0gY2F0Y2goZSkgeyByZXR1cm4gJyc7IH0KICAgICAgICAgICAgICAgIH07CiAgICAgICAgICAgICAgICBjb25zdCBzZXRTZXNzaW9uUHdkID0gKHB3ZCkgPT4gewogICAgICAgICAgICAgICAgICAgIHNlc3Npb25TdG9yYWdlLnNldEl0ZW0oJ2FjdF9hZG1pbl9wd2QnLCBwd2QpOwogICAgICAgICAgICAgICAgICAgIHRyeSB7IHdpbmRvdy5wYXJlbnQ/LnNlc3Npb25TdG9yYWdlPy5zZXRJdGVtKCdhY3RfYWRtaW5fcHdkJywgcHdkKTsgfSBjYXRjaChlKSB7fQogICAgICAgICAgICAgICAgfTsKICAgICAgICAgICAgICAgIGNvbnN0IGNsZWFyU2Vzc2lvblB3ZCA9ICgpID0+IHsKICAgICAgICAgICAgICAgICAgICBzZXNzaW9uU3RvcmFnZS5yZW1vdmVJdGVtKCdhY3RfYWRtaW5fcHdkJyk7CiAgICAgICAgICAgICAgICAgICAgdHJ5IHsgd2luZG93LnBhcmVudD8uc2Vzc2lvblN0b3JhZ2U/LnJlbW92ZUl0ZW0oJ2FjdF9hZG1pbl9wd2QnKTsgfSBjYXRjaChlKSB7fQogICAgICAgICAgICAgICAgfTsKICAgICAgICAgICAgICAgIGNvbnN0IGJ1aWxkUGF5bG9hZCA9IChmb3JjZVByb21wdCA9IGZhbHNlKSA9PiB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGF5bG9hZCA9IHsgLi4ucGwgfTsKICAgICAgICAgICAgICAgICAgICBpZiAoIW5lZWRzQWRtaW4pIHJldHVybiBwYXlsb2FkOwogICAgICAgICAgICAgICAgICAgIGlmIChmb3JjZVByb21wdCkgY2xlYXJTZXNzaW9uUHdkKCk7CiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2F2ZWRQd2QgPSBzZXNzaW9uU3RvcmFnZS5nZXRJdGVtKCdhY3RfYWRtaW5fcHdkJykgfHwgZ2V0UGFyZW50U2Vzc2lvblB3ZCgpOwogICAgICAgICAgICAgICAgICAgIGlmIChzYXZlZFB3ZCkgewogICAgICAgICAgICAgICAgICAgICAgICBwYXlsb2FkLmFkbWluUHdkID0gc2F2ZWRQd2Q7CiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHdkID0gd2luZG93LnByb21wdCgn6KuL6Ly45YWl566h55CG5a+G56K85Lul5o6I5qyK5q2k5pON5L2cJyk7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcHdkKSB0aHJvdyBuZXcgRXJyb3IoJ0FkbWluIGF1dGhvcml6YXRpb24gcmVxdWlyZWQnKTsKICAgICAgICAgICAgICAgICAgICAgICAgc2V0U2Vzc2lvblB3ZChwd2QpOwogICAgICAgICAgICAgICAgICAgICAgICBwYXlsb2FkLmFkbWluUHdkID0gcHdkOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gcGF5bG9hZDsKICAgICAgICAgICAgICAgIH07CgogICAgICAgICAgICAgICAgbGV0IGlkVG9rZW4gPSBudWxsOwogICAgICAgICAgICAgICAgbGV0IGFjY2Vzc1Rva2VuID0gbnVsbDsKICAgICAgICAgICAgICAgIGxldCB1c2VyUHJvZmlsZSA9IHt9OwogICAgICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXJlbnRMaWZmID0gd2luZG93LnBhcmVudD8ubGlmZjsKICAgICAgICAgICAgICAgICAgICBpZiAocGFyZW50TGlmZiAmJiB0eXBlb2YgcGFyZW50TGlmZi5pc0xvZ2dlZEluID09PSAnZnVuY3Rpb24nICYmIHBhcmVudExpZmYuaXNMb2dnZWRJbigpKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlkVG9rZW4gPSB0eXBlb2YgcGFyZW50TGlmZi5nZXRJRFRva2VuID09PSAnZnVuY3Rpb24nID8gcGFyZW50TGlmZi5nZXRJRFRva2VuKCkgOiBudWxsOwogICAgICAgICAgICAgICAgICAgICAgICBhY2Nlc3NUb2tlbiA9IHR5cGVvZiBwYXJlbnRMaWZmLmdldEFjY2Vzc1Rva2VuID09PSAnZnVuY3Rpb24nID8gcGFyZW50TGlmZi5nZXRBY2Nlc3NUb2tlbigpIDogbnVsbDsKICAgICAgICAgICAgICAgICAgICAgICAgdXNlclByb2ZpbGUgPSB3aW5kb3cucGFyZW50Py5saWZmUHJvZmlsZT8udmFsdWUgfHwgd2luZG93LnBhcmVudD8ubGlmZlByb2ZpbGUgfHwge307CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSBjYXRjaChlKSB7fQoKICAgICAgICAgICAgICAgIGNvbnN0IHNlbmQgPSBhc3luYyAocGF5bG9hZCkgPT4gewogICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHVybCwgewogICAgICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdQT1NUJywKICAgICAgICAgICAgICAgICAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sCiAgICAgICAgICAgICAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgYWN0aW9uOiBhY3QsIHBheWxvYWQsIHVzZXJQcm9maWxlLCBpZFRva2VuLCBhY2Nlc3NUb2tlbiB9KQogICAgICAgICAgICAgICAgICAgIH0pOwoKICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKTsKICAgICAgICAgICAgICAgICAgICB0cnkgewogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gSlNPTi5wYXJzZSh0ZXh0KTsKICAgICAgICAgICAgICAgICAgICB9IGNhdGNoKGUpIHsKICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGDkvLrmnI3lmajlm57lgrPkuobnhKHmlYjmoLzlvI/vvIFcblxuW+WOn+Wni+WbnuaHiV1cbiR7dGV4dC5zdWJzdHJpbmcoMCwgMTUwKX0uLi5gKTsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9OwoKICAgICAgICAgICAgICAgIGxldCBqc29uID0gYXdhaXQgc2VuZChidWlsZFBheWxvYWQoZmFsc2UpKTsKICAgICAgICAgICAgICAgIGlmIChqc29uLnN0YXR1cyAhPT0gJ3N1Y2Nlc3MnICYmIG5lZWRzQWRtaW4gJiYgL0FkbWluIGF1dGhvcml6YXRpb24gcmVxdWlyZWQvaS50ZXN0KGpzb24ubWVzc2FnZSB8fCAnJykpIHsKICAgICAgICAgICAgICAgICAgICBqc29uID0gYXdhaXQgc2VuZChidWlsZFBheWxvYWQodHJ1ZSkpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgaWYgKGpzb24uc3RhdHVzICE9PSAnc3VjY2VzcycpIHsKICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoanNvbi5tZXNzYWdlIHx8ICflvoznq6/ln7fooYzlpLHmlZfvvIzkvYbmspLmnInmj5Dkvpvlhbfpq5TpjK/oqqToqIrmga/jgIInKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIHJldHVybiBqc29uLmRhdGE7IAogICAgICAgICAgICB9IAogICAgICAgIH07CgogICAgICAgIHdpbmRvdy5NZW51TW9kdWxlID0gKGZ1bmN0aW9uKCkgewogICAgICAgICAgICB2YXIgY2FudmFzLCBpc0RyYXdpbmdNb2RlID0gZmFsc2UsIGlzTW91c2VEb3duID0gZmFsc2UsIGN1cnJlbnRSZWN0LCBzdGFydFgsIHN0YXJ0WSwgY3VycmVudEltZ0hlaWdodCA9IDg0Mywgc2F2ZWRCYXNlNjRJbWFnZSA9IG51bGwsIGRlcGxveUJhc2U2NEltYWdlID0gbnVsbCwgY3VycmVudE1lbnVDb25maWcgPSBudWxsOwogICAgICAgICAgICByZXR1cm4gewogICAgICAgICAgICAgICAgaW5pdDogZnVuY3Rpb24oKSB7IAogICAgICAgICAgICAgICAgICAgIGNhbnZhcyA9IG5ldyBmYWJyaWMuQ2FudmFzKCdtZW51LWNhbnZhcycsIHsgc2VsZWN0aW9uOiB0cnVlIH0pOyAKICAgICAgICAgICAgICAgICAgICB0aGlzLmJpbmRFdmVudHMoKTsgCiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ltYWdlLXVwbG9hZCcpLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIChlKSA9PiB7IAogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmaWxlID0gZS50YXJnZXQuZmlsZXNbMF07IAogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWZpbGUpIHJldHVybjsgCiAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBidG4gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCdidXR0b25bb25jbGljaz0iZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCdpbWFnZS11cGxvYWRcJykuY2xpY2soKSJdJyk7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9yaWdIdG1sID0gYnRuLmlubmVySFRNTDsKICAgICAgICAgICAgICAgICAgICAgICAgYnRuLmlubmVySFRNTCA9ICc8aSBjbGFzcz0iZmFzIGZhLXNwaW5uZXIgZmEtc3BpbiBtci0yIj48L2k+6Zuy56uvIFIyIOS4iuWCs+S4rS4uLic7CiAgICAgICAgICAgICAgICAgICAgICAgIGJ0bi5kaXNhYmxlZCA9IHRydWU7CgogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpOyAKICAgICAgICAgICAgICAgICAgICAgICAgcmVhZGVyLm9ubG9hZCA9IChmKSA9PiB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbWcgPSBuZXcgSW1hZ2UoKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGltZy5vbmxvYWQgPSBhc3luYyAoKSA9PiB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY3ZzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3ZzLndpZHRoID0gaW1nLndpZHRoOyBjdnMuaGVpZ2h0ID0gaW1nLmhlaWdodDsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjdHggPSBjdnMuZ2V0Q29udGV4dCgnMmQnKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguZHJhd0ltYWdlKGltZywgMCwgMCk7CgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxldCBxdWFsaXR5ID0gMC45OwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxldCBiNjQgPSBjdnMudG9EYXRhVVJMKCdpbWFnZS9qcGVnJywgcXVhbGl0eSk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd2hpbGUgKGI2NC5sZW5ndGggPiAxMDAwMDAwICYmIHF1YWxpdHkgPiAwLjMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbGl0eSAtPSAwLjE7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGI2NCA9IGN2cy50b0RhdGFVUkwoJ2ltYWdlL2pwZWcnLCBxdWFsaXR5KTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiNjQubGVuZ3RoID4gMTA0ODU3NikgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGVydCgn4p2MIOWclueJh+WwuuWvuOmBjuWkp++8jOeEoeazleWuieWFqOWjk+e4ruiHsyAxTUIg5Lul5LiL77yM6KuL6Ieq6KGM6JmV55CG5b6M5YaN5LiK5YKzJyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJ0bi5pbm5lckhUTUwgPSBvcmlnSHRtbDsgYnRuLmRpc2FibGVkID0gZmFsc2U7IHJldHVybjsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IEFwaUhlbHBlci5jYWxsKCdVUExPQURfSU1BR0UnLCB7IGltYWdlQmFzZTY0OiBiNjQgfSk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXMgJiYgcmVzLnVybCkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8g5Y+q5pu/5o+b5bqV5ZyW77yM5L+d55WZ55uu5YmN6YG45Zau5ZCN56ix44CB54ax5Y2A6IiHIGFjdGlvbiDlj4PmlbjjgIIKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRDb25maWcgPSBKU09OLnN0cmluZ2lmeShNZW51TW9kdWxlLmdldEN1cnJlbnRDb25maWcodHJ1ZSkpOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWVudU1vZHVsZS5zZXREZXBsb3lCYXNlNjQoYjY0KTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1lbnVNb2R1bGUubG9hZChmaWxlLm5hbWUsIGVuY29kZVVSSUNvbXBvbmVudChjdXJyZW50Q29uZmlnKSwgcmVzLnVybCk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1IyIFVSTCDlm57lgrPlpLHmlZcnKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyDoi6XlpLHmlZfliYfpgIDlm57kvb/nlKjntJQgQmFzZTY077yM5L2G5LuN5L+d55WZ5Y6f5pys54ax5Y2A6Kit5a6a44CCCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRDb25maWcgPSBKU09OLnN0cmluZ2lmeShNZW51TW9kdWxlLmdldEN1cnJlbnRDb25maWcodHJ1ZSkpOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNZW51TW9kdWxlLnNldERlcGxveUJhc2U2NChiNjQpOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNZW51TW9kdWxlLmxvYWQoZmlsZS5uYW1lLCBlbmNvZGVVUklDb21wb25lbnQoY3VycmVudENvbmZpZyksIGI2NCk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBmaW5hbGx5IHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnRuLmlubmVySFRNTCA9IG9yaWdIdG1sOyBidG4uZGlzYWJsZWQgPSBmYWxzZTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9OwogICAgICAgICAgICAgICAgICAgICAgICAgICAgaW1nLnNyYyA9IGYudGFyZ2V0LnJlc3VsdDsKICAgICAgICAgICAgICAgICAgICAgICAgfTsgCiAgICAgICAgICAgICAgICAgICAgICAgIHJlYWRlci5yZWFkQXNEYXRhVVJMKGZpbGUpOyAKICAgICAgICAgICAgICAgICAgICB9KTsgCiAgICAgICAgICAgICAgICB9LAogICAgICAgICAgICAgICAgZ2V0Q3VycmVudEJhc2U2NDogKCkgPT4gewogICAgICAgICAgICAgICAgICAgIGlmIChkZXBsb3lCYXNlNjRJbWFnZSAmJiBkZXBsb3lCYXNlNjRJbWFnZS5zdGFydHNXaXRoKCdkYXRhOmltYWdlJykpIHsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRlcGxveUJhc2U2NEltYWdlOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICBpZiAoc2F2ZWRCYXNlNjRJbWFnZSAmJiBzYXZlZEJhc2U2NEltYWdlLnN0YXJ0c1dpdGgoJ2RhdGE6aW1hZ2UnKSkgewogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gc2F2ZWRCYXNlNjRJbWFnZTsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgaWYgKGNhbnZhcyAmJiBjYW52YXMuYmFja2dyb3VuZEltYWdlICYmIGNhbnZhcy5iYWNrZ3JvdW5kSW1hZ2UuX2VsZW1lbnQpIHsKICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBDdnMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBDdnMud2lkdGggPSBjYW52YXMuYmFja2dyb3VuZEltYWdlLndpZHRoOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGVtcEN2cy5oZWlnaHQgPSBjYW52YXMuYmFja2dyb3VuZEltYWdlLmhlaWdodDsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRDdHggPSB0ZW1wQ3ZzLmdldENvbnRleHQoJzJkJyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0Q3R4LmRyYXdJbWFnZShjYW52YXMuYmFja2dyb3VuZEltYWdlLl9lbGVtZW50LCAwLCAwKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0ZW1wQ3ZzLnRvRGF0YVVSTCgnaW1hZ2UvanBlZycsIDAuOSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2goZSkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcigiQ2FudmFzIOi9ieaPmyBCYXNlNjQg5aSx5pWXOiIsIGUpOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIHJldHVybiBzYXZlZEJhc2U2NEltYWdlOwogICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgIHNldERlcGxveUJhc2U2NDogKGJhc2U2NCkgPT4gewogICAgICAgICAgICAgICAgICAgIGlmIChiYXNlNjQgJiYgYmFzZTY0LnN0YXJ0c1dpdGgoJ2RhdGE6aW1hZ2UnKSkgZGVwbG95QmFzZTY0SW1hZ2UgPSBiYXNlNjQ7CiAgICAgICAgICAgICAgICB9LAogICAgICAgICAgICAgICAgZ2V0Q3VycmVudENvbmZpZzogZnVuY3Rpb24ocHJlZmVyTm9uRW1wdHlBcmVhcyA9IGZhbHNlKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2NhbGUgPSBjYW52YXMgJiYgY2FudmFzLmdldFdpZHRoKCkgPyAyNTAwIC8gY2FudmFzLmdldFdpZHRoKCkgOiAxOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNhbnZhc0FyZWFzID0gY2FudmFzID8gY2FudmFzLmdldE9iamVjdHMoJ3JlY3QnKS5tYXAobyA9PiAoewogICAgICAgICAgICAgICAgICAgICAgICBib3VuZHM6IHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHg6IE1hdGgubWF4KDAsIE1hdGgucm91bmQoby5sZWZ0ICogc2NhbGUpKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHk6IE1hdGgubWF4KDAsIE1hdGgucm91bmQoby50b3AgKiBzY2FsZSkpLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IE1hdGgucm91bmQoby5nZXRTY2FsZWRXaWR0aCgpICogc2NhbGUpLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgaGVpZ2h0OiBNYXRoLnJvdW5kKG8uZ2V0U2NhbGVkSGVpZ2h0KCkgKiBzY2FsZSkKICAgICAgICAgICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uOiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG8uYWN0aW9uIHx8IHsgdHlwZTogJ21lc3NhZ2UnLCB0ZXh0OiAnJyB9KSkKICAgICAgICAgICAgICAgICAgICB9KSkgOiBbXTsKICAgICAgICAgICAgICAgICAgICBpZiAocHJlZmVyTm9uRW1wdHlBcmVhcyAmJiBjYW52YXNBcmVhcy5sZW5ndGgpIHsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNpemU6IHsgd2lkdGg6IDI1MDAsIGhlaWdodDogY3VycmVudEltZ0hlaWdodCB9LAogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQ6IHRydWUsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2F2ZS1maWxlbmFtZScpLnZhbHVlLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhdEJhclRleHQ6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyaWNoLW1lbnUtY2hhdGJhcicpLnZhbHVlLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgYXJlYXM6IGNhbnZhc0FyZWFzCiAgICAgICAgICAgICAgICAgICAgICAgIH07CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIGlmIChwcmVmZXJOb25FbXB0eUFyZWFzICYmIGN1cnJlbnRNZW51Q29uZmlnICYmIEFycmF5LmlzQXJyYXkoY3VycmVudE1lbnVDb25maWcuYXJlYXMpICYmIGN1cnJlbnRNZW51Q29uZmlnLmFyZWFzLmxlbmd0aCkgewogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeSh7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5jdXJyZW50TWVudUNvbmZpZywKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYXZlLWZpbGVuYW1lJykudmFsdWUgfHwgY3VycmVudE1lbnVDb25maWcubmFtZSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXRCYXJUZXh0OiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmljaC1tZW51LWNoYXRiYXInKS52YWx1ZSB8fCBjdXJyZW50TWVudUNvbmZpZy5jaGF0QmFyVGV4dAogICAgICAgICAgICAgICAgICAgICAgICB9KSk7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIGNvbnN0IG91dHB1dCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdqc29uLW91dHB1dCcpLnZhbHVlOwogICAgICAgICAgICAgICAgICAgIHRyeSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2Uob3V0cHV0IHx8ICJ7fSIpOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAocGFyc2VkICYmIEFycmF5LmlzQXJyYXkocGFyc2VkLmFyZWFzKSkgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocGFyc2VkKSk7CiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaChlKSB7fQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50TWVudUNvbmZpZyAmJiBBcnJheS5pc0FycmF5KGN1cnJlbnRNZW51Q29uZmlnLmFyZWFzKSkgewogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShjdXJyZW50TWVudUNvbmZpZykpOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gewogICAgICAgICAgICAgICAgICAgICAgICBzaXplOiB7IHdpZHRoOiAyNTAwLCBoZWlnaHQ6IGN1cnJlbnRJbWdIZWlnaHQgfSwKICAgICAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQ6IHRydWUsCiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYXZlLWZpbGVuYW1lJykudmFsdWUsCiAgICAgICAgICAgICAgICAgICAgICAgIGNoYXRCYXJUZXh0OiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmljaC1tZW51LWNoYXRiYXInKS52YWx1ZSwKICAgICAgICAgICAgICAgICAgICAgICAgYXJlYXM6IGNhbnZhc0FyZWFzCiAgICAgICAgICAgICAgICAgICAgfTsKICAgICAgICAgICAgICAgIH0sCiAgICAgICAgICAgICAgICBsb2FkOiBmdW5jdGlvbihuYW1lLCBqc29uU3RyLCBiYXNlNjQpIHsKICAgICAgICAgICAgICAgICAgICB0cnkgewogICAgICAgICAgICAgICAgICAgICAgICBzYXZlZEJhc2U2NEltYWdlID0gYmFzZTY0OyAKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJhc2U2NCAmJiBiYXNlNjQuc3RhcnRzV2l0aCgnZGF0YTppbWFnZScpKSBkZXBsb3lCYXNlNjRJbWFnZSA9IGJhc2U2NDsKICAgICAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhbnZhcy1wbGFjZWhvbGRlcicpLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7CiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBkYXRhID0ge307IHRyeSB7IGRhdGEgPSBKU09OLnBhcnNlKGRlY29kZVVSSUNvbXBvbmVudChqc29uU3RyIHx8ICJ7fSIpKTsgfSBjYXRjaChlKSB7fQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoZGF0YSAmJiBBcnJheS5pc0FycmF5KGRhdGEuYXJlYXMpKSBjdXJyZW50TWVudUNvbmZpZyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZGF0YSkpOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAoZGF0YS5uYW1lKSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2F2ZS1maWxlbmFtZScpLnZhbHVlID0gZGF0YS5uYW1lOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAoZGF0YS5jaGF0QmFyVGV4dCkgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JpY2gtbWVudS1jaGF0YmFyJykudmFsdWUgPSBkYXRhLmNoYXRCYXJUZXh0OwogICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHRlbXBJbWcgPSBuZXcgSW1hZ2UoKTsKICAgICAgICAgICAgICAgICAgICAgICAgdGVtcEltZy5jcm9zc09yaWdpbiA9ICJhbm9ueW1vdXMiOwogICAgICAgICAgICAgICAgICAgICAgICB0ZW1wSW1nLm9ubG9hZCA9ICgpID0+IHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciByYXRpbyA9IHRlbXBJbWcuaGVpZ2h0IC8gdGVtcEltZy53aWR0aDsgY3VycmVudEltZ0hlaWdodCA9IE1hdGgucm91bmQoMjUwMCAqIHJhdGlvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbnZhcy5zZXRXaWR0aCg2MDApOyBjYW52YXMuc2V0SGVpZ2h0KDYwMCAqIHJhdGlvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZhYnJpYy5JbWFnZS5mcm9tVVJMKGJhc2U2NCwgKGltZykgPT4geyAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW52YXMuc2V0QmFja2dyb3VuZEltYWdlKGltZywgY2FudmFzLnJlbmRlckFsbC5iaW5kKGNhbnZhcyksIHsgc2NhbGVYOiA2MDAgLyBpbWcud2lkdGgsIHNjYWxlWTogKDYwMCAqIHJhdGlvKSAvIGltZy5oZWlnaHQgfSk7IAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuaW1wb3J0QXJlYXMoZGF0YS5hcmVhcyB8fCBbXSwgNjAwIC8gMjUwMCk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LCB7IGNyb3NzT3JpZ2luOiAnYW5vbnltb3VzJyB9KTsKICAgICAgICAgICAgICAgICAgICAgICAgfTsgCiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBJbWcub25lcnJvciA9ICgpID0+IHsgYWxlcnQoJ+i8ieWFpeW6leWcluWkseaVl++8jOagvOW8j+WPr+iDveacieiqpOaIlue2suWdgOWkseaViCcpOyB9OwogICAgICAgICAgICAgICAgICAgICAgICB0ZW1wSW1nLnNyYyA9IGJhc2U2NDsKICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICAgICAgICAgICAgICAgICAgYWxlcnQoJ+i8ieWFpemBuOWWrueZvOeUn+mMr+iqpCcpOwogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGVycik7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgIGJpbmRFdmVudHM6IGZ1bmN0aW9uKCkgewogICAgICAgICAgICAgICAgICAgIGNhbnZhcy5vbignbW91c2U6ZG93bicsIChvKSA9PiB7IGlmICghaXNEcmF3aW5nTW9kZSB8fCBjYW52YXMuZmluZFRhcmdldChvLmUpKSByZXR1cm47IGlzTW91c2VEb3duID0gdHJ1ZTsgdmFyIHBvaW50ZXIgPSBjYW52YXMuZ2V0UG9pbnRlcihvLmUpOyBzdGFydFggPSBwb2ludGVyLng7IHN0YXJ0WSA9IHBvaW50ZXIueTsgY3VycmVudFJlY3QgPSBuZXcgZmFicmljLlJlY3QoeyBsZWZ0OiBzdGFydFgsIHRvcDogc3RhcnRZLCB3aWR0aDogMCwgaGVpZ2h0OiAwLCBmaWxsOiAncmdiYSg4NCwgMTkyLCA5NywgMC4zKScsIHN0cm9rZTogJyM1NEMwNjEnLCBzdHJva2VXaWR0aDogMSB9KTsgY3VycmVudFJlY3QuYWN0aW9uID0geyB0eXBlOiAnbWVzc2FnZScsIHRleHQ6ICcnIH07IGNhbnZhcy5hZGQoY3VycmVudFJlY3QpOyB9KTsKICAgICAgICAgICAgICAgICAgICBjYW52YXMub24oJ21vdXNlOm1vdmUnLCAobykgPT4geyBpZiAoIWlzTW91c2VEb3duKSByZXR1cm47IHZhciBwb2ludGVyID0gY2FudmFzLmdldFBvaW50ZXIoby5lKTsgY3VycmVudFJlY3Quc2V0KHsgbGVmdDogTWF0aC5taW4oc3RhcnRYLCBwb2ludGVyLngpLCB0b3A6IE1hdGgubWluKHN0YXJ0WSwgcG9pbnRlci55KSwgd2lkdGg6IE1hdGguYWJzKHN0YXJ0WCAtIHBvaW50ZXIueCksIGhlaWdodDogTWF0aC5hYnMoc3RhcnRZIC0gcG9pbnRlci55KSB9KTsgY2FudmFzLnJlbmRlckFsbCgpOyB9KTsKICAgICAgICAgICAgICAgICAgICBjYW52YXMub24oJ21vdXNlOnVwJywgKCkgPT4geyBpZiAoIWlzTW91c2VEb3duKSByZXR1cm47IGlzTW91c2VEb3duID0gZmFsc2U7IGlzRHJhd2luZ01vZGUgPSBmYWxzZTsgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ21lbnUtZHJhdy1idG4nKS5pbm5lclRleHQgPSAn6ZaL5aeL5YqD5a6a5Y2A5Z+fJzsgdGhpcy51cGRhdGVPdXRwdXQoKTsgfSk7CiAgICAgICAgICAgICAgICAgICAgY2FudmFzLm9uKCdvYmplY3Q6bW9kaWZpZWQnLCAoKSA9PiB0aGlzLnVwZGF0ZU91dHB1dCgpKTsKICAgICAgICAgICAgICAgIH0sCiAgICAgICAgICAgICAgICB0b2dnbGVEcmF3TW9kZTogZnVuY3Rpb24oKSB7IGlzRHJhd2luZ01vZGUgPSB0cnVlOyBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbWVudS1kcmF3LWJ0bicpLmlubmVyVGV4dCA9ICfnuaroo73ljYDln5/kuK0uLi4nOyB9LAogICAgICAgICAgICAgICAgdXBkYXRlT3V0cHV0OiBmdW5jdGlvbigpIHsKICAgICAgICAgICAgICAgICAgICB2YXIgc2NhbGUgPSAyNTAwIC8gY2FudmFzLmdldFdpZHRoKCk7CiAgICAgICAgICAgICAgICAgICAgdmFyIGFyZWFzID0gY2FudmFzLmdldE9iamVjdHMoJ3JlY3QnKS5tYXAobyA9PiB7CiAgICAgICAgICAgICAgICAgICAgICAgIGxldCB4ID0gTWF0aC5tYXgoMCwgTWF0aC5yb3VuZChvLmxlZnQgKiBzY2FsZSkpOwogICAgICAgICAgICAgICAgICAgICAgICBsZXQgeSA9IE1hdGgubWF4KDAsIE1hdGgucm91bmQoby50b3AgKiBzY2FsZSkpOwogICAgICAgICAgICAgICAgICAgICAgICBsZXQgdyA9IE1hdGgucm91bmQoby5nZXRTY2FsZWRXaWR0aCgpICogc2NhbGUpOwogICAgICAgICAgICAgICAgICAgICAgICBsZXQgaCA9IE1hdGgucm91bmQoby5nZXRTY2FsZWRIZWlnaHQoKSAqIHNjYWxlKTsKICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh4ICsgdyA+IDI1MDApIHcgPSAyNTAwIC0geDsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHkgKyBoID4gY3VycmVudEltZ0hlaWdodCkgaCA9IGN1cnJlbnRJbWdIZWlnaHQgLSB5OwoKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgYm91bmRzOiB7IHg6IHgsIHk6IHksIHdpZHRoOiB3LCBoZWlnaHQ6IGggfSwgYWN0aW9uOiBvLmFjdGlvbiB9OwogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgICAgIHZhciByZXMgPSB7IHNpemU6IHsgd2lkdGg6IDI1MDAsIGhlaWdodDogY3VycmVudEltZ0hlaWdodCB9LCBzZWxlY3RlZDogdHJ1ZSwgbmFtZTogZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NhdmUtZmlsZW5hbWUnKS52YWx1ZSwgY2hhdEJhclRleHQ6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyaWNoLW1lbnUtY2hhdGJhcicpLnZhbHVlLCBhcmVhczogYXJlYXMgfTsKICAgICAgICAgICAgICAgICAgICBjdXJyZW50TWVudUNvbmZpZyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocmVzKSk7CiAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2pzb24tb3V0cHV0JykudmFsdWUgPSBKU09OLnN0cmluZ2lmeShyZXMsIG51bGwsIDIpOyB0aGlzLnJlbmRlckFyZWFFZGl0b3IoYXJlYXMpOyB0aGlzLnJlZnJlc2hDYW52YXNMYWJlbHMoKTsKICAgICAgICAgICAgICAgIH0sCiAgICAgICAgICAgICAgICByZWZyZXNoQ2FudmFzTGFiZWxzOiBmdW5jdGlvbigpIHsgY2FudmFzLmdldE9iamVjdHMoJ3RleHQnKS5mb3JFYWNoKGwgPT4gY2FudmFzLnJlbW92ZShsKSk7IGNhbnZhcy5nZXRPYmplY3RzKCdyZWN0JykuZm9yRWFjaCgociwgaWR4KSA9PiB7IGNhbnZhcy5hZGQobmV3IGZhYnJpYy5UZXh0KCcjJyArIChpZHggKyAxKSwgeyBsZWZ0OiByLmxlZnQgKyA1LCB0b3A6IHIudG9wICsgNSwgZm9udFNpemU6IDE0LCBmaWxsOiAnI2ZmZicsIGJhY2tncm91bmRDb2xvcjogJyM1NEMwNjEnLCBzZWxlY3RhYmxlOiBmYWxzZSB9KSk7IH0pOyB9LAogICAgICAgICAgICAgICAgcmVuZGVyQXJlYUVkaXRvcjogZnVuY3Rpb24oYXJlYXMpIHsKICAgICAgICAgICAgICAgICAgICB2YXIgY29udGFpbmVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VkaXRvci11aScpOyBjb250YWluZXIuaW5uZXJIVE1MID0gJyc7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXNjID0gKHZhbHVlKSA9PiBTdHJpbmcodmFsdWUgfHwgJycpLnJlcGxhY2UoLyYvZywgJyZhbXA7JykucmVwbGFjZSgvIi9nLCAnJnF1b3Q7JykucmVwbGFjZSgvPC9nLCAnJmx0OycpLnJlcGxhY2UoLz4vZywgJyZndDsnKTsKICAgICAgICAgICAgICAgICAgICBhcmVhcy5mb3JFYWNoKChhLCBpZHgpID0+IHsKICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBkaXYuY2xhc3NOYW1lID0gInAtNSBteC01IG15LTIgYmctd2hpdGUgYm9yZGVyIGJvcmRlci1zbGF0ZS0yMDAgcm91bmRlZC0yeGwgc2hhZG93LXNtIjsKICAgICAgICAgICAgICAgICAgICAgICAgYS5hY3Rpb24gPSBhLmFjdGlvbiB8fCB7IHR5cGU6ICJ1cmkiLCB1cmk6ICIiIH07CiAgICAgICAgICAgICAgICAgICAgICAgIHZhciB0eXBlID0gYS5hY3Rpb24udHlwZSB8fCAidXJpIjsKICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGh0bWwgPSBgPGRpdiBjbGFzcz0nZm9udC1ibGFjayBtYi0zIHRleHQteHMgdGV4dC1zbGF0ZS00MDAgdXBwZXJjYXNlIHRyYWNraW5nLXRpZ2h0ZXInPuWNgOWfnyAjJHtpZHgrMX08L2Rpdj4KICAgICAgICAgICAgICAgICAgICAgICAgPHNlbGVjdCBjbGFzcz0ndy1mdWxsIGJvcmRlciBtYi0zIHAtMyByb3VuZGVkLWxnIHRleHQtWzE0cHhdIGZvbnQtYm9sZCBiZy1zbGF0ZS01MCcgb25jaGFuZ2U9J01lbnVNb2R1bGUudXBkYXRlQXJlYVByb3AoJHtpZHh9LCAidHlwZSIsIHRoaXMudmFsdWUpJz4KICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9InVyaSIgJHt0eXBlPT09InVyaSI/InNlbGVjdGVkIjoiIn0+6ZaL5ZWf57ay5Z2AIChVUkkpPC9vcHRpb24+CiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSJtZXNzYWdlIiAke3R5cGU9PT0ibWVzc2FnZSI/InNlbGVjdGVkIjoiIn0+5YKz6YCB5paH5a2XIChNZXNzYWdlKTwvb3B0aW9uPgogICAgICAgICAgICAgICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT0icG9zdGJhY2siICR7dHlwZT09PSJwb3N0YmFjayI/InNlbGVjdGVkIjoiIn0+5Zue5YKz5oyH5LukIChQb3N0YmFjayk8L29wdGlvbj4KICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9InJpY2htZW51c3dpdGNoIiAke3R5cGU9PT0icmljaG1lbnVzd2l0Y2giPyJzZWxlY3RlZCI6IiJ9PuWIh+aPm+mBuOWWriAoU3dpdGNoKTwvb3B0aW9uPgogICAgICAgICAgICAgICAgICAgICAgICA8L3NlbGVjdD5gOwogICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGUgPT09ICd1cmknKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBodG1sICs9IGA8aW5wdXQgY2xhc3M9J3ctZnVsbCBib3JkZXIgcC0zIHRleHQteHMgZm9udC1tb25vIHJvdW5kZWQtbGcnIHZhbHVlPSIke2VzYyhhLmFjdGlvbi51cmkpfSIgcGxhY2Vob2xkZXI9J2h0dHBzOi8vJyBvbmNoYW5nZT0nTWVudU1vZHVsZS51cGRhdGVBcmVhUHJvcCgke2lkeH0sICJ1cmkiLCB0aGlzLnZhbHVlKSc+YDsKICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnbWVzc2FnZScpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGh0bWwgKz0gYDxpbnB1dCBjbGFzcz0ndy1mdWxsIGJvcmRlciBwLTMgdGV4dC14cyByb3VuZGVkLWxnJyB2YWx1ZT0iJHtlc2MoYS5hY3Rpb24udGV4dCl9IiBwbGFjZWhvbGRlcj0n6bue5pOK5b6M55m86YCB55qE5paH5a2XJyBvbmNoYW5nZT0nTWVudU1vZHVsZS51cGRhdGVBcmVhUHJvcCgke2lkeH0sICJ0ZXh0IiwgdGhpcy52YWx1ZSknPmA7CiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3Bvc3RiYWNrJykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaHRtbCArPSBgPGlucHV0IGNsYXNzPSd3LWZ1bGwgYm9yZGVyIG1iLTIgcC0zIHRleHQteHMgZm9udC1tb25vIHJvdW5kZWQtbGcgYmctaW5kaWdvLTUwIGJvcmRlci1pbmRpZ28tMjAwIHRleHQtaW5kaWdvLTcwMCBmb250LWJvbGQgcGxhY2Vob2xkZXItaW5kaWdvLTMwMCcgdmFsdWU9IiR7ZXNjKGEuYWN0aW9uLmRhdGEpfSIgcGxhY2Vob2xkZXI9J+WbnuWCsyBEYXRhICjpoIjot5/lvozlj7Ai6Ke455m86Zec6Y215a2XIuWujOWFqOebuOWQjCknIG9uY2hhbmdlPSdNZW51TW9kdWxlLnVwZGF0ZUFyZWFQcm9wKCR7aWR4fSwgImRhdGEiLCB0aGlzLnZhbHVlKSc+CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW5wdXQgY2xhc3M9J3ctZnVsbCBib3JkZXIgcC0zIHRleHQteHMgcm91bmRlZC1sZycgdmFsdWU9IiR7ZXNjKGEuYWN0aW9uLmRpc3BsYXlUZXh0IHx8IGEuYWN0aW9uLnRleHQpfSIgcGxhY2Vob2xkZXI9J+eVq+mdouS4iumhr+ekuueahOaWh+WtlyAo6K6T5a245ZOh55+l6YGT5pyJ6bue5oiQ5YqfKScgb25jaGFuZ2U9J01lbnVNb2R1bGUudXBkYXRlQXJlYVByb3AoJHtpZHh9LCAiZGlzcGxheVRleHQiLCB0aGlzLnZhbHVlKSc+YDsKICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAncmljaG1lbnVzd2l0Y2gnKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBodG1sICs9IGA8aW5wdXQgY2xhc3M9J3ctZnVsbCBib3JkZXIgbWItMiBwLTMgdGV4dC14cyBmb250LW1vbm8gcm91bmRlZC1sZycgdmFsdWU9IiR7ZXNjKGEuYWN0aW9uLnJpY2hNZW51QWxpYXNJZCl9IiBwbGFjZWhvbGRlcj0n5Yil5ZCNIEFsaWFzIElEJyBvbmNoYW5nZT0nTWVudU1vZHVsZS51cGRhdGVBcmVhUHJvcCgke2lkeH0sICJyaWNoTWVudUFsaWFzSWQiLCB0aGlzLnZhbHVlKSc+CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW5wdXQgY2xhc3M9J3ctZnVsbCBib3JkZXIgcC0zIHRleHQteHMgcm91bmRlZC1sZycgdmFsdWU9IiR7ZXNjKGEuYWN0aW9uLmRhdGEpfSIgcGxhY2Vob2xkZXI9J+WPg+aVuCBkYXRhJyBvbmNoYW5nZT0nTWVudU1vZHVsZS51cGRhdGVBcmVhUHJvcCgke2lkeH0sICJkYXRhIiwgdGhpcy52YWx1ZSknPmA7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgIGh0bWwgKz0gYDxidXR0b24gb25jbGljaz0nTWVudU1vZHVsZS5yZW1vdmVBcmVhRnJvbUNhbnZhcygke2lkeH0pJyBjbGFzcz0ndy1mdWxsIG10LTMgcHktMiBiZy1yZWQtNTAgdGV4dC1yZWQtNTAwIHJvdW5kZWQtbGcgdGV4dC14cyBmb250LWJvbGQgaG92ZXI6YmctcmVkLTEwMCB0cmFuc2l0aW9uJz7liKrpmaTljYDln588L2J1dHRvbj5gOwogICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgZGl2LmlubmVySFRNTCA9IGh0bWw7IGNvbnRhaW5lci5hcHBlbmRDaGlsZChkaXYpOwogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgIHVwZGF0ZUFyZWFQcm9wOiBmdW5jdGlvbihpZHgsIHByb3AsIHZhbCkgeyAKICAgICAgICAgICAgICAgICAgICB2YXIgb2JqZWN0cyA9IGNhbnZhcy5nZXRPYmplY3RzKCdyZWN0Jyk7IAogICAgICAgICAgICAgICAgICAgIGlmKG9iamVjdHNbaWR4XSkgeyAKICAgICAgICAgICAgICAgICAgICAgICAgaWYocHJvcD09PSJ0eXBlIikgeyAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBvbGQgPSBvYmplY3RzW2lkeF0uYWN0aW9uOyAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9iamVjdHNbaWR4XS5hY3Rpb24gPSB7IHR5cGU6IHZhbCB9OyAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmKHZhbD09PSJ1cmkiKSBvYmplY3RzW2lkeF0uYWN0aW9uLnVyaSA9IG9sZC51cmkgfHwgIiI7IAogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZih2YWw9PT0ibWVzc2FnZSIpIG9iamVjdHNbaWR4XS5hY3Rpb24udGV4dCA9IG9sZC50ZXh0IHx8ICIiOyAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYodmFsPT09InBvc3RiYWNrIikgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9iamVjdHNbaWR4XS5hY3Rpb24uZGF0YSA9IG9sZC5kYXRhIHx8ICIiOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9iamVjdHNbaWR4XS5hY3Rpb24uZGlzcGxheVRleHQgPSBvbGQuZGlzcGxheVRleHQgfHwgb2xkLnRleHQgfHwgIiI7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGlmKHZhbD09PSJyaWNobWVudXN3aXRjaCIpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvYmplY3RzW2lkeF0uYWN0aW9uLnJpY2hNZW51QWxpYXNJZCA9IG9sZC5yaWNoTWVudUFsaWFzSWQgfHwgIiI7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb2JqZWN0c1tpZHhdLmFjdGlvbi5kYXRhID0gb2xkLmRhdGEgfHwgIiI7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7IAogICAgICAgICAgICAgICAgICAgICAgICAgICAgb2JqZWN0c1tpZHhdLmFjdGlvbltwcm9wXSA9IHZhbDsgCiAgICAgICAgICAgICAgICAgICAgICAgIH0gCiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlT3V0cHV0KCk7IAogICAgICAgICAgICAgICAgICAgIH0gCiAgICAgICAgICAgICAgICB9LAogICAgICAgICAgICAgICAgcmVtb3ZlQXJlYUZyb21DYW52YXM6IGZ1bmN0aW9uKGlkeCkgeyB2YXIgb2JqZWN0cyA9IGNhbnZhcy5nZXRPYmplY3RzKCdyZWN0Jyk7IGlmKG9iamVjdHNbaWR4XSkgeyBjYW52YXMucmVtb3ZlKG9iamVjdHNbaWR4XSk7IHRoaXMudXBkYXRlT3V0cHV0KCk7IH0gfSwKICAgICAgICAgICAgICAgIGltcG9ydEFyZWFzOiBmdW5jdGlvbihhcmVhcywgc2NhbGUpIHsgY2FudmFzLmdldE9iamVjdHMoJ3JlY3QnKS5mb3JFYWNoKG8gPT4gY2FudmFzLnJlbW92ZShvKSk7IGFyZWFzLmZvckVhY2goYSA9PiB7IHZhciByID0gbmV3IGZhYnJpYy5SZWN0KHsgbGVmdDogYS5ib3VuZHMueCAqIHNjYWxlLCB0b3A6IGEuYm91bmRzLnkgKiBzY2FsZSwgd2lkdGg6IGEuYm91bmRzLndpZHRoICogc2NhbGUsIGhlaWdodDogYS5ib3VuZHMuaGVpZ2h0ICogc2NhbGUsIGZpbGw6ICdyZ2JhKDg0LCAxOTIsIDk3LCAwLjMpJywgc3Ryb2tlOiAnIzU0QzA2MScsIHN0cm9rZVdpZHRoOiAxIH0pOyByLmFjdGlvbiA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoYS5hY3Rpb24gfHwgeyB0eXBlOiAnbWVzc2FnZScsIHRleHQ6ICcnIH0pKTsgY2FudmFzLmFkZChyKTsgfSk7IGNhbnZhcy5yZW5kZXJBbGwoKTsgdGhpcy51cGRhdGVPdXRwdXQoKTsgfSwKICAgICAgICAgICAgICAgIG9wZW5EZXBsb3lNb2RhbDogKCkgPT4geyAKICAgICAgICAgICAgICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGVwbG95LWFwaS11cmwnKS52YWx1ZSA9ICh3aW5kb3cucGFyZW50ICYmIHdpbmRvdy5wYXJlbnQuV09SS0VSX1VSTCkgPyB3aW5kb3cucGFyZW50LldPUktFUl9VUkwgOiAod2luZG93LmxvY2F0aW9uLm9yaWdpbiArICcvJyk7IAogICAgICAgICAgICAgICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkZXBsb3ktZXJyb3ItbXNnJykuY2xhc3NMaXN0LmFkZCgnaGlkZGVuJyk7CiAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RlcGxveS1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ2hpZGRlbicpOyAKICAgICAgICAgICAgICAgIH0sCiAgICAgICAgICAgICAgICBjbG9zZURlcGxveU1vZGFsOiAoKSA9PiB7CiAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RlcGxveS1lcnJvci1tc2cnKS5jbGFzc0xpc3QuYWRkKCdoaWRkZW4nKTsKICAgICAgICAgICAgICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGVwbG95LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnaGlkZGVuJyk7CiAgICAgICAgICAgICAgICB9LAogICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICBleGVjdXRlRGVwbG95OiBhc3luYyBmdW5jdGlvbigpIHsgCiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWVudU9ialN0ciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdqc29uLW91dHB1dCcpLnZhbHVlOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVyckJveCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkZXBsb3ktZXJyb3ItbXNnJyk7CiAgICAgICAgICAgICAgICAgICAgZXJyQm94LmNsYXNzTGlzdC5hZGQoJ2hpZGRlbicpOwogICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgIGNvbnN0IHNob3dFcnJvciA9IChtc2cpID0+IHsKICAgICAgICAgICAgICAgICAgICAgICAgZXJyQm94LmlubmVyVGV4dCA9IGDwn5qrIOeZvOeUn+mMr+iqpO+8mlxuJHttc2d9YDsKICAgICAgICAgICAgICAgICAgICAgICAgZXJyQm94LmNsYXNzTGlzdC5yZW1vdmUoJ2hpZGRlbicpOwogICAgICAgICAgICAgICAgICAgIH07CgogICAgICAgICAgICAgICAgICAgIGlmICghbWVudU9ialN0ciB8fCBtZW51T2JqU3RyID09PSAne30nKSByZXR1cm4gc2hvd0Vycm9yKCfoq4vlhYjkuIrlgrPlupXlnJbkuKblioPlrproh7PlsJHkuIDlgIvljYDln5/vvIEnKTsKICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICBjb25zdCBtZW51T2JqID0gSlNPTi5wYXJzZShtZW51T2JqU3RyKTsKICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICBpZiAoIW1lbnVPYmoubmFtZSkgcmV0dXJuIHNob3dFcnJvcign5bem5YG044CM6YG45Zau5ZCN56ix44CN5LiN5Y+v54K656m677yBJyk7CiAgICAgICAgICAgICAgICAgICAgaWYgKCFtZW51T2JqLmNoYXRCYXJUZXh0KSByZXR1cm4gc2hvd0Vycm9yKCflt6blgbTjgIzpgbjllq7liJfmloflrZfjgI3kuI3lj6/ngrrnqbrvvIEnKTsKICAgICAgICAgICAgICAgICAgICBpZiAoIW1lbnVPYmouYXJlYXMgfHwgbWVudU9iai5hcmVhcy5sZW5ndGggPT09IDApIHJldHVybiBzaG93RXJyb3IoJ+iri+iHs+WwkeWcqOeVq+mdouS4iuWKg+WumuS4gOWAi+eGseWNgO+8gScpOwogICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgIC8vIOKchSDmt7Hluqbmt6jljJYgQWN0aW9u77ya56K65L+dIFBvc3RiYWNrIOeahCBEYXRhIOW/heWhq++8jOS4puS4lOato+eiuuaUr+aPtCBkaXNwbGF5VGV4dAogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbWVudU9iai5hcmVhcy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3Rpb24gPSBtZW51T2JqLmFyZWFzW2ldLmFjdGlvbjsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGlvbi50eXBlID09PSAnbWVzc2FnZScgJiYgIWFjdGlvbi50ZXh0KSByZXR1cm4gc2hvd0Vycm9yKGDljYDln58gIyR7aSsxfSDlsJrmnKrloavlr6vjgIzlgrPpgIHmloflrZfjgI3lhaflrrnvvIFgKTsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGlvbi50eXBlID09PSAndXJpJyAmJiAhYWN0aW9uLnVyaSkgcmV0dXJuIHNob3dFcnJvcihg5Y2A5Z+fICMke2krMX0g5bCa5pyq5aGr5a+r44CM6ZaL5ZWf57ay5Z2A44CN6YCj57WQ77yBYCk7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhY3Rpb24udHlwZSA9PT0gJ3Bvc3RiYWNrJyAmJiAhYWN0aW9uLmRhdGEpIHJldHVybiBzaG93RXJyb3IoYOWNgOWfnyAjJHtpKzF9IOWwmuacquWhq+Wvq+OAjOWbnuWCsyBEYXRh44CN77yB6YCZ5piv6Ke455m85b6M5Y+w5Yqf6IO955qE5b+F5aGr5Y+D5pW444CCYCk7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhY3Rpb24udHlwZSA9PT0gJ3JpY2htZW51c3dpdGNoJykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFhY3Rpb24ucmljaE1lbnVBbGlhc0lkKSByZXR1cm4gc2hvd0Vycm9yKGDljYDln58gIyR7aSsxfSDlsJrmnKrloavlr6vjgIzliKXlkI0gQWxpYXMgSUTjgI3vvIHkvovlpoLvvJptZW51MSDmiJYgbWVudTLjgIJgKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghYWN0aW9uLmRhdGEpIHJldHVybiBzaG93RXJyb3IoYOWNgOWfnyAjJHtpKzF9IOWwmuacquWhq+Wvq+OAjOWPg+aVuCBkYXRh44CN77yBTElORSDliIfmj5vpgbjllq7lv4XpoIjluLYgZGF0YeOAgmApOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwdXJlQWN0aW9uID0geyB0eXBlOiBhY3Rpb24udHlwZSB9OwogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aW9uLnR5cGUgPT09ICd1cmknKSBwdXJlQWN0aW9uLnVyaSA9IGFjdGlvbi51cmk7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhY3Rpb24udHlwZSA9PT0gJ21lc3NhZ2UnKSBwdXJlQWN0aW9uLnRleHQgPSBhY3Rpb24udGV4dDsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGlvbi50eXBlID09PSAncG9zdGJhY2snKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwdXJlQWN0aW9uLmRhdGEgPSBhY3Rpb24uZGF0YTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhY3Rpb24uZGlzcGxheVRleHQpIHB1cmVBY3Rpb24uZGlzcGxheVRleHQgPSBhY3Rpb24uZGlzcGxheVRleHQ7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChhY3Rpb24udGV4dCkgcHVyZUFjdGlvbi5kaXNwbGF5VGV4dCA9IGFjdGlvbi50ZXh0OwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhY3Rpb24udHlwZSA9PT0gJ3JpY2htZW51c3dpdGNoJykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgcHVyZUFjdGlvbi5yaWNoTWVudUFsaWFzSWQgPSBhY3Rpb24ucmljaE1lbnVBbGlhc0lkOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgcHVyZUFjdGlvbi5kYXRhID0gYWN0aW9uLmRhdGE7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgbWVudU9iai5hcmVhc1tpXS5hY3Rpb24gPSBwdXJlQWN0aW9uOwogICAgICAgICAgICAgICAgICAgIH0KCiAgICAgICAgICAgICAgICAgICAgY29uc3QgaCA9IG1lbnVPYmouc2l6ZS5oZWlnaHQ7CiAgICAgICAgICAgICAgICAgICAgaWYgKE1hdGguYWJzKGggLSAxNjg2KSA8IDEwMCkgbWVudU9iai5zaXplLmhlaWdodCA9IDE2ODY7CiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoTWF0aC5hYnMoaCAtIDg0MykgPCAxMDApIG1lbnVPYmouc2l6ZS5oZWlnaHQgPSA4NDM7CiAgICAgICAgICAgICAgICAgICAgZWxzZSByZXR1cm4gc2hvd0Vycm9yKGDmgqjkuIrlgrPnmoTlnJbniYfmr5TkvovkuI3nrKblkIggTElORSDopo/nr4TvvIFcbuebruWJjeWwuuWvuOeCuu+8mjI1MDB4JHtofVxuTElORSDopo/lrprlv4XpoIjngrrvvJoyNTAweDE2ODYgKOWkp+mBuOWWrikg5oiWIDI1MDB4ODQzICjlsI/pgbjllq4pXG7oq4vph43mlrDoo4HliIflnJbniYflvozkuIrlgrPjgIJgKTsKCiAgICAgICAgICAgICAgICAgICAgY29uc3QgYjY0VG9TZW5kID0gdGhpcy5nZXRDdXJyZW50QmFzZTY0KCk7CiAgICAgICAgICAgICAgICAgICAgaWYgKCFiNjRUb1NlbmQgfHwgIWI2NFRvU2VuZC5zdGFydHNXaXRoKCdkYXRhOmltYWdlJykpIHsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHNob3dFcnJvcign4p2MIOe8uuWwkeOAjOmBuOWWruW6leWcluOAje+8gUxJTkUg5a6Y5pa56KaP5a6a6YOo572y5pmC5b+F6aCI5aS+5bi25ZyW54mH44CC6KuL5Zyo55Wr6Z2i5LiK6YeN5paw5LiK5YKz5oKo55qE5ZyW54mH44CCJyk7CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGVwbG95LXN1Ym1pdC1idG4nKTsKICAgICAgICAgICAgICAgICAgICBidG4uaW5uZXJIVE1MID0gJzxpIGNsYXNzPSJmYXMgZmEtc3Bpbm5lciBmYS1zcGluIG1yLTIiPjwvaT7pg6jnvbLkuK0uLi4nOwogICAgICAgICAgICAgICAgICAgIGJ0bi5kaXNhYmxlZCA9IHRydWU7CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IEFwaUhlbHBlci5jYWxsKCdERVBMT1lfUklDSF9NRU5VJywgeyAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJpY2hNZW51Q29uZmlnOiBtZW51T2JqLCAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGltYWdlQmFzZTY0OiBiNjRUb1NlbmQsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcmVhczogbWVudU9iai5hcmVhcywKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNpemU6IG1lbnVPYmouc2l6ZSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG1lbnVPYmoubmFtZSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsaWFzSWQ6IG1lbnVPYmoubmFtZSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXRCYXJUZXh0OiBtZW51T2JqLmNoYXRCYXJUZXh0CiAgICAgICAgICAgICAgICAgICAgICAgIH0pOyAKICAgICAgICAgICAgICAgICAgICAgICAgaWYoZGF0YSkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgYWxlcnQoJ+KchSDpg6jnvbLmiJDlip/vvIHoq4voh7MgTElORSDlrpjmlrnluLPomZ/mn6XnnIvmnIDmlrDpgbjllq7jgIInKTsgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNsb3NlRGVwbG95TW9kYWwoKTsgCiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIHNob3dFcnJvcihlLm1lc3NhZ2UpOwogICAgICAgICAgICAgICAgICAgIH0gZmluYWxseSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGJ0bi5pbm5lckhUTUwgPSAn5ZWf5YuV6YOo572yJzsKICAgICAgICAgICAgICAgICAgICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9OwogICAgICAgIH0pKCk7CgogICAgICAgIHdpbmRvdy5TdG9yYWdlTW9kdWxlID0gKGZ1bmN0aW9uKCkgewogICAgICAgICAgICBsZXQgY3VycmVudFNhdmVzID0gW10sIGN1cnJlbnRJZCA9IG51bGw7CiAgICAgICAgICAgIGNvbnN0IHNhdmVUaW1lVmFsdWUgPSAoaXRlbSkgPT4gewogICAgICAgICAgICAgICAgY29uc3QgaXNvVGltZSA9IERhdGUucGFyc2UoaXRlbT8udXBkYXRlZEF0IHx8ICcnKTsKICAgICAgICAgICAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUoaXNvVGltZSkpIHJldHVybiBpc29UaW1lOwogICAgICAgICAgICAgICAgY29uc3QgZGF0ZVRpbWUgPSBEYXRlLnBhcnNlKGl0ZW0/LmRhdGUgfHwgJycpOwogICAgICAgICAgICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZShkYXRlVGltZSkpIHJldHVybiBkYXRlVGltZTsKICAgICAgICAgICAgICAgIGNvbnN0IGlkVGltZSA9IE51bWJlcihTdHJpbmcoaXRlbT8uaWQgfHwgJycpLnJlcGxhY2UoL1xEL2csICcnKSk7CiAgICAgICAgICAgICAgICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKGlkVGltZSkgPyBpZFRpbWUgOiAwOwogICAgICAgICAgICB9OwogICAgICAgICAgICBjb25zdCBzb3J0U2F2ZXMgPSAoc2F2ZXMpID0+IChBcnJheS5pc0FycmF5KHNhdmVzKSA/IHNhdmVzIDogW10pLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gc2F2ZVRpbWVWYWx1ZShiKSAtIHNhdmVUaW1lVmFsdWUoYSkpOwogICAgICAgICAgICBjb25zdCByZWFkTG9jYWxTYXZlcyA9ICgpID0+IHsKICAgICAgICAgICAgICAgIHRyeSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJpbWFyeSA9IEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oJ3JpY2hfbWVudV9zYXZlcycpIHx8ICdbXScpOwogICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnkpICYmIHByaW1hcnkubGVuZ3RoKSByZXR1cm4gcHJpbWFyeTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBiYWNrdXAgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKCdyaWNoX21lbnVfc2F2ZXNfYmFja3VwJykgfHwgJ1tdJyk7CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoYmFja3VwKSA/IGJhY2t1cCA6IFtdOwogICAgICAgICAgICAgICAgfSBjYXRjaChlKSB7IHJldHVybiBbXTsgfQogICAgICAgICAgICB9OwogICAgICAgICAgICBjb25zdCBjYWNoZUxvY2FsU2F2ZXMgPSAoc2F2ZXMpID0+IHsKICAgICAgICAgICAgICAgIHRyeSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV4dCA9IEFycmF5LmlzQXJyYXkoc2F2ZXMpID8gc2F2ZXMuc2xpY2UoMCwgNSkgOiBbXTsKICAgICAgICAgICAgICAgICAgICBpZiAoIW5leHQubGVuZ3RoKSByZXR1cm47CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgncmljaF9tZW51X3NhdmVzJyk7CiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nICYmIGV4aXN0aW5nICE9PSAnW10nKSBsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgncmljaF9tZW51X3NhdmVzX2JhY2t1cCcsIGV4aXN0aW5nKTsKICAgICAgICAgICAgICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgncmljaF9tZW51X3NhdmVzJywgSlNPTi5zdHJpbmdpZnkobmV4dCkpOwogICAgICAgICAgICAgICAgfSBjYXRjaChlKSB7fQogICAgICAgICAgICB9OwogICAgICAgICAgICByZXR1cm4gewogICAgICAgICAgICAgICAgdG9nZ2xlRHJhd2VyOiBmdW5jdGlvbigpIHsgY29uc3QgZCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyaWdodC1kcmF3ZXInKTsgY29uc3QgbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyaWdodC1kcmF3ZXItb3ZlcmxheScpOyBpZiAoZC5jbGFzc0xpc3QuY29udGFpbnMoJ3RyYW5zbGF0ZS14LWZ1bGwnKSkgeyBkLmNsYXNzTGlzdC5yZW1vdmUoJ3RyYW5zbGF0ZS14LWZ1bGwnKTsgby5jbGFzc0xpc3QucmVtb3ZlKCdoaWRkZW4nKTsgdGhpcy5yZW5kZXJMaXN0KCk7IH0gZWxzZSB7IGQuY2xhc3NMaXN0LmFkZCgndHJhbnNsYXRlLXgtZnVsbCcpOyBvLmNsYXNzTGlzdC5hZGQoJ2hpZGRlbicpOyB9IH0sCiAgICAgICAgICAgICAgICBzYXZlQ3VycmVudDogYXN5bmMgZnVuY3Rpb24oaXNOZXcpIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBiYXNlNjQgPSBNZW51TW9kdWxlLmdldEN1cnJlbnRCYXNlNjQoKTsKICAgICAgICAgICAgICAgICAgICBpZighYmFzZTY0KSByZXR1cm4gYWxlcnQoJ+iri+WFiOi8ieWFpeWclueJhycpOwoKICAgICAgICAgICAgICAgICAgICBsZXQganNvbiA9IHt9OwogICAgICAgICAgICAgICAgICAgIHRyeSB7IGpzb24gPSBKU09OLnBhcnNlKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdqc29uLW91dHB1dCcpLnZhbHVlKTsgfSBjYXRjaChlKSB7fQoKICAgICAgICAgICAgICAgICAgICBjb25zdCBuYW1lID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NhdmUtZmlsZW5hbWUnKS52YWx1ZTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBpbWFnZVRvU2F2ZSA9IE1lbnVNb2R1bGUuZ2V0Q3VycmVudEJhc2U2NCgpOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkID0gKGlzTmV3IHx8ICFjdXJyZW50SWQpID8gRGF0ZS5ub3coKS50b1N0cmluZygpIDogY3VycmVudElkOwogICAgICAgICAgICAgICAgICAgIHRyeSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IEFwaUhlbHBlci5jYWxsKCdBRE1JTl9TQVZFX1JJQ0hfTUVOVScsIHsgaWQsIG5hbWUsIGRhdGE6IGpzb24sIGltYWdlOiBpbWFnZVRvU2F2ZSB9KTsKICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudElkID0gcmVzPy5pdGVtPy5pZCB8fCBpZDsKICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudFNhdmVzID0gc29ydFNhdmVzKHJlcz8uc2F2ZXMgfHwgW10pOwogICAgICAgICAgICAgICAgICAgICAgICBjYWNoZUxvY2FsU2F2ZXMoY3VycmVudFNhdmVzKTsKICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5yZW5kZXJMaXN0KGZhbHNlKTsKICAgICAgICAgICAgICAgICAgICAgICAgYWxlcnQoJ+KchSDlhLLlrZjmiJDlip/vvIzlhbbku5YgQWRtaW4g6YeN5paw5pW055CG5b6M5Lmf5Y+v55yL5Yiw44CCJyk7CiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaChlKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGFsZXJ0KCfinYwg5YSy5a2Y5aSx5pWX77yaJyArIGUubWVzc2FnZSk7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgIGxvYWRGcm9tSW5kZXg6IGZ1bmN0aW9uKGlkeCkgewogICAgICAgICAgICAgICAgICAgIHRyeSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGl0ZW0gPSBjdXJyZW50U2F2ZXNbaWR4XTsgaWYoIWl0ZW0pIHJldHVybjsgCiAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJlbnRJZCA9IGl0ZW0uaWQ7IAogICAgICAgICAgICAgICAgICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2F2ZS1maWxlbmFtZScpLnZhbHVlID0gaXRlbS5uYW1lOyAKICAgICAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JpY2gtbWVudS1jaGF0YmFyJykudmFsdWUgPSBpdGVtLmRhdGE/LmNoYXRCYXJUZXh0IHx8ICLpgbjllq4iOyAKICAgICAgICAgICAgICAgICAgICAgICAgTWVudU1vZHVsZS5sb2FkKGl0ZW0ubmFtZSwgZW5jb2RlVVJJQ29tcG9uZW50KEpTT04uc3RyaW5naWZ5KGl0ZW0uZGF0YSkpLCBpdGVtLmltYWdlKTsgCiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudG9nZ2xlRHJhd2VyKCk7CiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaChlKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGFsZXJ0KCfinYwg6LyJ5YWl5aSx5pWX77yM5qqU5qGI5Y+v6IO95bey5pCN5q+AJyk7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgIGRlbGV0ZUZyb21JbmRleDogYXN5bmMgZnVuY3Rpb24oaWR4KSB7CiAgICAgICAgICAgICAgICAgICAgaWYoIWNvbmZpcm0oJ+eiuuWumuawuOS5heWIqumZpOatpOmBuOWWrue0gOmMhO+8nycpKSByZXR1cm47CiAgICAgICAgICAgICAgICAgICAgY29uc3QgaXRlbSA9IGN1cnJlbnRTYXZlc1tpZHhdOwogICAgICAgICAgICAgICAgICAgIGlmICghaXRlbSkgcmV0dXJuOwogICAgICAgICAgICAgICAgICAgIHRyeSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IEFwaUhlbHBlci5jYWxsKCdBRE1JTl9ERUxFVEVfUklDSF9NRU5VX1NBVkUnLCB7IGlkOiBpdGVtLmlkIH0pOwogICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50U2F2ZXMgPSBzb3J0U2F2ZXMocmVzPy5zYXZlcyB8fCBbXSk7CiAgICAgICAgICAgICAgICAgICAgICAgIGNhY2hlTG9jYWxTYXZlcyhjdXJyZW50U2F2ZXMpOwogICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnJlbmRlckxpc3QoZmFsc2UpOwogICAgICAgICAgICAgICAgICAgIH0gY2F0Y2goZSkgewogICAgICAgICAgICAgICAgICAgICAgICBhbGVydCgn4p2MIOWIqumZpOWkseaVl++8micgKyBlLm1lc3NhZ2UpOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0sCiAgICAgICAgICAgICAgICByZW5kZXJMaXN0OiBhc3luYyBmdW5jdGlvbihhbGxvd01pZ3JhdGUgPSB0cnVlKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NhdmVkLWZpbGVzLWxpc3QnKTsKICAgICAgICAgICAgICAgICAgICBjb250YWluZXIuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9InRleHQtY2VudGVyIHRleHQtc2xhdGUtNDAwIGZvbnQtYm9sZCBweS04Ij48aSBjbGFzcz0iZmFzIGZhLXNwaW5uZXIgZmEtc3BpbiBtci0yIj48L2k+6LyJ5YWl6YG45Zau5qqU5qGI5bqrLi4uPC9kaXY+JzsKICAgICAgICAgICAgICAgICAgICB0cnkgewogICAgICAgICAgICAgICAgICAgICAgICBsZXQgcmVtb3RlU2F2ZXMgPSBhd2FpdCBBcGlIZWxwZXIuY2FsbCgnQURNSU5fR0VUX1JJQ0hfTUVOVV9TQVZFUycsIHt9KTsKICAgICAgICAgICAgICAgICAgICAgICAgcmVtb3RlU2F2ZXMgPSBBcnJheS5pc0FycmF5KHJlbW90ZVNhdmVzKSA/IHJlbW90ZVNhdmVzIDogW107CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxvY2FsU2F2ZXMgPSByZWFkTG9jYWxTYXZlcygpOwogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtaWdyYXRlZCA9IGxvY2FsU3RvcmFnZS5nZXRJdGVtKCdyaWNoX21lbnVfc2F2ZXNfY2xvdWRfbWlncmF0ZWQnKSA9PT0gJ3RydWUnOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWxsb3dNaWdyYXRlICYmICFtaWdyYXRlZCAmJiBsb2NhbFNhdmVzLmxlbmd0aCkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVtb3RlSWRzID0gbmV3IFNldChyZW1vdGVTYXZlcy5tYXAoaXRlbSA9PiBTdHJpbmcoaXRlbT8uaWQgfHwgJycpKSk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbG9jYWxTYXZlcykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpdGVtICYmIGl0ZW0uaWQgJiYgIXJlbW90ZUlkcy5oYXMoU3RyaW5nKGl0ZW0uaWQpKSkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBBcGlIZWxwZXIuY2FsbCgnQURNSU5fU0FWRV9SSUNIX01FTlUnLCBpdGVtKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgncmljaF9tZW51X3NhdmVzX2Nsb3VkX21pZ3JhdGVkJywgJ3RydWUnKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbW90ZVNhdmVzID0gYXdhaXQgQXBpSGVscGVyLmNhbGwoJ0FETUlOX0dFVF9SSUNIX01FTlVfU0FWRVMnLCB7fSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudFNhdmVzID0gc29ydFNhdmVzKHJlbW90ZVNhdmVzKTsKICAgICAgICAgICAgICAgICAgICAgICAgY2FjaGVMb2NhbFNhdmVzKGN1cnJlbnRTYXZlcyk7CiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaChlKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7CiAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJlbnRTYXZlcyA9IFtdOwogICAgICAgICAgICAgICAgICAgICAgICBjb250YWluZXIuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9ImJnLXJlZC01MCBib3JkZXIgYm9yZGVyLXJlZC0xMDAgdGV4dC1yZWQtNjAwIHAtNCByb3VuZGVkLXhsIHRleHQtc20gZm9udC1ib2xkIj7pm7Lnq6/mqpTmoYjluqvovInlhaXlpLHmlZfvvJoke2UubWVzc2FnZX08ZGl2IGNsYXNzPSJtdC0yIHRleHQteHMgdGV4dC1yZWQtNTAwIj7oq4vph43mlrDnmbvlhaXlvozlho3plovllZ/lnJbmlofpgbjllq7vvJvmqpTmoYjluqvnj77lnKjku6Xpm7Lnq6/ngrrmupbvvIzkuI3lho3oroDlj5bmnKzmqZ/mmqvlrZjjgII8L2Rpdj48L2Rpdj5gOwogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIGlmICghY3VycmVudFNhdmVzLmxlbmd0aCkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsb2NhbFNhdmVzID0gcmVhZExvY2FsU2F2ZXMoKTsKICAgICAgICAgICAgICAgICAgICAgICAgY29udGFpbmVyLmlubmVySFRNTCA9IGxvY2FsU2F2ZXMubGVuZ3RoCiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGA8ZGl2IGNsYXNzPSJiZy1hbWJlci01MCBib3JkZXIgYm9yZGVyLWFtYmVyLTEwMCB0ZXh0LWFtYmVyLTcwMCBwLTQgcm91bmRlZC14bCB0ZXh0LXNtIGZvbnQtYm9sZCI+6Zuy56uv55uu5YmN5rKS5pyJ5qqU5qGI77yM5L2G6YCZ5Y+w54CP6Ka95Zmo5pyJICR7bG9jYWxTYXZlcy5sZW5ndGh9IOS7veacrOapn+iIiuaqlOOAgjxidXR0b24gb25jbGljaz0iU3RvcmFnZU1vZHVsZS5taWdyYXRlTG9jYWxUb0Nsb3VkKCkiIGNsYXNzPSJtdC0zIHctZnVsbCBweS0yIGJnLWFtYmVyLTYwMCB0ZXh0LXdoaXRlIHJvdW5kZWQtbGcgZm9udC1ibGFjayI+6YG356e75pys5qmf6IiK5qqU5Yiw6Zuy56uvPC9idXR0b24+PC9kaXY+YAogICAgICAgICAgICAgICAgICAgICAgICAgICAgOiAnPGRpdiBjbGFzcz0idGV4dC1jZW50ZXIgdGV4dC1zbGF0ZS00MDAgZm9udC1ib2xkIHB5LTgiPuebruWJjeaykuacieW3suWEsuWtmOeahOmBuOWWrjwvZGl2Pic7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgY29udGFpbmVyLmlubmVySFRNTCA9IGN1cnJlbnRTYXZlcy5tYXAoKGl0ZW0sIGlkeCkgPT4gYAogICAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPSJiZy13aGl0ZSBwLTUgcm91bmRlZC0yeGwgYm9yZGVyIGJvcmRlci1zbGF0ZS0yMDAgc2hhZG93LXNtIHJlbGF0aXZlIj4KICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gb25jbGljaz0iU3RvcmFnZU1vZHVsZS5kZWxldGVGcm9tSW5kZXgoJHtpZHh9KSIgY2xhc3M9ImFic29sdXRlIHRvcC00IHJpZ2h0LTQgdGV4dC1zbGF0ZS0zMDAgaG92ZXI6dGV4dC1yZWQtNTAwIj48aSBjbGFzcz0iZmFzIGZhLXRyYXNoLWFsdCI+PC9pPjwvYnV0dG9uPgogICAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz0iZm9udC1ibGFjayB0ZXh0LXNtIG1iLTEiPiR7aXRlbS5uYW1lfTwvZGl2PgogICAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz0idGV4dC1bMTFweF0gdGV4dC1zbGF0ZS00MDAgbWItMSI+JHtpdGVtLmRhdGUgfHwgJyd9PC9kaXY+CiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPSJ0ZXh0LVsxMXB4XSB0ZXh0LXNsYXRlLTQwMCBtYi00Ij4ke2l0ZW0udXBkYXRlZEJ5TmFtZSA/IGDlhLLlrZjogIXvvJoke2l0ZW0udXBkYXRlZEJ5TmFtZX1gIDogJyd9PC9kaXY+CiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIG9uY2xpY2s9IlN0b3JhZ2VNb2R1bGUubG9hZEZyb21JbmRleCgke2lkeH0pIiBjbGFzcz0idy1mdWxsIHB5LTIgYmctb3JhbmdlLTUwIHRleHQtb3JhbmdlLTYwMCBmb250LWJsYWNrIHJvdW5kZWQteGwgYm9yZGVyIGJvcmRlci1vcmFuZ2UtMTAwIHRleHQtWzEzcHhdIj7ovInlhaXpgbjllq48L2J1dHRvbj4KICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgICAgICAgYCkuam9pbignJyk7CiAgICAgICAgICAgICAgICB9LAogICAgICAgICAgICAgICAgbWlncmF0ZUxvY2FsVG9DbG91ZDogYXN5bmMgZnVuY3Rpb24oKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NhdmVkLWZpbGVzLWxpc3QnKTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBsb2NhbFNhdmVzID0gcmVhZExvY2FsU2F2ZXMoKTsKICAgICAgICAgICAgICAgICAgICBpZiAoIWxvY2FsU2F2ZXMubGVuZ3RoKSByZXR1cm4gdGhpcy5yZW5kZXJMaXN0KGZhbHNlKTsKICAgICAgICAgICAgICAgICAgICBjb250YWluZXIuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9InRleHQtY2VudGVyIHRleHQtc2xhdGUtNDAwIGZvbnQtYm9sZCBweS04Ij48aSBjbGFzcz0iZmFzIGZhLXNwaW5uZXIgZmEtc3BpbiBtci0yIj48L2k+5q2j5Zyo6YG356e75pys5qmf6IiK5qqU5Yiw6Zuy56uvLi4uPC9kaXY+JzsKICAgICAgICAgICAgICAgICAgICB0cnkgewogICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbG9jYWxTYXZlcykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGl0ZW0gJiYgaXRlbS5pZCkgYXdhaXQgQXBpSGVscGVyLmNhbGwoJ0FETUlOX1NBVkVfUklDSF9NRU5VJywgaXRlbSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oJ3JpY2hfbWVudV9zYXZlc19jbG91ZF9taWdyYXRlZCcsICd0cnVlJyk7CiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucmVuZGVyTGlzdChmYWxzZSk7CiAgICAgICAgICAgICAgICAgICAgICAgIGFsZXJ0KCflt7Lpgbfnp7vliLDpm7Lnq6/vvIzlhbbku5YgYWRtaW4g6YeN5paw5pW055CG5b6M5Y2z5Y+v55yL5Yiw44CCJyk7CiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaChlKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRhaW5lci5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz0iYmctcmVkLTUwIGJvcmRlciBib3JkZXItcmVkLTEwMCB0ZXh0LXJlZC02MDAgcC00IHJvdW5kZWQteGwgdGV4dC1zbSBmb250LWJvbGQiPumBt+enu+WkseaVl++8miR7ZS5tZXNzYWdlfTwvZGl2PmA7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9OwogICAgICAgIH0pKCk7IAogICAgICAgIE1lbnVNb2R1bGUuaW5pdCgpOwogICAgPC9zY3JpcHQ+CjwvYm9keT4KPC9odG1sPgo=";

function renderRichMenuEditorPage() {
  const bytes = Uint8Array.from(atob(GUSYS_HOOKTEA_MENU_HTML_BASE64), c => c.charCodeAt(0));
  const html = new TextDecoder().decode(bytes);
  return new Response(html, { headers: HTML_HEADERS });
}

async function handleHookteaMenuAction(request, env) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();
  const payload = body.payload || {};
  try {
    let data = null;
    if (action === "ADMIN_GET_RICH_MENU_SAVES") {
      requireDb(env);
      data = await getHookteaRichMenuSaves(env);
    } else if (action === "ADMIN_SAVE_RICH_MENU") {
      requireDb(env);
      const id = String(payload.id || Date.now()).trim();
      const name = String(payload.name || "New Rich Menu").trim() || "New Rich Menu";
      const config = normalizeGusysRichMenuConfig(payload.data || payload.config || {}, { name, chatBarText: payload.data?.chatBarText || "選單" });
      const aliasId = normalizeRichMenuAliasId(payload.aliasId || config.aliasId || name || id);
      const imageDataUrl = String(payload.image || payload.imageDataUrl || "").trim();
      await env.DB.prepare(`
        INSERT INTO rich_menus (
          id, name, alias_id, chat_bar_text, config_json, image_data_url, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          alias_id = excluded.alias_id,
          chat_bar_text = excluded.chat_bar_text,
          config_json = excluded.config_json,
          image_data_url = excluded.image_data_url,
          status = CASE WHEN rich_menus.status = 'deployed' THEN 'updated' ELSE rich_menus.status END,
          updated_at = datetime('now')
      `).bind(id, name, aliasId, String(config.chatBarText || "選單"), JSON.stringify(config), imageDataUrl).run();
      const saves = await getHookteaRichMenuSaves(env);
      const item = saves.find(item => String(item.id) === id) || { id, name, data: config, image: imageDataUrl };
      data = { success: true, item, saves };
    } else if (action === "ADMIN_DELETE_RICH_MENU_SAVE") {
      requireDb(env);
      const id = String(payload.id || "").trim();
      if (!id) throw new Error("缺少圖文選單 ID");
      await env.DB.prepare(`DELETE FROM rich_menus WHERE id = ?`).bind(id).run();
      data = { success: true, saves: await getHookteaRichMenuSaves(env) };
    } else if (action === "UPLOAD_IMAGE") {
      data = { url: String(payload.imageBase64 || "") };
    } else if (action === "DEPLOY_RICH_MENU") {
      data = await deployHookteaRichMenuPayload(env, payload);
    } else {
      throw new Error("unsupported_action: " + action);
    }
    return json({ status: "success", data });
  } catch (error) {
    return json({ status: "error", message: String(error?.message || error) }, 400);
  }
}

async function getHookteaRichMenuSaves(env) {
  const { results } = await env.DB.prepare(`
    SELECT id, name, config_json AS configJson, image_data_url AS imageDataUrl,
           line_rich_menu_id AS lineRichMenuId, status, updated_at AS updatedAt, created_at AS createdAt
    FROM rich_menus
    ORDER BY updated_at DESC
    LIMIT 100
  `).all();
  return (results || []).map(row => ({
    id: row.id,
    name: row.name,
    date: row.updatedAt || row.createdAt || "",
    updatedAt: row.updatedAt || "",
    data: parseJson(row.configJson || "{}", {}),
    image: row.imageDataUrl || "",
    lineRichMenuId: row.lineRichMenuId || "",
    status: row.status || "draft",
  }));
}

async function deployHookteaRichMenuPayload(env, payload) {
  const token = String(env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();
  if (!token) throw new Error("Cloudflare 尚未綁定 LINE_CHANNEL_ACCESS_TOKEN 金鑰！");
  const richMenuConfig = normalizeGusysRichMenuConfig(payload.richMenuConfig || payload.menuObject || {
    size: payload.size,
    selected: true,
    name: payload.name,
    chatBarText: payload.chatBarText,
    areas: payload.areas,
  }, { name: payload.name, chatBarText: payload.chatBarText });
  const imageDataUrl = String(payload.imageBase64 || payload.image || "").trim();
  const image = parseDataUrlImage(imageDataUrl);
  if (!image) throw new Error("圖文選單圖片格式有誤：請使用 JPG 或 PNG 圖片。");
  const createRes = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(richMenuConfig),
  });
  const createText = await createRes.text();
  if (!createRes.ok) throw new Error("建立 LINE 選單失敗: " + createText);
  const richMenuId = parseJson(createText, {}).richMenuId;
  const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": image.contentType },
    body: image.bytes,
  });
  const uploadText = await uploadRes.text();
  if (!uploadRes.ok) throw new Error("上傳圖片至 LINE 失敗: " + uploadText);
  const defaultRes = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}` },
  });
  const defaultText = await defaultRes.text();
  if (!defaultRes.ok) throw new Error("設定 LINE 預設選單失敗: " + defaultText);
  const richMenuAliasId = await upsertGusysRichMenuAlias(token, payload.aliasId || richMenuConfig.aliasId || richMenuConfig.name, richMenuId);
  return { success: true, richMenuId, richMenuAliasId };
}
async function listRichMenus(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const { results } = await env.DB.prepare(`
    SELECT id, name, alias_id AS aliasId, chat_bar_text AS chatBarText,
           config_json AS configJson, image_data_url AS imageDataUrl,
           line_rich_menu_id AS lineRichMenuId, status, deployed_at AS deployedAt,
           created_at AS createdAt, updated_at AS updatedAt
    FROM rich_menus
    ORDER BY updated_at DESC
    LIMIT 100
  `).all();
  return json({ ok: true, data: (results || []).map(row => ({
    ...row,
    config: parseJson(row.configJson || "{}", {}),
    hasImage: Boolean(row.imageDataUrl),
  })) });
}

async function saveRichMenu(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const payload = await request.json().catch(() => ({}));
  const id = String(payload.id || crypto.randomUUID()).trim();
  const name = String(payload.name || "Gusys 圖文選單").trim();
  const aliasId = normalizeRichMenuAliasId(payload.aliasId || name || id);
  const chatBarText = String(payload.chatBarText || payload.config?.chatBarText || "Gusys 選單").trim();
  const config = normalizeGusysRichMenuConfig(payload.config || parseJson(payload.configJson || "{}", {}), { name, chatBarText, aliasId });
  const imageDataUrl = String(payload.imageDataUrl || payload.image || "").trim();
  await env.DB.prepare(`
    INSERT INTO rich_menus (
      id, name, alias_id, chat_bar_text, config_json, image_data_url, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      alias_id = excluded.alias_id,
      chat_bar_text = excluded.chat_bar_text,
      config_json = excluded.config_json,
      image_data_url = excluded.image_data_url,
      status = CASE WHEN rich_menus.status = 'deployed' THEN 'updated' ELSE rich_menus.status END,
      updated_at = datetime('now')
  `).bind(id, name, aliasId, chatBarText, JSON.stringify(config), imageDataUrl).run();
  const row = await getRichMenuById(env, id);
  return json({ ok: true, data: row });
}

async function deleteRichMenu(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return json({ ok: false, error: "missing_rich_menu_id" }, 400);
  await env.DB.prepare(`DELETE FROM rich_menus WHERE id = ?`).bind(id).run();
  return json({ ok: true, data: { id } });
}

async function deployRichMenu(request, env) {
  requireAdmin(request, env);
  requireDb(env);
  const token = String(env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();
  if (!token) return json({ ok: false, error: "line_channel_access_token_missing" }, 400);
  const payload = await request.json().catch(() => ({}));
  const id = String(payload.id || "").trim();
  const saved = id ? await getRichMenuById(env, id) : null;
  const name = String(payload.name || saved?.name || "Gusys 圖文選單").trim();
  const aliasId = normalizeRichMenuAliasId(payload.aliasId || saved?.aliasId || name);
  const chatBarText = String(payload.chatBarText || saved?.chatBarText || "Gusys 選單").trim();
  const config = normalizeGusysRichMenuConfig(payload.config || saved?.config || {}, { name, chatBarText, aliasId });
  const imageDataUrl = String(payload.imageDataUrl || saved?.imageDataUrl || "").trim();
  if (!imageDataUrl) return json({ ok: false, error: "rich_menu_image_required" }, 400);

  const createRes = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  const createText = await createRes.text();
  if (!createRes.ok) return json({ ok: false, error: "line_rich_menu_create_failed", detail: createText }, 400);
  const richMenuId = parseJson(createText, {}).richMenuId;

  const image = parseDataUrlImage(imageDataUrl);
  if (!image) return json({ ok: false, error: "invalid_rich_menu_image" }, 400);
  const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": image.contentType },
    body: image.bytes,
  });
  const uploadText = await uploadRes.text();
  if (!uploadRes.ok) return json({ ok: false, error: "line_rich_menu_image_upload_failed", detail: uploadText }, 400);

  const defaultRes = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}` },
  });
  const defaultText = await defaultRes.text();
  if (!defaultRes.ok) return json({ ok: false, error: "line_rich_menu_default_failed", detail: defaultText }, 400);

  const richMenuAliasId = aliasId ? await upsertGusysRichMenuAlias(token, aliasId, richMenuId) : "";
  if (id) {
    await env.DB.prepare(`
      UPDATE rich_menus
      SET line_rich_menu_id = ?, alias_id = ?, status = 'deployed', deployed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).bind(richMenuId, richMenuAliasId || aliasId, id).run();
  }
  return json({ ok: true, data: { richMenuId, richMenuAliasId } });
}

async function getRichMenuById(env, id) {
  const row = await env.DB.prepare(`
    SELECT id, name, alias_id AS aliasId, chat_bar_text AS chatBarText,
           config_json AS configJson, image_data_url AS imageDataUrl,
           line_rich_menu_id AS lineRichMenuId, status, deployed_at AS deployedAt,
           created_at AS createdAt, updated_at AS updatedAt
    FROM rich_menus
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();
  if (!row) return null;
  return { ...row, config: parseJson(row.configJson || "{}", {}), hasImage: Boolean(row.imageDataUrl) };
}

function normalizeRichMenuAliasId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function normalizeGusysRichMenuConfig(config, meta = {}) {
  const base = config && typeof config === "object" ? { ...config } : {};
  base.size = base.size || { width: 2500, height: 1686 };
  base.selected = base.selected !== false;
  base.name = String(base.name || meta.name || "Gusys Rich Menu").slice(0, 300);
  base.chatBarText = String(base.chatBarText || meta.chatBarText || "Gusys 選單").slice(0, 14);
  base.areas = Array.isArray(base.areas) ? base.areas : defaultGusysRichMenuAreas();
  return base;
}

function defaultGusysRichMenuAreas() {
  const w = 2500;
  const h = 1686;
  const col = Math.floor(w / 3);
  const row = Math.floor(h / 2);
  const labels = ["會員分享", "業務綁定", "點數查詢", "商品目錄", "訂單查詢", "聯絡客服"];
  return labels.map((label, i) => ({
    bounds: { x: (i % 3) * col, y: Math.floor(i / 3) * row, width: i % 3 === 2 ? w - col * 2 : col, height: row },
    action: { type: "message", text: label },
  }));
}

function parseDataUrlImage(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const binary = atob(match[2].replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { contentType, bytes };
}

async function upsertGusysRichMenuAlias(token, aliasId, richMenuId) {
  const normalized = normalizeRichMenuAliasId(aliasId);
  if (!normalized || !richMenuId) return "";
  const payload = JSON.stringify({ richMenuAliasId: normalized, richMenuId });
  const createRes = await fetch("https://api.line.me/v2/bot/richmenu/alias", {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: payload,
  });
  if (createRes.ok) return normalized;
  const updateRes = await fetch(`https://api.line.me/v2/bot/richmenu/alias/${encodeURIComponent(normalized)}`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ richMenuId }),
  });
  if (!updateRes.ok) throw new Error(await updateRes.text());
  return normalized;
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
  const motherUrl = env.MEMBER_CENTER_URL || env.MOTHER_MEMBER_URL || "https://aiwe.cc/index.php/line_login/10279/";
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
      <p>正在開啟母站會員頁。若未自動跳轉，請按下方按鈕。</p>
      <p><a id="motherLink" href="${escapeHtml(motherUrl)}">開啟母站會員頁</a></p>
      <p class="code">業務代碼已由 Gusys 保留：${escapeHtml(salesCode || "未帶入")}</p>
      <p>測試綁定用欄位：</p>
      <input id="lineUserId" placeholder="LINE User ID">
      <input id="displayName" placeholder="客戶姓名">
      <input id="phone" placeholder="電話">
      <button id="bind">建立綁定</button>
      <p id="result"></p>
    </div>
  </main>
  <script>
    const salesCode = ${JSON.stringify(salesCode)};
    const motherUrl = ${JSON.stringify(motherUrl)};
    if (motherUrl) setTimeout(() => { location.href = motherUrl; }, 900);
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
  const workerBase = String(env.WORKER_PUBLIC_URL || "https://gusys.fangwl591021.workers.dev").replace(/\/+$/, "");
  const url = new URL(`${workerBase}/sales/invite`);
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
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--dark);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}button,input,select{font:inherit}
    .sidebar{position:fixed;inset:0 auto 0 0;width:240px;background:#fff;border-right:1px solid var(--border);z-index:20;display:flex;flex-direction:column}.sidebar-brand{padding:18px;border-bottom:1px solid var(--border)}.brand-title{font-size:20px;font-weight:800}.brand-subtitle{margin-top:4px;color:var(--muted)}.nav{padding:14px 10px;overflow:auto}.nav-group-header{padding:14px 10px 8px;color:#374151;font-size:12px;font-weight:800;letter-spacing:.04em}.nav-item{width:100%;border:0;background:transparent;border-radius:8px;color:#111827;display:flex;align-items:center;gap:10px;padding:10px 12px;text-align:left;cursor:pointer}.nav-item:hover{background:#f3f4f6}.nav-active{background:#e9fbea;color:#047a32;font-weight:800}
    .main-content{margin-left:240px;min-height:100vh}.page-header{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.96);border-bottom:1px solid var(--border);padding:14px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px}.page-title{font-size:21px;font-weight:800}.page-subtitle{margin-top:3px;color:var(--muted)}.header-actions{display:flex;align-items:center;gap:8px}.content{padding:20px 22px 36px;max-width:1280px}.view{display:none}.view.active{display:block}
    .stats-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:14px}.stat-card,.panel{background:#fff;border:1px solid var(--border);border-radius:8px}.stat-card{padding:16px}.stat-label{color:var(--muted);font-size:13px}.stat-value{font-size:30px;font-weight:800;margin-top:8px}.panel{margin-bottom:14px;overflow:hidden}.panel-header{padding:13px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px}.section-title{font-size:16px;font-weight:800}.panel-body{padding:16px}.admin-table-container{overflow:auto}.admin-table{width:100%;border-collapse:collapse;min-width:760px}.admin-table th,.admin-table td{padding:11px 12px;border-bottom:1px solid #edf0f3;text-align:left;vertical-align:top}.admin-table th{background:#fafafa;color:#667085;font-size:12px;font-weight:800}.admin-table tr:hover td{background:#fbfbfb}
    .form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}input,select{border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:10px 11px;min-width:0}.btn-green-main{border:1px solid #079447;background:var(--line);color:#fff;border-radius:8px;padding:10px 14px;font-weight:800;cursor:pointer}.btn-outline{border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:8px;padding:10px 14px;cursor:pointer}.btn-small{padding:7px 10px;border-radius:7px}.status-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;background:#ecfdf3;color:#067647;font-size:12px;font-weight:800}.status-badge.warn{background:#fffaeb;color:var(--warn)}.status-badge.danger{background:#fef2f2;color:var(--danger)}.muted{color:var(--muted)}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.empty{padding:24px;text-align:center;color:var(--muted)}.ops-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.ops-item{border:1px solid var(--border);border-radius:8px;padding:14px;background:#fff}.ops-label{color:var(--muted);font-size:13px}.ops-value{margin-top:6px;font-weight:800;word-break:break-all}.qr{width:76px;height:76px;border:1px solid var(--border);border-radius:8px;background:#fff}.summary-text{max-width:360px;white-space:normal;word-break:break-word}.login-cover{position:fixed;inset:0;background:rgba(17,24,39,.34);z-index:50;display:none;align-items:center;justify-content:center;padding:18px}.login-box{width:min(420px,100%);background:#fff;border-radius:10px;border:1px solid var(--border);padding:20px}.login-title{font-size:20px;font-weight:800;margin-bottom:6px}.login-box input{width:100%;margin:14px 0 10px}
    .crm-toolbar{padding:18px 0;display:flex;align-items:center;gap:14px;border-bottom:1px solid #eef2f7}.crm-search{width:min(480px,100%);font-weight:800;color:#334155}.member-cell{display:flex;align-items:center;gap:14px}.member-avatar{width:50px;height:50px;border-radius:999px;background:#f1f5f9;border:1px solid #dbe3ee;display:inline-flex;align-items:center;justify-content:center;color:#64748b;font-weight:900;overflow:hidden;object-fit:cover}.member-name{font-size:16px;font-weight:900;color:#0f172a}.crm-action{background:#eff6ff;color:#1d4ed8;border:0;border-radius:6px;padding:8px 13px;font-weight:900;cursor:pointer}.tier-badge{display:inline-flex;padding:6px 10px;border-radius:6px;background:#fff7ed;border:1px solid #fed7aa;color:#c2410c;font-weight:900}.crm-modal-mask{position:fixed;inset:0;background:rgba(15,23,42,.32);z-index:100;display:none;align-items:flex-start;justify-content:center;overflow:auto}.crm-modal-body{width:min(1180px,calc(100vw - 36px));margin:18px auto;background:#f8fafc;border-radius:0 0 10px 10px;box-shadow:0 24px 60px rgba(15,23,42,.24);overflow:hidden}.crm-modal-header{height:90px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;padding:0 28px}.crm-modal-title{display:flex;align-items:center;gap:14px;font-size:24px;font-weight:900}.crm-member-id{font-size:13px;background:#f1f5f9;border:1px solid #dbe3ee;border-radius:10px;padding:9px 14px;color:#64748b;font-weight:900}.crm-close{border:0;background:transparent;color:#94a3b8;font-size:36px;line-height:1;cursor:pointer}.crm-modal-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(360px,.8fr);gap:38px;padding:40px}.crm-card{background:#fff;border:1px solid #dbe3ee;border-radius:18px;box-shadow:0 1px 2px rgba(15,23,42,.04);overflow:hidden}.crm-card-body{padding:30px}.crm-card-title{font-size:22px;font-weight:900;margin-bottom:20px;color:#172033}.crm-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px 24px}.crm-label{display:block;color:#64748b;font-weight:900;margin-bottom:8px}.crm-input{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:14px 16px;font-weight:900;color:#0f172a}.crm-tag-grid{border:1px solid #dbe3ee;background:#f8fafc;border-radius:14px;padding:14px;display:flex;gap:10px;flex-wrap:wrap}.crm-tag{border:1px solid #dbe3ee;background:#fff;border-radius:999px;padding:8px 14px;font-weight:900;color:#334155}.point-summary{text-align:center;position:relative;padding:32px}.point-label{font-weight:900;color:#94a3b8}.point-balance{font-size:52px;font-weight:900;color:#dc2626;margin:14px 0 26px}.point-actions{display:flex;gap:14px}.point-btn{flex:1;border-radius:12px;padding:16px;border:1px solid;font-weight:900;cursor:pointer}.point-add{background:#ecfdf3;border-color:#bbf7d0;color:#16a34a}.point-deduct{background:#fff1f2;border-color:#fecdd3;color:#dc2626}.point-history{height:318px;overflow:auto}.point-log{display:flex;justify-content:space-between;gap:16px;padding:18px 24px;border-bottom:1px solid #eef2f7}.point-log-title{font-weight:900;color:#1e293b}.point-log-date{font-size:12px;color:#94a3b8;margin-top:4px}.point-log-amt{font-size:20px;font-weight:900}.crm-modal-footer{background:#fff;border-top:1px solid #e2e8f0;padding:24px 34px;display:flex;justify-content:flex-end;gap:24px}.crm-save{min-width:230px;box-shadow:0 16px 30px rgba(6,199,85,.22)}.rich-grid{display:grid;grid-template-columns:minmax(320px,.9fr) minmax(0,1.4fr);gap:16px}.rich-list{display:grid;gap:10px}.rich-item{border:1px solid var(--border);border-radius:8px;background:#fff;padding:12px;cursor:pointer}.rich-item.active{border-color:#06c755;box-shadow:0 0 0 2px #dcfce7}.rich-editor{display:grid;gap:12px}.rich-textarea{width:100%;min-height:160px;border:1px solid #cbd5e1;border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.rich-preview{aspect-ratio:2500/1686;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;background:linear-gradient(135deg,#ecfdf3,#eff6ff);display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr)}.rich-preview-cell{border:1px solid rgba(15,23,42,.12);display:flex;align-items:center;justify-content:center;text-align:center;font-weight:900;color:#0f172a;background:rgba(255,255,255,.72)}.rich-actions{display:flex;flex-wrap:wrap;gap:10px}.rich-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.rich-form-grid input{width:100%}
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
    <section class="view" id="view-richmenu"><section class="panel" style="height:calc(100vh - 140px);margin-bottom:0"><iframe src="/menu.html?v=hooktea-port-20260703" style="width:100%;height:100%;border:0;display:block"></iframe></section></section>
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
            <div><label class="crm-label">註冊日期</label><input id="crmDate" class="crm-input" readonly></div><div><label class="crm-label">身分</label><select id="crmCustomerType" class="crm-input"><option value="customer">一般客戶</option><option value="sales">業務</option></select></div><div><label class="crm-label">介紹人</label><input id="crmReferrer" class="crm-input" placeholder="介紹人 LINE UID"></div>
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
    let adminToken = localStorage.getItem("gusys_admin_token") || ""; let adminCustomers = []; let activeCustomer = null; let richMenus = []; let activeRichMenu = null; const qs = s => document.querySelector(s); const qsa = s => Array.from(document.querySelectorAll(s));
    const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); const money = v => new Intl.NumberFormat("zh-TW").format(Number(v || 0));
    qs("#adminToken").value = adminToken; function headers(){ return adminToken ? {"x-admin-token":adminToken} : {}; } function badge(text,tone){ return '<span class="status-badge '+(tone||"")+'">'+esc(text)+'</span>'; }
    async function api(path,opt){ const init = opt || {}; init.headers = Object.assign({"content-type":"application/json"}, headers(), init.headers || {}); const res = await fetch(path, init); const data = await res.json().catch(() => ({ok:false,error:"bad_json"})); if(!res.ok || !data.ok){ const err = new Error(data.error || data.message || ("HTTP "+res.status)); err.status = res.status; throw err; } return data.data || data; }
    function setView(view){ qsa(".nav-item").forEach(btn => btn.classList.toggle("nav-active", btn.dataset.view === view)); qsa(".view").forEach(section => section.classList.toggle("active", section.id === "view-" + view)); const title = titles[view] || titles.dashboard; qs("#pageTitle").textContent = title[0]; qs("#pageSubtitle").textContent = title[1]; }
    qs("#nav").addEventListener("click", e => { const btn = e.target.closest(".nav-item"); if(btn) setView(btn.dataset.view); }); document.body.addEventListener("click", e => { const jump = e.target.closest("[data-jump]"); if(jump) setView(jump.dataset.jump); });
    qs("#saveToken").onclick = () => { adminToken = qs("#adminToken").value.trim(); localStorage.setItem("gusys_admin_token", adminToken); qs("#loginCover").style.display = "none"; loadAll(); }; qs("#loginSubmit").onclick = () => { adminToken = qs("#loginToken").value.trim(); qs("#adminToken").value = adminToken; localStorage.setItem("gusys_admin_token", adminToken); qs("#loginCover").style.display = "none"; loadAll(); }; qs("#refreshAll").onclick = () => loadAll();
    qs("#createSales").onclick = async () => { try{ await api("/api/sales/reps",{method:"POST",body:JSON.stringify({name:qs("#salesName").value,phone:qs("#salesPhone").value,lineUserId:qs("#salesLine").value,salesCode:qs("#salesCode").value})}); qs("#salesStatus").textContent = "已建立"; await Promise.all([loadSales(),loadSummary()]); }catch(err){ qs("#salesStatus").textContent = err.message; } };
    qs("#createProduct").onclick = async () => { try{ await api("/api/products",{method:"POST",body:JSON.stringify({sku:qs("#productSku").value,category:qs("#productCategory").value,name:qs("#productName").value,price:qs("#productPrice").value,cost:qs("#productCost").value,stockQty:qs("#productStock").value,safetyStockQty:qs("#productSafety").value})}); qs("#productStatus").textContent = "已建立"; await Promise.all([loadProducts(),loadSummary()]); }catch(err){ qs("#productStatus").textContent = err.message; } };
    qs("#runAi").onclick = async () => { qs("#aiRunStatus").textContent = "分析中"; try{ await api("/api/ai-monitor/analyze",{method:"POST",body:JSON.stringify({limit:30})}); qs("#aiRunStatus").textContent = "完成"; await loadAi(); }catch(err){ qs("#aiRunStatus").textContent = err.message; } }; qs("#loadReport").onclick = () => loadReports(); qs("#customerSearch").addEventListener("input", () => renderCustomers()); qs("#crmClose").onclick = closeCrmModal; qs("#crmCancel").onclick = closeCrmModal; qs("#crmSave").onclick = saveCustomerCrm; qs("#syncProfiles").onclick = syncProfiles; qs("#grantPoints").onclick = () => submitPointAdjust("earn"); qs("#deductPoints").onclick = () => submitPointAdjust("spend");
    function showUnauthorized(){ qs("#systemStatus").textContent = "需要 token"; qs("#systemStatus").className = "status-badge warn"; qs("#loginCover").style.display = "flex"; } function tableEmpty(cols,text){ return '<tr><td colspan="'+cols+'" class="empty">'+esc(text)+'</td></tr>'; }
    async function loadSummary(){ const s = await api("/api/admin/summary"); qs("#metrics").innerHTML = [["業務",s.sales],["用戶",s.customers],["商品",s.products],["LINE 訊息",s.messages],["母站轉送",s.webhooks],["高風險",s.highRisk]].map(i => '<div class="stat-card"><div class="stat-label">'+esc(i[0])+'</div><div class="stat-value">'+money(i[1])+'</div></div>').join(""); const latest = s.latestMother || {}; const motherState = latest.motherStatus ? "HTTP " + latest.motherStatus : "尚無紀錄"; qs("#opsSummary").innerHTML = [["Worker",publicUrl],["LINE Webhook",publicUrl+"/line-webhook"],["母站 Webhook",motherUrl],["最近母站轉送",motherState],["最近訊息",latest.messageText||"尚無"],["最近時間",latest.createdAt||"尚無"]].map(i => '<div class="ops-item"><div class="ops-label">'+esc(i[0])+'</div><div class="ops-value">'+esc(i[1])+'</div></div>').join(""); qs("#lastRefresh").textContent = new Date().toLocaleString("zh-TW"); qs("#systemStatus").textContent = "正常"; qs("#systemStatus").className = "status-badge"; }
    async function loadSales(){ const rows = await api("/api/sales/reps"); qs("#salesRows").innerHTML = rows.map(r => '<tr><td><strong>'+esc(r.name)+'</strong><div class="muted">'+esc(r.phone)+'</div></td><td class="mono">'+esc(r.salesCode)+'</td><td>'+(r.qrUrl?'<img class="qr" src="'+esc(r.qrUrl)+'" alt="QR">':"-")+'</td><td><a href="'+esc(r.inviteUrl)+'" target="_blank">開啟</a><div class="mono summary-text">'+esc(r.inviteUrl)+'</div></td><td>'+badge(r.status||"active")+'</td></tr>').join("") || tableEmpty(5,"尚無業務"); }
    async function loadCustomers(){ adminCustomers = await api("/api/admin/customers"); renderCustomers(); } function displayMemberName(r){ const name = String(r.displayName || "").trim(); const uid = String(r.lineUserId || "").trim(); return name && name !== uid ? name : "LINE 會員"; } function customerTypeLabel(r){ return String(r.customerType || "customer") === "sales" ? "業務" : "一般客戶"; } function memberInitial(r){ return displayMemberName(r).trim().slice(0,1).toUpperCase(); } function memberAvatarHtml(r){ return r.pictureUrl ? '<img class="member-avatar" src="'+esc(r.pictureUrl)+'" alt="">' : '<span class="member-avatar">'+esc(memberInitial(r))+'</span>'; } function renderCustomers(){ const q = (qs("#customerSearch")?.value || "").trim().toLowerCase(); const rows = adminCustomers.filter(r => !q || [displayMemberName(r),r.displayName,r.lineUserId,r.salesName,r.salesCode,customerTypeLabel(r),r.referrerName,r.referrerLineUserId].join(" ").toLowerCase().includes(q)); qs("#customerRows").innerHTML = rows.map(r => '<tr><td><div class="member-cell">'+memberAvatarHtml(r)+'<div><div class="member-name">'+esc(displayMemberName(r))+'</div><div class="muted">'+esc(r.status||"active")+'</div></div></div></td><td class="mono">'+esc(r.lineUserId)+'</td><td><span class="tier-badge">'+esc(customerTypeLabel(r))+'</span><div class="muted">'+esc(r.referrerName ? ("介紹人：" + r.referrerName) : (r.referrerLineUserId ? ("介紹人：" + r.referrerLineUserId) : "介紹人：未設定"))+'</div></td><td>'+esc((r.firstSeenAt||"").slice(0,10))+'</td><td><button class="crm-action" data-crm="'+esc(r.lineUserId)+'">CRM 檔案</button></td></tr>').join("") || tableEmpty(5,"尚無會員"); qsa("[data-crm]").forEach(btn => btn.onclick = () => openCustomerDetail(btn.dataset.crm)); } function setReferrerField(current){ qs("#crmReferrer").value = current?.referrerLineUserId || ""; } async function syncProfiles(){ qs("#syncProfileStatus").textContent = "同步中"; try{ const result = await api("/api/admin/customers/sync-profiles",{method:"POST",body:JSON.stringify({limit:200})}); qs("#syncProfileStatus").textContent = "已更新 " + money(result.updated || 0) + " 位"; await loadCustomers(); }catch(err){ qs("#syncProfileStatus").textContent = err.message; } } function closeCrmModal(){ activeCustomer = null; qs("#crmModal").style.display = "none"; } async function openCustomerDetail(lineUserId){ activeCustomer = adminCustomers.find(r => r.lineUserId === lineUserId); if(!activeCustomer) return; qs("#crmModal").style.display = "flex"; qs("#crmAvatar").outerHTML = activeCustomer.pictureUrl ? '<img class="member-avatar" id="crmAvatar" src="'+esc(activeCustomer.pictureUrl)+'" alt="">' : '<span class="member-avatar" id="crmAvatar">'+esc(memberInitial(activeCustomer))+'</span>'; qs("#crmTitle").textContent = "會員檔案：" + displayMemberName(activeCustomer); qs("#crmMemberId").textContent = "LINE UID：" + activeCustomer.lineUserId; qs("#crmName").value = displayMemberName(activeCustomer) === "LINE 會員" ? "" : displayMemberName(activeCustomer); qs("#crmUid").value = activeCustomer.lineUserId; qs("#crmSales").value = (activeCustomer.salesName||"未綁定") + (activeCustomer.salesCode ? " / " + activeCustomer.salesCode : ""); qs("#crmDate").value = (activeCustomer.firstSeenAt||"").slice(0,10); qs("#crmCustomerType").value = activeCustomer.customerType === "sales" ? "sales" : "customer"; setReferrerField(activeCustomer); qs("#crmTags").innerHTML = ["一般會員","VIP","團購主","企業客戶","經銷夥伴","LINE 會員","購物會員","點數轉入","高風險","黑名單","A-首購客","B-回購客","C-潛在顧客"].map(t => '<span class="crm-tag">'+esc(t)+'</span>').join(""); await loadCustomerPoints(); } async function saveCustomerCrm(){ if(!activeCustomer) return; const payload = {lineUserId:activeCustomer.lineUserId,displayName:qs("#crmName").value,customerType:qs("#crmCustomerType").value,referrerLineUserId:qs("#crmReferrer").value}; qs("#pointStatus").textContent = "儲存中"; try{ const saved = await api("/api/admin/customers",{method:"PATCH",body:JSON.stringify(payload)}); const idx = adminCustomers.findIndex(r => r.lineUserId === saved.lineUserId); if(idx >= 0) adminCustomers[idx] = Object.assign({}, adminCustomers[idx], saved); activeCustomer = Object.assign({}, activeCustomer, saved); renderCustomers(); qs("#pointStatus").textContent = "CRM 檔案已儲存"; closeCrmModal(); }catch(err){ qs("#pointStatus").textContent = err.message; } } function normalizePointLogs(result){ const nested = result?.data?.data?.data || result?.data?.data || result?.data || {}; return Array.isArray(result.logs) ? result.logs : (Array.isArray(nested.list) ? nested.list : (Array.isArray(result.items) ? result.items : [])); } function pointAmount(log){ return Number(log.get_point||log.points||log.amount||log.point||0) || 0; } function pointBalance(result, logs){ if(Array.isArray(logs) && logs.length) return logs.reduce((sum, log) => sum + pointAmount(log), 0); return Number(result.balance ?? 0) || 0; } function pointEmptyReason(result){ const query = result.query || result?.data?.data?.data?.query || {}; if(result.notFoundAsEmpty) return "母站尚無此會員點數紀錄"; if(result.ok && Number(result?.pagination?.total || 0) === 0) return "母站查得到會員，但此 LINE UID 目前沒有點數紀錄"; return result.message || result.error || "目前尚無紀錄"; } async function loadCustomerPoints(){ if(!activeCustomer) return; qs("#pointStatus").textContent = "點數讀取中"; qs("#pointBalance").textContent = "0"; try{ const result = await api("/api/points/list?lineUserId=" + encodeURIComponent(activeCustomer.lineUserId)); const logs = normalizePointLogs(result); const balance = pointBalance(result, logs); qs("#pointBalance").textContent = money(balance); qs("#pointStatus").textContent = result.skipped ? (result.error || "點數 API 尚未設定") : "點數已更新"; qs("#pointRows").innerHTML = logs.map(log => { const amt = pointAmount(log); const sign = amt >= 0 ? "+" : "-"; return '<div class="point-log"><div><div class="point-log-title">'+esc(log.event_content||log.eventContent||log.reason||log.event_name||log.eventName||"點數異動")+'</div><div class="point-log-date">'+esc(log.created_at||log.createdAt||log.date||"")+'</div></div><div class="point-log-amt" style="color:'+(amt>=0?'#06c755':'#dc2626')+'">'+sign+money(Math.abs(amt))+'</div></div>'; }).join("") || '<div class="empty">'+esc(pointEmptyReason(result))+'</div>'; }catch(err){ qs("#pointStatus").textContent = err.message; qs("#pointRows").innerHTML = '<div class="empty">點數資料讀取失敗</div>'; } } async function submitPointAdjust(type){ if(!activeCustomer) return; const raw = Number(qs("#pointAmount").value || 0); const reason = qs("#pointReason").value.trim(); if(!raw || raw <= 0){ qs("#pointStatus").textContent = "請輸入大於 0 的點數"; return; } if(!reason){ qs("#pointStatus").textContent = "請填寫異動原因"; return; } const points = type === "spend" ? -Math.abs(raw) : Math.abs(raw); qs("#pointStatus").textContent = "送出中"; try{ const result = await api("/api/points/adjust",{method:"POST",body:JSON.stringify({lineUserId:activeCustomer.lineUserId,eventName:type === "spend" ? "後台扣點" : "後台贈點",eventContent:reason,points})}); qs("#pointStatus").textContent = result.skipped ? (result.error || "點數 API 尚未設定") : "點數調整完成"; await loadCustomerPoints(); }catch(err){ qs("#pointStatus").textContent = err.message; } }
    function defaultRichConfig(){ const w=2500,h=1686,c=Math.floor(w/3),r=Math.floor(h/2); const labels=["會員分享","業務綁定","點數查詢","商品目錄","訂單查詢","聯絡客服"]; return {size:{width:w,height:h},selected:true,name:"Gusys 會員圖文選單",chatBarText:"Gusys 選單",areas:labels.map((label,i)=>({bounds:{x:(i%3)*c,y:Math.floor(i/3)*r,width:i%3===2?w-c*2:c,height:r},action:{type:"message",text:label}}))}; }
    function setRichForm(menu){ activeRichMenu = menu || {id:"",name:"Gusys 會員圖文選單",aliasId:"gusys-main",chatBarText:"Gusys 選單",config:defaultRichConfig(),imageDataUrl:""}; qs("#richMenuName").value = activeRichMenu.name || ""; qs("#richMenuAlias").value = activeRichMenu.aliasId || ""; qs("#richMenuChatBar").value = activeRichMenu.chatBarText || ""; qs("#richMenuImage").value = activeRichMenu.imageDataUrl || ""; qs("#richMenuJson").value = JSON.stringify(activeRichMenu.config || defaultRichConfig(), null, 2); renderRichPreview(); }
    function newRichMenu(){ setRichForm(null); qs("#richMenuStatus").textContent = "已建立預設草稿"; }
    async function loadRichMenus(){ try{ richMenus = await api("/api/admin/rich-menus"); renderRichMenus(); if(!activeRichMenu) setRichForm(richMenus[0] || null); }catch(err){ qs("#richMenuRows").innerHTML = '<div class="empty">'+esc(err.message)+'</div>'; } }
    function renderRichMenus(){ qs("#richMenuRows").innerHTML = richMenus.map(m => '<div class="rich-item '+(activeRichMenu&&activeRichMenu.id===m.id?'active':'')+'" data-rich-id="'+esc(m.id)+'"><div class="member-name">'+esc(m.name||"未命名選單")+'</div><div class="muted mono">'+esc(m.aliasId||m.id)+'</div><div style="margin-top:8px">'+badge(m.status||"draft",m.status==="deployed"?"":"warn")+'</div><div class="muted" style="margin-top:6px">'+esc(m.updatedAt||"")+'</div></div>').join("") || '<div class="empty">尚無圖文選單檔案</div>'; qsa("[data-rich-id]").forEach(el=>el.onclick=()=>{ const item=richMenus.find(m=>m.id===el.dataset.richId); setRichForm(item); renderRichMenus(); }); }
    function readRichConfig(){ try{ return JSON.parse(qs("#richMenuJson").value || "{}"); }catch(err){ throw new Error("圖文選單 JSON 格式錯誤：" + err.message); } }
    function renderRichPreview(){ let cfg; try{ cfg=readRichConfig(); }catch(_){ cfg={areas:[]}; } const areas=Array.isArray(cfg.areas)?cfg.areas:[]; qs("#richPreview").innerHTML = (areas.length?areas:defaultRichConfig().areas).slice(0,6).map((a,i)=>'<div class="rich-preview-cell">'+esc(a.action?.text||a.action?.label||a.action?.data||('區塊 '+(i+1)))+'</div>').join(""); }
    async function saveRichMenu(){ try{ const payload={id:activeRichMenu?.id||"",name:qs("#richMenuName").value,aliasId:qs("#richMenuAlias").value,chatBarText:qs("#richMenuChatBar").value,imageDataUrl:qs("#richMenuImage").value,config:readRichConfig()}; const saved=await api("/api/admin/rich-menus",{method:"POST",body:JSON.stringify(payload)}); qs("#richMenuStatus").textContent="已儲存"; activeRichMenu=saved; await loadRichMenus(); setRichForm(saved); }catch(err){ qs("#richMenuStatus").textContent=err.message; } }
    async function deployRichMenu(){ if(!confirm("部署後會成為 LINE 官方帳號預設圖文選單，確定送出？")) return; try{ await saveRichMenu(); const result=await api("/api/admin/rich-menus/deploy",{method:"POST",body:JSON.stringify({id:activeRichMenu?.id})}); qs("#richMenuStatus").textContent="已部署："+(result.richMenuId||""); await loadRichMenus(); }catch(err){ qs("#richMenuStatus").textContent=err.message; } }
    async function deleteRichMenu(){ if(!activeRichMenu?.id){ qs("#richMenuStatus").textContent="尚未選擇檔案"; return; } if(!confirm("刪除此圖文選單檔案？")) return; try{ await api("/api/admin/rich-menus?id="+encodeURIComponent(activeRichMenu.id),{method:"DELETE"}); activeRichMenu=null; qs("#richMenuStatus").textContent="已刪除"; await loadRichMenus(); }catch(err){ qs("#richMenuStatus").textContent=err.message; } }    async function loadProducts(){ const rows = await api("/api/products"); qs("#productRows").innerHTML = rows.map(r => '<tr><td><strong>'+esc(r.name)+'</strong></td><td class="mono">'+esc(r.sku)+'</td><td>'+esc(r.category||"")+'</td><td>'+money(r.price)+'</td><td>'+money(r.stockQty)+' / '+money(r.safetyStockQty)+'</td><td>'+badge(r.status||"active", Number(r.stockQty) <= Number(r.safetyStockQty) ? "warn" : "")+'</td></tr>').join("") || tableEmpty(6,"尚無商品"); }
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