PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_reps (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  sales_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  line_user_id TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  qr_url TEXT NOT NULL DEFAULT '',
  invite_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_reps_company_id
  ON sales_reps(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_reps_line_user_id
  ON sales_reps(line_user_id);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_customers_company_id
  ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_line_user_id
  ON customers(line_user_id);

CREATE TABLE IF NOT EXISTS customer_sales_bindings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  sales_rep_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'sales_qr',
  locked INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  bound_at TEXT NOT NULL DEFAULT (datetime('now')),
  changed_by TEXT NOT NULL DEFAULT '',
  change_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (sales_rep_id) REFERENCES sales_reps(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_sales_bindings_active_customer
  ON customer_sales_bindings(customer_id)
  WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_customer_sales_bindings_sales_rep
  ON customer_sales_bindings(sales_rep_id, active);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '件',
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  safety_stock_qty INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_products_company_id
  ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_sku
  ON products(sku);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('purchase', 'sale', 'adjustment', 'return')),
  quantity INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product
  ON inventory_movements(product_id, created_at);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  sales_rep_id TEXT NOT NULL DEFAULT '',
  order_no TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'shipped', 'completed', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  ordered_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_sales_rep_month
  ON orders(sales_rep_id, ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer
  ON orders(customer_id, ordered_at);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  total INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items(order_id);

CREATE TABLE IF NOT EXISTS sales_attributions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  sales_rep_id TEXT NOT NULL,
  attribution_source TEXT NOT NULL DEFAULT 'customer_binding',
  amount INTEGER NOT NULL DEFAULT 0,
  attributed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (sales_rep_id) REFERENCES sales_reps(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_attributions_sales_rep_month
  ON sales_attributions(sales_rep_id, attributed_at);

CREATE TABLE IF NOT EXISTS monthly_sales_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  sales_rep_id TEXT NOT NULL,
  period TEXT NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0,
  gross_amount INTEGER NOT NULL DEFAULT 0,
  net_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'locked')),
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (sales_rep_id) REFERENCES sales_reps(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_sales_records_period_rep
  ON monthly_sales_records(period, sales_rep_id);

CREATE TABLE IF NOT EXISTS line_threads (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'default',
  source_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'closed')),
  summary TEXT NOT NULL DEFAULT '',
  unread_count INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '',
  last_message_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_line_threads_source_user_id
  ON line_threads(source_user_id);
CREATE INDEX IF NOT EXISTS idx_line_threads_last_message_at
  ON line_threads(last_message_at);

CREATE TABLE IF NOT EXISTS line_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  line_event_id TEXT NOT NULL DEFAULT '',
  reply_token TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text',
  sender_role TEXT NOT NULL DEFAULT 'user'
    CHECK (sender_role IN ('user', 'staff', 'system')),
  sender_id TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  inserted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES line_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_line_messages_thread_id
  ON line_messages(thread_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_messages_event_id
  ON line_messages(line_event_id)
  WHERE line_event_id <> '';

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'line',
  line_user_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  mother_status INTEGER NOT NULL DEFAULT 0,
  handled_by_gusys INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_line_user_id
  ON webhook_events(line_user_id, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '',
  after_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO companies (id, name, status)
VALUES ('default', 'Gusys 經銷商系統', 'active');
