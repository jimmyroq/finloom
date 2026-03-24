import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./db.js";

const app = express();
const PORT = 3100;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve admin UI
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin", "index.html"));
});

// --- API routes ---

app.get("/api/stats", async (_req, res) => {
  try {
    const [stocks, prices, exchanges, sectors, lastImport] = await Promise.all([
      query("SELECT COUNT(*) FROM stocks"),
      query("SELECT COUNT(*) FROM stock_prices"),
      query(
        "SELECT exchange, COUNT(*) as count FROM stocks GROUP BY exchange ORDER BY count DESC",
      ),
      query(
        "SELECT sector, COUNT(*) as count FROM stocks WHERE sector != '' GROUP BY sector ORDER BY count DESC",
      ),
      query(
        "SELECT MAX(created_at) as last_import FROM stock_events WHERE event_type = 'stock_created'",
      ),
    ]);
    res.json({
      total_stocks: parseInt(stocks.rows[0].count),
      total_prices: parseInt(prices.rows[0].count),
      exchanges: exchanges.rows,
      sectors: sectors.rows,
      last_import: lastImport.rows[0]?.last_import,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/exchanges", async (_req, res) => {
  try {
    const result = await query(
      "SELECT exchange, COUNT(*) as count FROM stocks GROUP BY exchange ORDER BY count DESC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/sectors", async (_req, res) => {
  try {
    const result = await query(
      "SELECT sector, COUNT(*) as count FROM stocks WHERE sector != '' GROUP BY sector ORDER BY count DESC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/countries", async (_req, res) => {
  try {
    const result = await query(
      "SELECT country, COUNT(*) as count FROM stocks WHERE country != '' GROUP BY country ORDER BY count DESC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/industries", async (_req, res) => {
  try {
    const result = await query(
      "SELECT industry, COUNT(*) as count FROM stocks WHERE industry != '' GROUP BY industry ORDER BY count DESC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/currencies", async (_req, res) => {
  try {
    const result = await query(
      "SELECT currency, COUNT(*) as count FROM stocks WHERE currency != '' GROUP BY currency ORDER BY count DESC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/stocks", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit)) || 50));
    const offset = (page - 1) * limit;
    const sort = String(req.query.sort || "ticker");
    const order = String(req.query.order || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

    const allowedSorts: Record<string, string> = {
      ticker: "s.ticker",
      name: "s.name",
      exchange: "s.exchange",
      sector: "s.sector",
      country: "s.country",
      market_cap: "s.market_cap",
      currency: "s.currency",
    };
    const sortCol = allowedSorts[sort] || "s.ticker";

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.q) {
      conditions.push(`(s.ticker ILIKE $${paramIdx} OR s.name ILIKE $${paramIdx})`);
      params.push(`%${req.query.q}%`);
      paramIdx++;
    }

    // Multi-value filters: support comma-separated values (OR logic)
    const multiValueFilter = (field: string, queryParam: unknown) => {
      if (!queryParam) return;
      const values = String(queryParam).split(",").map((v) => v.trim()).filter(Boolean);
      if (values.length === 0) return;
      if (values.length === 1) {
        conditions.push(`s.${field} = $${paramIdx}`);
        params.push(values[0]);
        paramIdx++;
      } else {
        const placeholders = values.map((_, i) => `$${paramIdx + i}`).join(", ");
        conditions.push(`s.${field} IN (${placeholders})`);
        params.push(...values);
        paramIdx += values.length;
      }
    };

    multiValueFilter("exchange", req.query.exchange);
    multiValueFilter("sector", req.query.sector);
    multiValueFilter("country", req.query.country);
    multiValueFilter("industry", req.query.industry);
    multiValueFilter("currency", req.query.currency);

    // Market cap range filters
    if (req.query.market_cap_min) {
      conditions.push(`s.market_cap >= $${paramIdx}`);
      params.push(parseInt(String(req.query.market_cap_min)));
      paramIdx++;
    }
    if (req.query.market_cap_max) {
      conditions.push(`s.market_cap <= $${paramIdx}`);
      params.push(parseInt(String(req.query.market_cap_max)));
      paramIdx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM stocks s ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const stocksResult = await query(
      `SELECT s.ticker, s.name, s.exchange, s.sector, s.country, s.currency, s.market_cap,
              lp.close as latest_price,
              CASE WHEN pp.close > 0 THEN ROUND(((lp.close - pp.close) / pp.close * 100)::numeric, 2) ELSE NULL END as change_pct
       FROM stocks s
       LEFT JOIN LATERAL (
         SELECT close FROM stock_prices WHERE stock_id = s.id ORDER BY date DESC LIMIT 1
       ) lp ON true
       LEFT JOIN LATERAL (
         SELECT close FROM stock_prices WHERE stock_id = s.id ORDER BY date DESC OFFSET 1 LIMIT 1
       ) pp ON true
       ${where}
       ORDER BY ${sortCol} ${order} NULLS LAST
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    res.json({
      stocks: stocksResult.rows,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/stocks/:ticker", async (req, res) => {
  try {
    const result = await query(
      `SELECT s.*,
              lp.close as latest_price, lp.date as latest_date,
              (SELECT COUNT(*) FROM stock_prices WHERE stock_id = s.id) as price_count
       FROM stocks s
       LEFT JOIN LATERAL (
         SELECT close, date FROM stock_prices WHERE stock_id = s.id ORDER BY date DESC LIMIT 1
       ) lp ON true
       WHERE s.ticker = $1`,
      [req.params.ticker],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Stock not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/stocks/:ticker/prices", async (req, res) => {
  try {
    const stockResult = await query("SELECT id FROM stocks WHERE ticker = $1", [
      req.params.ticker,
    ]);
    if (stockResult.rows.length === 0) {
      return res.status(404).json({ error: "Stock not found" });
    }
    const stockId = stockResult.rows[0].id;

    const conditions = ["stock_id = $1"];
    const params: unknown[] = [stockId];
    let paramIdx = 2;

    if (req.query.from) {
      conditions.push(`date >= $${paramIdx}`);
      params.push(req.query.from);
      paramIdx++;
    }
    if (req.query.to) {
      conditions.push(`date <= $${paramIdx}`);
      params.push(req.query.to);
      paramIdx++;
    }

    const result = await query(
      `SELECT date, open, high, low, close, volume, adjusted_close
       FROM stock_prices
       WHERE ${conditions.join(" AND ")}
       ORDER BY date ASC`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Finloom admin running at http://0.0.0.0:${PORT}`);
});
