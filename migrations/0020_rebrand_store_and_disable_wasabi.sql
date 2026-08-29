UPDATE system_settings
SET value_json = json_set(
  value_json,
  '$.shop_hero_title',
  replace(replace(replace(replace(COALESCE(json_extract(value_json, '$.shop_hero_title'), ''), 'HookTea', '重口味溫泉魚'), 'HOOKTEA', '重口味溫泉魚'), 'hooktea', '重口味溫泉魚'), '虎克茶', '重口味溫泉魚'),
  '$.shop_hero_subtitle',
  replace(replace(replace(replace(COALESCE(json_extract(value_json, '$.shop_hero_subtitle'), ''), 'HookTea', '重口味溫泉魚'), 'HOOKTEA', '重口味溫泉魚'), 'hooktea', '重口味溫泉魚'), '虎克茶', '重口味溫泉魚'),
  '$.shop_categories',
  replace(replace(replace(replace(COALESCE(json_extract(value_json, '$.shop_categories'), '熱門商品,線上購物商品,重口味溫泉魚,新會員優惠,本月活動'), 'HookTea', '重口味溫泉魚'), 'HOOKTEA', '重口味溫泉魚'), 'hooktea', '重口味溫泉魚'), '虎克茶', '重口味溫泉魚'),
  '$.low_risk_wasabi_read_enabled', 'false',
  '$.high_risk_wasabi_read_enabled', 'false'
),
updated_by = 'migration',
updated_at = datetime('now')
WHERE key = 'hooktea_settings';

UPDATE products
SET
  store_name = replace(replace(replace(replace(COALESCE(store_name, ''), 'HookTea', '重口味溫泉魚'), 'HOOKTEA', '重口味溫泉魚'), 'hooktea', '重口味溫泉魚'), '虎克茶', '重口味溫泉魚'),
  name = replace(replace(replace(replace(COALESCE(name, ''), 'HookTea', '重口味溫泉魚'), 'HOOKTEA', '重口味溫泉魚'), 'hooktea', '重口味溫泉魚'), '虎克茶', '重口味溫泉魚'),
  subtitle = replace(replace(replace(replace(COALESCE(subtitle, ''), 'HookTea', '重口味溫泉魚'), 'HOOKTEA', '重口味溫泉魚'), 'hooktea', '重口味溫泉魚'), '虎克茶', '重口味溫泉魚'),
  description = replace(replace(replace(replace(COALESCE(description, ''), 'HookTea', '重口味溫泉魚'), 'HOOKTEA', '重口味溫泉魚'), 'hooktea', '重口味溫泉魚'), '虎克茶', '重口味溫泉魚'),
  badge = replace(replace(replace(replace(COALESCE(badge, ''), 'HookTea', '重口味溫泉魚'), 'HOOKTEA', '重口味溫泉魚'), 'hooktea', '重口味溫泉魚'), '虎克茶', '重口味溫泉魚'),
  category = replace(replace(replace(replace(COALESCE(category, ''), 'HookTea', '重口味溫泉魚'), 'HOOKTEA', '重口味溫泉魚'), 'hooktea', '重口味溫泉魚'), '虎克茶', '重口味溫泉魚'),
  updated_at = datetime('now')
WHERE lower(COALESCE(store_name, '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(subtitle, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(badge, '') || ' ' || COALESCE(category, '')) LIKE '%hooktea%'
   OR (COALESCE(store_name, '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(subtitle, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(badge, '') || ' ' || COALESCE(category, '')) LIKE '%虎克茶%';
