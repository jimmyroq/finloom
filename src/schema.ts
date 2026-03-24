import { pool, query } from "./db.js";

async function migrate() {
  console.log("Running migrations...");

  await query(`
    CREATE TABLE IF NOT EXISTS stocks (
      id SERIAL PRIMARY KEY,
      ticker TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      exchange TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      country TEXT NOT NULL DEFAULT '',
      sector TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      market_cap BIGINT,
      description TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("  stocks table ready");

  await query(`
    CREATE TABLE IF NOT EXISTS stock_prices (
      id SERIAL PRIMARY KEY,
      stock_id INT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      open NUMERIC NOT NULL,
      high NUMERIC NOT NULL,
      low NUMERIC NOT NULL,
      close NUMERIC NOT NULL,
      volume BIGINT NOT NULL DEFAULT 0,
      adjusted_close NUMERIC,
      UNIQUE (stock_id, date)
    )
  `);
  console.log("  stock_prices table ready");

  await query(`
    CREATE TABLE IF NOT EXISTS stock_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INT NOT NULL DEFAULT 0,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("  stock_events table ready");

  await query(`
    CREATE TABLE IF NOT EXISTS indices (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      yahoo_ticker TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'SEK',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("  indices table ready");

  await query(`
    CREATE TABLE IF NOT EXISTS index_prices (
      id SERIAL PRIMARY KEY,
      index_id INT NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      open NUMERIC,
      high NUMERIC,
      low NUMERIC,
      close NUMERIC NOT NULL,
      volume BIGINT DEFAULT 0,
      UNIQUE (index_id, date)
    )
  `);
  console.log("  index_prices table ready");

  // Indexes for performance
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_prices_stock_date ON stock_prices(stock_id, date)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_events_entity ON stock_events(entity_type, entity_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_events_type ON stock_events(event_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON stocks(exchange)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_stocks_country ON stocks(country)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_stocks_industry ON stocks(industry)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_index_prices_index_date ON index_prices(index_id, date)`);
  console.log("  indexes ready");

  console.log("Migrations complete.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
