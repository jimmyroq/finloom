import YahooFinance from "yahoo-finance2";
import { pool, query, logEvent, getClient } from "./db.js";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface StockRow {
  id: number;
  ticker: string;
  latest_date: string | null;
}

async function main() {
  console.log("=== Finloom Price Update ===\n");

  const result = await query(`
    SELECT s.id, s.ticker, MAX(sp.date)::text AS latest_date
    FROM stocks s
    LEFT JOIN stock_prices sp ON sp.stock_id = s.id
    GROUP BY s.id, s.ticker
    ORDER BY s.ticker
  `);

  const stocks = result.rows as StockRow[];
  console.log(`Found ${stocks.length} stocks to update\n`);

  let updated = 0;
  let failed = 0;
  let noData = 0;

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    const ticker = stock.ticker;

    let startDate: string;
    if (stock.latest_date) {
      const next = new Date(stock.latest_date);
      next.setDate(next.getDate() + 1);
      startDate = next.toISOString().split("T")[0];
    } else {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      startDate = oneYearAgo.toISOString().split("T")[0];
    }

    const today = new Date().toISOString().split("T")[0];
    if (startDate > today) {
      noData++;
      continue;
    }

    try {
      const chartResult = await yahooFinance.chart(ticker, {
        period1: startDate,
        interval: "1d",
      });

      const prices = chartResult.quotes.filter((p) => p.close != null);

      if (prices.length === 0) {
        noData++;
        continue;
      }

      const client = await getClient();
      try {
        await client.query("BEGIN");

        for (let j = 0; j < prices.length; j += 500) {
          const batch = prices.slice(j, j + 500);
          const values: unknown[] = [];
          const placeholders: string[] = [];

          for (let k = 0; k < batch.length; k++) {
            const p = batch[k];
            const offset = k * 8;
            placeholders.push(
              `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
            );
            values.push(
              stock.id,
              p.date,
              p.open ?? 0,
              p.high ?? 0,
              p.low ?? 0,
              p.close,
              p.volume ?? 0,
              p.adjclose ?? p.close,
            );
          }

          await client.query(
            `INSERT INTO stock_prices (stock_id, date, open, high, low, close, volume, adjusted_close)
             VALUES ${placeholders.join(", ")}
             ON CONFLICT (stock_id, date) DO UPDATE SET
               open = EXCLUDED.open,
               high = EXCLUDED.high,
               low = EXCLUDED.low,
               close = EXCLUDED.close,
               volume = EXCLUDED.volume,
               adjusted_close = EXCLUDED.adjusted_close`,
            values,
          );
        }

        await client.query("COMMIT");
        updated++;

        await logEvent("prices_updated", "stock", stock.id, {
          ticker,
          count: prices.length,
          from: startDate,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      failed++;
      console.warn(
        `  [FAIL] ${ticker}: ${err instanceof Error ? err.message : err}`,
      );
    }

    if ((i + 1) % 100 === 0) {
      console.log(
        `  [${i + 1}/${stocks.length}] updated=${updated} failed=${failed} up-to-date=${noData}`,
      );
    }

    await sleep(200);
  }

  console.log(`\n=== Update Complete ===`);
  console.log(`  Updated:    ${updated}`);
  console.log(`  Up-to-date: ${noData}`);
  console.log(`  Failed:     ${failed}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Update failed:", err);
  process.exit(1);
});
