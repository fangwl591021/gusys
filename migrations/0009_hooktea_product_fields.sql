ALTER TABLE products ADD COLUMN code TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN subtitle TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN badge TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN image TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN original_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN points_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN stock_unlimited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN source TEXT NOT NULL DEFAULT 'hooktea';
UPDATE products
SET code = COALESCE(NULLIF(code, ''), sku),
    points_price = CASE WHEN points_price = 0 THEN price ELSE points_price END,
    original_price = CASE WHEN original_price = 0 THEN price ELSE original_price END;
