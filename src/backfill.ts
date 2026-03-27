/**
 * Backfill historical price data for existing stocks.
 * Fetches 5 years of data for each stock, only inserting dates we don't already have.
 */

import YahooFinance from "yahoo-finance2";
import { pool, query, logEvent, getClient } from "./db.js";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const YEARS_OF_DATA = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getEarliestPriceDate(stockId: number): Promise<Date | null> {
  const res = await query(
    "SELECT MIN(date) as earliest FROM stock_prices WHERE stock_id = $1",
    [stockId]
  );
  return res.rows[0]?.earliest || null;
}

async function backfillStock(
  stockId: number,
  ticker: string,
  earliestExisting: Date | null
): Promise<number> {
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - YEARS_OF_DATA);

  // If we already have data from 5 years ago, skip
  if (earliestExisting && earliestExisting <= fiveYearsAgo) {
    return 0;
  }

  // Fetch from 5 years ago until the day before our earliest data (or today if none)
  const endDate = earliestExisting
    ? new Date(earliestExisting.getTime() - 24 * 60 * 60 * 1000)
    : new Date();

  if (endDate <= fiveYearsAgo) {
    return 0;
  }

  try {
    const chartResult = await yahooFinance.chart(ticker, {
      period1: fiveYearsAgo.toISOString().split("T")[0],
      period2: endDate.toISOString().split("T")[0],
      interval: "1d",
    });

    const prices = chartResult.quotes;
    if (!prices || prices.length === 0) {
      return 0;
    }

    const client = await getClient();
    let insertedCount = 0;

    try {
      await client.query("BEGIN");

      for (let i = 0; i < prices.length; i += 500) {
        const batch = prices.slice(i, i + 500);
        const values: unknown[] = [];
        const placeholders: string[] = [];

        for (let j = 0; j < batch.length; j++) {
          const p = batch[j];
          if (p.close == null) continue;
          const offset = placeholders.length * 8;
          placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`
          );
          values.push(
            stockId,
            p.date,
            p.open ?? 0,
            p.high ?? 0,
            p.low ?? 0,
            p.close,
            p.volume ?? 0,
            p.adjclose ?? p.close
          );
        }

        if (placeholders.length > 0) {
          const result = await client.query(
            `INSERT INTO stock_prices (stock_id, date, open, high, low, close, volume, adjusted_close)
             VALUES ${placeholders.join(", ")}
             ON CONFLICT (stock_id, date) DO NOTHING`,
            values
          );
          insertedCount += result.rowCount || 0;
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    if (insertedCount > 0) {
      await logEvent("prices_backfilled", "stock", stockId, {
        ticker,
        count: insertedCount,
        from: fiveYearsAgo.toISOString().split("T")[0],
        to: endDate.toISOString().split("T")[0],
      });
    }

    return insertedCount;
  } catch (err) {
    console.warn(
      `    [WARN] ${ticker}: backfill failed - ${err instanceof Error ? err.message : err}`
    );
    return 0;
  }
}

async function main() {
  console.log(`=== Finloom Price Backfill (${YEARS_OF_DATA} years) ===\n`);

  // Get all stocks
  const stocksResult = await query(
    "SELECT id, ticker FROM stocks ORDER BY id"
  );
  const stocks = stocksResult.rows as { id: number; ticker: string }[];
  console.log(`Found ${stocks.length} stocks to process\n`);

  let processed = 0;
  let backfilled = 0;
  let totalPrices = 0;

  for (const stock of stocks) {
    processed++;

    const earliestDate = await getEarliestPriceDate(stock.id);
    const inserted = await backfillStock(stock.id, stock.ticker, earliestDate);

    if (inserted > 0) {
      backfilled++;
      totalPrices += inserted;
      console.log(
        `  [${processed}/${stocks.length}] ${stock.ticker}: +${inserted} prices`
      );
    } else if (processed % 500 === 0) {
      console.log(
        `  [${processed}/${stocks.length}] Progress: ${backfilled} stocks backfilled, ${totalPrices} total prices`
      );
    }

    // Throttle: 200ms between requests
    await sleep(200);
  }

  console.log(`\n=== Backfill Complete ===`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Backfilled: ${backfilled}`);
  console.log(`  Total new prices: ${totalPrices}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
