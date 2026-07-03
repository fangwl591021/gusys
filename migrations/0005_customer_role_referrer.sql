ALTER TABLE customers ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE customers ADD COLUMN referrer_line_user_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_customers_customer_type
  ON customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_referrer_line_user_id
  ON customers(referrer_line_user_id);