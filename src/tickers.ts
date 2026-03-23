import YahooFinance from "yahoo-finance2";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

export interface ExchangeConfig {
  name: string;
  suffix: string;
  yahooExchange: string;
}

export const EXCHANGES: ExchangeConfig[] = [
  { name: "Stockholm", suffix: ".ST", yahooExchange: "STO" },
  { name: "NYSE", suffix: "", yahooExchange: "NYQ" },
  { name: "NASDAQ", suffix: "", yahooExchange: "NMS" },
  { name: "London", suffix: ".L", yahooExchange: "LSE" },
  { name: "Frankfurt", suffix: ".DE", yahooExchange: "GER" },
  { name: "Paris", suffix: ".PA", yahooExchange: "PAR" },
  { name: "Helsinki", suffix: ".HE", yahooExchange: "HEL" },
  { name: "Copenhagen", suffix: ".CO", yahooExchange: "CPH" },
  { name: "Oslo", suffix: ".OL", yahooExchange: "OSL" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// US tickers via NASDAQ public API
// ---------------------------------------------------------------------------

async function fetchNasdaqScreener(
  exchange: "nasdaq" | "nyse" | "amex",
): Promise<string[]> {
  const url = `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&exchange=${exchange}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Finloom/0.1)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.warn(`  NASDAQ screener returned ${res.status} for ${exchange}`);
    return [];
  }

  const json = (await res.json()) as {
    data?: { table?: { rows?: Array<{ symbol?: string }> } };
  };
  const rows = json?.data?.table?.rows ?? [];
  return rows
    .map((r) => r.symbol?.trim() ?? "")
    .filter((s) => s.length > 0 && !s.includes("/") && !s.includes("^"));
}

// ---------------------------------------------------------------------------
// European tickers via Yahoo search (comprehensive query set)
// ---------------------------------------------------------------------------

function buildSearchTerms(): string[] {
  const terms: string[] = [];

  // Single letters
  terms.push(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));

  // Two-letter combos (common ticker prefixes)
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of letters) {
    for (const b of letters) {
      terms.push(a + b);
    }
  }

  // Industry/sector terms
  terms.push(
    "bank", "energy", "tech", "mining", "pharma", "telecom", "oil", "auto",
    "steel", "shipping", "food", "retail", "insurance", "defense", "industrial",
    "media", "healthcare", "biotech", "solar", "wind", "construction",
    "property", "finance", "invest", "capital", "holding", "group",
    "nordic", "svenska", "norsk", "dansk",
  );

  return terms;
}

async function discoverExchangeTickersViaSearch(
  exchange: ExchangeConfig,
): Promise<string[]> {
  const tickers = new Set<string>();
  const terms = buildSearchTerms();
  let queryCount = 0;

  for (const term of terms) {
    try {
      const result = await yahooFinance.search(term, {
        quotesCount: 50,
        newsCount: 0,
      });

      for (const quote of result.quotes) {
        const sym = quote.symbol as string | undefined;
        if (
          sym &&
          quote.isYahooFinance &&
          quote.quoteType === "EQUITY" &&
          sym.endsWith(exchange.suffix)
        ) {
          tickers.add(sym);
        }
      }
    } catch {
      // search can fail, continue
    }

    queryCount++;
    if (queryCount % 100 === 0) {
      console.log(
        `    ${exchange.name}: ${queryCount}/${terms.length} queries, ${tickers.size} tickers found`,
      );
    }

    await sleep(150);
  }

  return Array.from(tickers);
}

// ---------------------------------------------------------------------------
// Load tickers from optional local JSON file
// ---------------------------------------------------------------------------

async function loadTickersFromFile(
  filePath: string,
): Promise<Map<string, string[]>> {
  if (!existsSync(filePath)) return new Map();

  try {
    const data = JSON.parse(await readFile(filePath, "utf-8")) as Record<
      string,
      string[]
    >;
    const result = new Map<string, string[]>();
    for (const [exchange, tickers] of Object.entries(data)) {
      result.set(exchange, tickers);
    }
    console.log(`  Loaded ticker overrides from ${filePath}`);
    return result;
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

export async function discoverAllTickers(): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();

  // Check for local override file first (tickers.json)
  const overrides = await loadTickersFromFile("tickers.json");
  if (overrides.size > 0) {
    console.log("  Using ticker list from tickers.json");
    for (const [exchange, tickers] of overrides) {
      result.set(exchange, tickers);
    }
    const missing = EXCHANGES.filter((e) => !result.has(e.name));
    if (missing.length === 0) return result;
    console.log(
      `  Still need to discover: ${missing.map((e) => e.name).join(", ")}`,
    );
  }

  // US stocks — NASDAQ API
  if (!result.has("NYSE")) {
    console.log("Fetching NYSE tickers from NASDAQ API...");
    const nyse = await fetchNasdaqScreener("nyse");
    console.log(`  Found ${nyse.length} NYSE tickers`);
    result.set("NYSE", nyse);
    await sleep(1000);
  }

  if (!result.has("NASDAQ")) {
    console.log("Fetching NASDAQ tickers from NASDAQ API...");
    const nasdaq = await fetchNasdaqScreener("nasdaq");
    console.log(`  Found ${nasdaq.length} NASDAQ tickers`);
    result.set("NASDAQ", nasdaq);
    await sleep(1000);
  }

  // European exchanges — Yahoo search discovery
  const europeanExchanges = EXCHANGES.filter(
    (e) => e.suffix !== "" && !result.has(e.name),
  );

  for (const exchange of europeanExchanges) {
    console.log(
      `Discovering ${exchange.name} (${exchange.suffix}) tickers via Yahoo search...`,
    );
    const tickers = await discoverExchangeTickersViaSearch(exchange);
    console.log(`  Found ${tickers.length} ${exchange.name} tickers`);
    result.set(exchange.name, tickers);
    await sleep(1000);
  }

  return result;
}

export function findExchange(
  ticker: string,
  exchangeName: string,
): ExchangeConfig {
  const found = EXCHANGES.find((e) => e.name === exchangeName);
  if (found) return found;

  for (const ex of EXCHANGES) {
    if (ex.suffix && ticker.endsWith(ex.suffix)) return ex;
  }

  return EXCHANGES.find((e) => e.name === "NYSE")!;
}
