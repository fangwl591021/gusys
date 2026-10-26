const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const CATEGORIES = [
  { key: "food", label: "食", title: "在地美食", color: "#ef6c4d" },
  { key: "stay", label: "宿", title: "特色住宿", color: "#7566b5" },
  { key: "visit", label: "遊", title: "順遊景點", color: "#15956f" },
  { key: "shop", label: "購", title: "在地好物", color: "#d39128" },
  { key: "transport", label: "行", title: "交通服務", color: "#397fc6" },
];

const SEED_PLACES = [
  ["food-01","food","樂漁 鮮魚定食×咖啡","0981963626","樂漁 鮮魚定食 咖啡 宜蘭縣礁溪鄉","https://scontent.ftpe8-2.fna.fbcdn.net/v/t39.30808-6/470221522_122183680208093066_3508223117140354266_n.jpg?stp=dst-jpg_s960x960_tt6&_nc_cat=102&ccb=1-7&_nc_sid=cc71e4&_nc_ohc=TxXVuUxomZ0Q7kNvwHmqvj4&_nc_oc=Adl4FpfukSQEaBnDf_3kGQH9NBE8f9scUP0Wj4KUqDH-x_RJ2NEdY20A8D07B3GtCz0&_nc_zt=23&_nc_ht=scontent.ftpe8-2.fna&_nc_gid=95eJPhCo59Dnb4_VT3DEQQ&oh=00_AftrVzKSTQVPUrY4MdrBPmNqCvZh9qUKT4LjbSPmq-YxvQ&oe=69874DB3","店家公開頁面","鮮魚定食、咖啡與礁溪散步行程的用餐選擇。",["午餐","晚餐","親子"]],
  ["food-02","food","小食粑","039889981","小食粑 宜蘭縣礁溪鄉","https://www.jiaoxi-tourism.tw/media/k2/items/cache/0d0c19531d9fbc472527a3d15e284c4d_M.jpg","礁溪旅遊網／店家提供","礁溪市區小吃，適合步行串連湯圍溝周邊。",["小吃","步行","雨天"]],
  ["food-03","food","初 firstday food 早午餐","039887787","初 firstday food 早午餐 宜蘭縣礁溪鄉","https://www.jiaoxi-tourism.tw/media/k2/items/cache/878fa7f78f10cc84ac145fe918a9eb96_M.jpg","礁溪旅遊網／店家提供","適合早晨或中午安排的礁溪早午餐。",["早午餐","親子","步行"]],
  ["food-04","food","空ㄟ農場","0912080102","空ㄟ農場 宜蘭縣礁溪鄉","https://kafkalin.com/wp-content/uploads/2021/03/1615198839-7b93359ecc.jpg","店家公開內容","可眺望蘭陽平原的景觀餐飲，建議開車前往並先確認候位。",["景觀","晚餐","開車"]],
  ["food-05","food","義眾魚羹之家","039883349","義眾魚羹之家 宜蘭縣礁溪鄉","https://www.jiaoxi-tourism.tw/media/k2/items/cache/fc1da7257992fc36032e11db3df7a664_M.jpg","礁溪旅遊網／店家提供","礁溪在地小吃，可搭配市區散步行程。",["小吃","午餐","步行"]],
  ["stay-01","stay","礁溪沐夏民宿","0918396355","礁溪沐夏民宿 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/accommodations/21436/640x480_accommodations-image-ivz2n41x5kchhwhf35kima.jpg","宜蘭勁好玩／業者提供","礁溪住宿選擇，訂房與房況請洽業者。",["住宿","親子","開車"]],
  ["stay-02","stay","瑪林好室 Mori House","0965005135","瑪林好室 Mori House 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/accommodations/25176/640x480_accommodations-image-w3wqathqy0oxblx3xpbduq.jpg","宜蘭勁好玩／業者提供","適合安排礁溪慢旅行的住宿選擇。",["住宿","慢旅","開車"]],
  ["stay-03","stay","佧美．奧之湯 ISPAVITA","039873678","ISPAVITA 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/accommodations/21571/640x480_accommodations-image-0clxjjupqf4pwwmuutxg5a.jpg","宜蘭勁好玩／業者提供","位於礁溪市區，適合步行安排周邊行程。",["住宿","市區","步行"]],
  ["stay-04","stay","枂舍 Yueshe House","0911270663","枂舍 Yueshe House 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/accommodations/27709/640x480_accommodations-image-5uqy1kzphv0wvc4gcxwbjw.jpg","宜蘭勁好玩／業者提供","礁溪特色住宿，實際入住規則請以業者公告為準。",["住宿","慢旅","開車"]],
  ["stay-05","stay","礁溪木BOX田妍山色","0918991193","礁溪木BOX田妍山色 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/accommodations/21497/640x480_accommodations-image-4tgjfbub5zgfw3fplphcuq.jpg","宜蘭勁好玩／業者提供","適合自駕旅客安排的礁溪住宿。",["住宿","田園","開車"]],
  ["visit-01","visit","湯圍溝溫泉公園","039873986","湯圍溝溫泉公園 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/attractions/26358/1024x768_attractions-image-wmwoew3yjegg21dhiuptlq.jpg","宜蘭勁好玩","位於礁溪市區，適合與本店安排同一段步行行程。",["公園","步行","親子","雨天"]],
  ["visit-02","visit","五峰旗瀑布","039887400","五峰旗瀑布 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/attractions/26345/1024x768_attractions-image-iwgtj2x1fq3yufktsqoewq.jpg","宜蘭勁好玩","礁溪自然景點，出發前請留意天候與步道開放狀態。",["自然","步道","開車"]],
  ["visit-03","visit","林美石磐步道","039545114","林美石磐步道 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/attractions/26344/1024x768_attractions-image-kbbcbhbtmxsyvhpchz5cyw.jpg","宜蘭勁好玩","森林步道景點，請依現場公告及開放時間前往。",["自然","步道","開車"]],
  ["visit-04","visit","猴洞坑瀑布","","猴洞坑瀑布 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/attractions/26347/1024x768_attractions-image-hvberwo2moqr12kscgljqa.jpg","宜蘭勁好玩","短程自然景點，雨後路面可能濕滑。",["自然","瀑布","開車"]],
  ["visit-05","visit","龍潭湖風景區","039287144","龍潭湖風景區 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/attractions/26361/1024x768_attractions-image-2myjbeafrjfnqptw2mku0w.jpg","宜蘭勁好玩","環湖散步與親子休閒景點，建議預留較完整時間。",["湖景","親子","開車"]],
  ["shop-01","shop","諾貝爾奶凍 礁溪店","039885919","諾貝爾奶凍 礁溪店 宜蘭縣礁溪鄉","https://www.cakenobel.com.tw/images/menu_images/item01-01.png","諾貝爾奶凍官網","礁溪伴手禮選擇，品項與庫存請以門市為準。",["伴手禮","甜點","步行"]],
  ["shop-02","shop","阿萬之家 礁溪店","039870620","阿萬之家 礁溪店 宜蘭縣礁溪鄉","https://www.jiaoxi-tourism.tw/media/k2/items/cache/c9e8d9069e929f4898939a62f1adcffd_M.jpg","礁溪旅遊網／店家提供","在地伴手禮店，可搭配市區採買。",["伴手禮","步行"]],
  ["shop-03","shop","奕順軒 礁溪店","039876336","奕順軒 礁溪店 宜蘭縣礁溪鄉","https://www.jiaoxi-tourism.tw/media/k2/items/cache/d632334130a2b9d194362b7d857b88bf_M.jpg","礁溪旅遊網／店家提供","宜蘭伴手禮選擇，熱門時段請預留排隊時間。",["伴手禮","甜點","步行"]],
  ["shop-04","shop","礁溪三源行","039883329","礁溪三源行 宜蘭縣礁溪鄉","https://www.samguan.com.tw/archive/image/header_info/FB200116-layout_thumb_1851_913.jpg","三源行官網","可採買宜蘭在地食品與伴手禮。",["伴手禮","在地好物","步行"]],
  ["shop-05","shop","元融 礁溪老爺門市","039885211","元融 礁溪老爺門市 宜蘭縣礁溪鄉","https://www.yuanrong.tw/upload-files/news/36535060_1745809372165205_6985180869996576768_o.jpg","元融官網","甜點與伴手禮選擇，營業資訊請以店家公告為準。",["伴手禮","甜點","開車"]],
  ["transport-01","transport","陸零租車 礁溪轉運站服務點","0983505914","陸零租車 礁溪轉運站服務點 宜蘭縣礁溪鄉","https://60rent.tw/wp-content/uploads/2023/09/%E9%99%B8%E9%9B%B6%E7%A7%9F%E8%BB%8ABN.webp","陸零租車官網","礁溪轉運站周邊租車服務，請先確認取還車方式。",["租車","轉運站"]],
  ["transport-02","transport","灰熊 MOTOR 租車 礁溪店","039883697","灰熊 MOTOR 租車 礁溪店 宜蘭縣礁溪鄉","https://www.tayih.com.tw/upload/images/Ticket/2022/05/05302.jpg","店家公開內容","礁溪機車租賃選擇，承租資格與費用請洽店家。",["租車","機車"]],
  ["transport-03","transport","ZOCHA 礁溪站前無人店","0277136860","ZOCHA 礁溪站前無人店 宜蘭縣礁溪鄉","https://static.wixstatic.com/media/8d2acb_72d31d29226d4adf940f29062a2bbb29~mv2.png/v1/crop/x_85,y_0,w_2497,h_1501/fill/w_1188,h_714,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/%E7%A4%81%E6%BA%AA%E7%AB%99%E5%89%8D.png","ZOCHA 官網","站前交通服務，使用前請先確認預約與操作說明。",["租車","站前"]],
  ["transport-04","transport","葛瑪蘭客運 礁溪站","039876739","葛瑪蘭客運 礁溪站 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/attractions/26815/1920x1080_attractions-image-otobqu8vy06ittqrjf9gma.jpg","宜蘭勁好玩","客運轉乘據點，班次請以客運業者即時公告為準。",["客運","轉運站"]],
  ["transport-05","transport","礁溪轉運站旅遊服務中心","039872998","礁溪轉運站旅遊服務中心 宜蘭縣礁溪鄉","https://travel.yilan.gov.tw/_api/content/images/attractions/26813/480x360_attractions-image-yju6afu2f0g5iewadherwg.jpg","宜蘭勁好玩","可取得礁溪旅遊與轉乘資訊。",["旅服","轉運站","雨天"]],
];

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }
function uidList(value) { return [...new Set(String(value || "").split(/[,，;；\s]+/).map(v => v.trim()).filter(v => /^U[\w-]{8,}$/.test(v)))]; }
function adminAllowed(request, env) {
  const expected = String(env.ADMIN_TOKEN || "").trim();
  if (!expected) return false;
  const url = new URL(request.url);
  return String(request.headers.get("x-admin-token") || url.searchParams.get("token") || "") === expected;
}
function cleanText(value, max = 500) { return String(value || "").trim().slice(0, max); }
function cleanCategory(value) { return CATEGORIES.some(c => c.key === value) ? value : "visit"; }
function placeFromRow(row) {
  return { id: row.id, category: row.category, name: row.name, phone: row.phone || "", address: row.address || "", destination: row.destination || "", googlePlaceId: row.googlePlaceId || "", latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude), imageUrl: row.imageUrl || "", imageSource: row.imageSource || "", imageSourceUrl: row.imageSourceUrl || "", rating: row.rating == null ? null : Number(row.rating), reviewCount: row.reviewCount == null ? null : Number(row.reviewCount), ratingCheckedAt: row.ratingCheckedAt || "", tags: JSON.parse(row.tagsJson || "[]"), summary: row.summary || "", status: row.status || "active", sortOrder: Number(row.sortOrder || 0), updatedAt: row.updatedAt || "" };
}

async function ensureSchema(env) {
  if (!env.DB) throw new Error("db_unavailable");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS jiaoxi_island_places (id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, address TEXT, destination TEXT, google_place_id TEXT, latitude REAL, longitude REAL, image_url TEXT, image_source TEXT, image_source_url TEXT, image_data_url TEXT, rating REAL, review_count INTEGER, rating_checked_at TEXT, tags_json TEXT NOT NULL DEFAULT '[]', summary TEXT, status TEXT NOT NULL DEFAULT 'active', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS jiaoxi_island_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, category TEXT, place_id TEXT, session_hash TEXT, actor_hash TEXT, excluded INTEGER NOT NULL DEFAULT 0, exclude_reason TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jiaoxi_places_category ON jiaoxi_island_places(category, status, sort_order)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jiaoxi_events_created ON jiaoxi_island_events(created_at, excluded)`),
  ]);
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM jiaoxi_island_places").first();
  if (Number(count?.total || 0) > 0) return;
  const statements = SEED_PLACES.map((p, index) => env.DB.prepare(`INSERT OR IGNORE INTO jiaoxi_island_places (id,category,name,phone,destination,image_url,image_source,summary,tags_json,status,sort_order) VALUES (?,?,?,?,?,?,?,?,?,'active',?)`).bind(p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],JSON.stringify(p[8]),index + 1));
  for (let i = 0; i < statements.length; i += 20) await env.DB.batch(statements.slice(i, i + 20));
}

async function listPlaces(env, includeDisabled = false) {
  await ensureSchema(env);
  const result = await env.DB.prepare(`SELECT id,category,name,phone,address,destination,google_place_id AS googlePlaceId,latitude,longitude,CASE WHEN image_data_url IS NOT NULL AND image_data_url <> '' THEN '/api/jiaoxi-islands/images/' || id ELSE image_url END AS imageUrl,image_source AS imageSource,image_source_url AS imageSourceUrl,rating,review_count AS reviewCount,rating_checked_at AS ratingCheckedAt,tags_json AS tagsJson,summary,status,sort_order AS sortOrder,updated_at AS updatedAt FROM jiaoxi_island_places ${includeDisabled ? "" : "WHERE status = 'active'"} ORDER BY CASE category WHEN 'food' THEN 1 WHEN 'stay' THEN 2 WHEN 'visit' THEN 3 WHEN 'shop' THEN 4 ELSE 5 END, sort_order, name`).all();
  return (result.results || []).map(placeFromRow);
}

async function publicConfig(env) {
  const row = await env.DB.prepare("SELECT value_json AS valueJson FROM system_settings WHERE key='hooktea_settings' LIMIT 1").first().catch(() => null);
  const settings = JSON.parse(row?.valueJson || "{}");
  return { liffId: String(settings.liff_id || env.LINE_LIFF_ID || ""), store: { name: "重口味溫泉魚", address: "宜蘭縣礁溪鄉仁愛路23號", phone: "0985197664", destination: "重口味溫泉魚 宜蘭縣礁溪鄉仁愛路23號" }, categories: CATEGORIES };
}

async function exclusionReason(env, lineUserId) {
  if (!lineUserId) return "unattributed";
  const [settingsRow, staffRows] = await Promise.all([
    env.DB.prepare("SELECT value_json AS valueJson FROM system_settings WHERE key='hooktea_settings' LIMIT 1").first().catch(() => null),
    env.DB.prepare("SELECT line_user_id AS uid FROM sales_reps WHERE status='active' UNION SELECT line_user_id AS uid FROM customers WHERE status='active' AND customer_type='sales'").all().catch(() => ({ results: [] })),
  ]);
  const settings = JSON.parse(settingsRow?.valueJson || "{}");
  if (uidList(settings.analytics_excluded_uids).includes(lineUserId)) return "operator";
  if (uidList(settings.crm_login_uids).includes(lineUserId)) return "manager";
  if (uidList(env.BROADCAST_TEST_UID).includes(lineUserId)) return "test";
  if ((staffRows.results || []).some(row => row.uid === lineUserId)) return "staff";
  return "";
}
async function hashValue(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2,"0")).join("");
}

async function recordEvent(request, env) {
  await ensureSchema(env);
  const body = await request.json().catch(() => ({}));
  const eventType = cleanText(body.eventType, 60);
  if (!/^(page_view|category_open|place_open|navigate_current|navigate_store|itinerary_add|itinerary_open)$/.test(eventType)) return json({ ok: false, error: "invalid_event" }, 400);
  const lineUserId = cleanText(body.lineUserId, 80);
  const reason = await exclusionReason(env, lineUserId);
  await env.DB.prepare(`INSERT INTO jiaoxi_island_events (id,event_type,category,place_id,session_hash,actor_hash,excluded,exclude_reason,metadata_json) VALUES (?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), eventType, cleanCategory(body.category), cleanText(body.placeId, 80), await hashValue(cleanText(body.sessionId, 120)), lineUserId ? await hashValue(lineUserId) : "", reason ? 1 : 0, reason, JSON.stringify(body.metadata && typeof body.metadata === "object" ? body.metadata : {})).run();
  return json({ ok: true });
}

async function savePlace(request, env) {
  if (!adminAllowed(request, env)) return json({ ok: false, error: "admin_unauthorized" }, 401);
  await ensureSchema(env);
  const body = await request.json().catch(() => ({}));
  const id = cleanText(body.id || crypto.randomUUID(), 80);
  const name = cleanText(body.name, 160);
  if (!name) return json({ ok: false, error: "name_required" }, 400);
  const latitude = body.latitude === "" || body.latitude == null ? null : Number(body.latitude);
  const longitude = body.longitude === "" || body.longitude == null ? null : Number(body.longitude);
  if ((latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) || (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) return json({ ok: false, error: "invalid_coordinates" }, 400);
  const imageDataUrl = String(body.imageDataUrl || "").trim();
  if (imageDataUrl.length > 900000) return json({ ok: false, error: "image_too_large" }, 400);
  if (imageDataUrl && !/^data:image\/(?:jpeg|png|webp);base64,/i.test(imageDataUrl)) return json({ ok: false, error: "invalid_image" }, 400);
  const rating = body.rating === "" || body.rating == null ? null : Number(body.rating);
  const reviewCount = body.reviewCount === "" || body.reviewCount == null ? null : Number(body.reviewCount);
  if (rating != null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) return json({ ok: false, error: "invalid_rating" }, 400);
  if (reviewCount != null && (!Number.isInteger(reviewCount) || reviewCount < 0)) return json({ ok: false, error: "invalid_review_count" }, 400);
  await env.DB.prepare(`INSERT INTO jiaoxi_island_places (id,category,name,phone,address,destination,google_place_id,latitude,longitude,image_url,image_source,image_source_url,image_data_url,rating,review_count,rating_checked_at,tags_json,summary,status,sort_order,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET category=excluded.category,name=excluded.name,phone=excluded.phone,address=excluded.address,destination=excluded.destination,google_place_id=excluded.google_place_id,latitude=excluded.latitude,longitude=excluded.longitude,image_url=excluded.image_url,image_source=excluded.image_source,image_source_url=excluded.image_source_url,image_data_url=CASE WHEN excluded.image_data_url<>'' THEN excluded.image_data_url ELSE jiaoxi_island_places.image_data_url END,rating=excluded.rating,review_count=excluded.review_count,rating_checked_at=excluded.rating_checked_at,tags_json=excluded.tags_json,summary=excluded.summary,status=excluded.status,sort_order=excluded.sort_order,updated_at=datetime('now')`).bind(id,cleanCategory(body.category),name,cleanText(body.phone,40),cleanText(body.address,240),cleanText(body.destination || `${name} 宜蘭縣礁溪鄉`,240),cleanText(body.googlePlaceId,180),latitude,longitude,cleanText(body.imageUrl,1000),cleanText(body.imageSource || (imageDataUrl ? "店家授權上傳" : ""),160),cleanText(body.imageSourceUrl,1000),imageDataUrl,body.rating === "" || body.rating == null ? null : Number(body.rating),body.reviewCount === "" || body.reviewCount == null ? null : Number(body.reviewCount),cleanText(body.ratingCheckedAt,40),JSON.stringify(Array.isArray(body.tags) ? body.tags.map(v => cleanText(v,40)).filter(Boolean).slice(0,12) : []),cleanText(body.summary,800),body.status === "disabled" ? "disabled" : "active",Math.max(0,Number(body.sortOrder)||0)).run();
  return json({ ok: true, place: (await listPlaces(env, true)).find(place => place.id === id) });
}

async function deletePlace(request, env, id) {
  if (!adminAllowed(request, env)) return json({ ok: false, error: "admin_unauthorized" }, 401);
  await ensureSchema(env);
  await env.DB.prepare("DELETE FROM jiaoxi_island_places WHERE id=?").bind(id).run();
  return json({ ok: true });
}

async function analytics(request, env) {
  if (!adminAllowed(request, env)) return json({ ok: false, error: "admin_unauthorized" }, 401);
  await ensureSchema(env);
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days") || 30)));
  const [summary, byEvent, byPlace, excluded] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS events,COUNT(DISTINCT session_hash) AS sessions FROM jiaoxi_island_events WHERE excluded=0 AND datetime(created_at)>=datetime('now',?)").bind(`-${days} days`).first(),
    env.DB.prepare("SELECT event_type AS eventType,COUNT(*) AS total FROM jiaoxi_island_events WHERE excluded=0 AND datetime(created_at)>=datetime('now',?) GROUP BY event_type ORDER BY total DESC").bind(`-${days} days`).all(),
    env.DB.prepare("SELECT e.place_id AS placeId,p.name,COUNT(*) AS total FROM jiaoxi_island_events e LEFT JOIN jiaoxi_island_places p ON p.id=e.place_id WHERE e.excluded=0 AND e.place_id<>'' AND datetime(e.created_at)>=datetime('now',?) GROUP BY e.place_id,p.name ORDER BY total DESC LIMIT 25").bind(`-${days} days`).all(),
    env.DB.prepare("SELECT exclude_reason AS reason,COUNT(*) AS total FROM jiaoxi_island_events WHERE excluded=1 AND datetime(created_at)>=datetime('now',?) GROUP BY exclude_reason").bind(`-${days} days`).all(),
  ]);
  return json({ ok: true, days, totals: summary || {}, events: byEvent.results || [], places: byPlace.results || [], excluded: excluded.results || [] });
}

export async function handleJiaoxiIslandsApi(request, env, url) {
  if (url.pathname === "/api/jiaoxi-islands/config" && request.method === "GET") return json({ ok: true, ...(await publicConfig(env)) });
  if (url.pathname === "/api/jiaoxi-islands/places" && request.method === "GET") return json({ ok: true, categories: CATEGORIES, places: await listPlaces(env) });
  if (url.pathname === "/api/jiaoxi-islands/events" && request.method === "POST") return recordEvent(request, env);
  if (url.pathname.startsWith("/api/jiaoxi-islands/images/") && request.method === "GET") {
    await ensureSchema(env);
    const id = decodeURIComponent(url.pathname.slice("/api/jiaoxi-islands/images/".length));
    const row = await env.DB.prepare("SELECT image_data_url AS data FROM jiaoxi_island_places WHERE id=?").bind(id).first();
    const match = String(row?.data || "").match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
    if (!match) return new Response("not found", { status: 404 });
    const binary = atob(match[2]); const bytes = new Uint8Array(binary.length); for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    return new Response(bytes, { headers: { "content-type": match[1], "cache-control": "public,max-age=86400" } });
  }
  if (url.pathname === "/api/admin/jiaoxi-islands/places" && request.method === "GET") {
    if (!adminAllowed(request, env)) return json({ ok: false, error: "admin_unauthorized" }, 401);
    return json({ ok: true, categories: CATEGORIES, places: await listPlaces(env, true) });
  }
  if (url.pathname === "/api/admin/jiaoxi-islands/places" && request.method === "POST") return savePlace(request, env);
  if (url.pathname.startsWith("/api/admin/jiaoxi-islands/places/") && request.method === "DELETE") return deletePlace(request, env, decodeURIComponent(url.pathname.slice("/api/admin/jiaoxi-islands/places/".length)));
  if (url.pathname === "/api/admin/jiaoxi-islands/analytics" && request.method === "GET") return analytics(request, env);
  return json({ ok: false, error: "not_found" }, 404);
}
