PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  capacity TEXT NOT NULL DEFAULT '',
  condition_label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK(price >= 0),
  stock INTEGER NOT NULL CHECK(stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  buyer_name TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  buyer_address TEXT NOT NULL,
  buyer_memo TEXT NOT NULL DEFAULT '',
  total_amount INTEGER NOT NULL CHECK(total_amount > 0),
  status TEXT NOT NULL DEFAULT 'pending_transfer',
  items_json TEXT NOT NULL,
  deposit_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_code_phone ON orders(order_code, buyer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS phone_sales (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  capacity TEXT NOT NULL DEFAULT '',
  condition_label TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL,
  ownership TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_phone_sales_created_at ON phone_sales(created_at);
