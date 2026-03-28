import "dotenv/config";
import YahooFinance from "yahoo-finance2";
import { pool, query } from "./db.js";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const INDICES = [
  { name: "OMXS30", label: "OMX Stockholm 30", yahoo: "^OMX", currency: "SEK" },
  { name: "OMXS30GI", label: "OMX Stockholm 30 GI", yahoo: "^OMXSGI", currency: "SEK" },
  { name: "SP500", label: "S&P 500", yahoo: "^GSPC", currency: "USD" },
  { name: "NASDAQ", label: "NASDAQ Composite", yahoo: "^IXIC", currency: "USD" },
  { name: "DAX", label: "DAX", yahoo: "^GDAXI", currency: "EUR" },
];

async function importIndices() {
  console.log("=== Finloom Index Import ===\n");

  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

  for (const idx of INDICES) {
    console.log(`Importing ${idx.name} (${idx.yahoo})...`);

    // Upsert index
    await query(
      `INSERT INTO indices (name, label, yahoo_ticker, currency)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET label = $2, yahoo_ticker = $3, currency = $4`,
      [idx.name, idx.label, idx.yahoo, idx.currency],
    );

    const indexResult = await query("SELECT id FROM indices WHERE name = $1", [idx.name]);
    const indexId = indexResult.rows[0].id;

    try {
      const history = await yahooFinance.chart(idx.yahoo, {
        period1: fiveYearsAgo.toISOString().split("T")[0],
        interval: "1d",
      });

      const quotes = history.quotes ?? [];
      let inserted = 0;

      for (const q of quotes) {
        if (!q.date || q.close == null) continue;
        const date = new Date(q.date).toISOString().split("T")[0];
        try {
          await query(
            `INSERT INTO index_prices (index_id, date, open, high, low, close, volume)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (index_id, date) DO UPDATE SET
               open = EXCLUDED.open, high = EXCLUDED.high,
               low = EXCLUDED.low, close = EXCLUDED.close,
               volume = EXCLUDED.volume`,
            [indexId, date, q.open ?? 0, q.high ?? 0, q.low ?? 0, q.close, q.volume ?? 0],
          );
          inserted++;
        } catch {
          // skip duplicates
        }
      }

      console.log(`  ✓ ${inserted} days of price data`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("\nDone!");
  await pool.end();
}

importIndices().catch((err) => {
  console.error("Index import failed:", err);
  process.exit(1);
});
