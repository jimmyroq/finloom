import YahooFinance from "yahoo-finance2";
import { pool, query, logEvent, getClient } from "./db.js";
import {
  discoverAllTickers,
  EXCHANGES,
  findExchange,
  type ExchangeConfig,
} from "./tickers.js";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tickerExists(ticker: string): Promise<boolean> {
  const res = await query("SELECT 1 FROM stocks WHERE ticker = $1", [ticker]);
  return res.rows.length > 0;
}

async function importStock(
  ticker: string,
  exchange: ExchangeConfig,
): Promise<boolean> {
  try {
    // Fetch quote data (basic metadata)
    let quoteData;
    try {
      quoteData = await yahooFinance.quote(ticker, {}, { validateResult: false });
    } catch {
      console.warn(`    [SKIP] ${ticker}: quote fetch failed`);
      return false;
    }

    if (!quoteData || !quoteData.symbol) {
      console.warn(`    [SKIP] ${ticker}: no quote data`);
      return false;
    }

    const name =
      quoteData.longName || quoteData.shortName || quoteData.symbol || ticker;
    const currency = quoteData.currency || "USD";
    const marketCap = quoteData.marketCap ?? null;

    // Try to get detailed profile
    let sector = "";
    let industry = "";
    let country = "";
    let description: string | null = null;
    const metadata: Record<string, unknown> = {};

    try {
      const summary = await yahooFinance.quoteSummary(ticker, {
        modules: ["assetProfile"],
      });
      const profile = summary.assetProfile;
      if (profile) {
        sector = profile.sector || "";
        industry = profile.industry || "";
        country = profile.country || "";
        description = profile.longBusinessSummary || null;
        if (profile.fullTimeEmployees)
          metadata.employees = profile.fullTimeEmployees;
        if (profile.website) metadata.website = profile.website;
        if (profile.city) metadata.city = profile.city;
      }
    } catch {
      // quoteSummary can fail for some stocks, continue with basic data
    }

    // Insert stock record
    const stockResult = await query(
      `INSERT INTO stocks (ticker, name, exchange, currency, country, sector, industry, market_cap, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        ticker,
        name,
        quoteData.exchange || exchange.yahooExchange,
        currency,
        country,
        sector,
        industry,
        marketCap,
        description,
        JSON.stringify(metadata),
      ],
    );
    const stockId = stockResult.rows[0].id as number;

    await logEvent("stock_created", "stock", stockId, {
      ticker,
      name,
      exchange: exchange.yahooExchange,
    });

    // Fetch 5 years of daily prices via chart()
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

    let priceCount = 0;
    try {
      const chartResult = await yahooFinance.chart(ticker, {
        period1: fiveYearsAgo.toISOString().split("T")[0],
        interval: "1d",
      });

      const prices = chartResult.quotes;
      if (prices.length > 0) {
        const client = await getClient();
        try {
          await client.query("BEGIN");

          for (let i = 0; i < prices.length; i += 500) {
            const batch = prices.slice(i, i + 500);
            const values: unknown[] = [];
            const placeholders: string[] = [];

            for (let j = 0; j < batch.length; j++) {
              const p = batch[j];
              if (p.close == null) continue; // skip empty days
              const offset = placeholders.length * 8;
              placeholders.push(
                `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
              );
              values.push(
                stockId,
                p.date,
                p.open ?? 0,
                p.high ?? 0,
                p.low ?? 0,
                p.close,
                p.volume ?? 0,
                p.adjclose ?? p.close,
              );
            }

            if (placeholders.length > 0) {
              await client.query(
                `INSERT INTO stock_prices (stock_id, date, open, high, low, close, volume, adjusted_close)
                 VALUES ${placeholders.join(", ")}
                 ON CONFLICT (stock_id, date) DO NOTHING`,
                values,
              );
              priceCount += placeholders.length;
            }
          }

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        await logEvent("prices_imported", "stock", stockId, {
          ticker,
          count: priceCount,
        });
      }
    } catch {
      console.warn(`    [WARN] ${ticker}: chart prices fetch failed`);
    }

    return true;
  } catch (err) {
    console.error(
      `    [ERROR] ${ticker}: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}

async function main() {
  console.log("=== Finloom Stock Import ===\n");

  // Step 1: Discover tickers
  console.log("Phase 1: Discovering tickers...\n");
  const tickerMap = await discoverAllTickers();

  let totalTickers = 0;
  for (const [exchange, tickers] of tickerMap) {
    console.log(`  ${exchange}: ${tickers.length} tickers`);
    totalTickers += tickers.length;
  }
  console.log(`\n  Total: ${totalTickers} tickers to process\n`);

  // Step 2: Import each ticker
  console.log("Phase 2: Importing stocks...\n");

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const [exchangeName, tickers] of tickerMap) {
    console.log(`\n--- ${exchangeName} (${tickers.length} tickers) ---\n`);
    const exchange = findExchange(tickers[0] || "", exchangeName);

    for (const ticker of tickers) {
      processed++;

      // Resume capability — skip already imported
      if (await tickerExists(ticker)) {
        skipped++;
        if (processed % 100 === 0) {
          console.log(
            `  [${processed}/${totalTickers}] Skipped ${ticker} (already exists)`,
          );
        }
        continue;
      }

      const success = await importStock(ticker, exchange);
      if (success) {
        imported++;
      } else {
        failed++;
      }

      // Progress logging every 100 stocks
      if (processed % 100 === 0) {
        console.log(
          `  [${processed}/${totalTickers}] imported=${imported} skipped=${skipped} failed=${failed}`,
        );
      }

      // Throttle: 200ms between requests to avoid rate limiting
      await sleep(200);
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Total:    ${processed}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
