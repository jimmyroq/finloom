import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface ExchangeConfig {
  name: string;
  suffix: string;
  yahooExchange: string;
}

export const EXCHANGES: ExchangeConfig[] = [
  { name: "Stockholm", suffix: ".ST", yahooExchange: "STO" },
  { name: "First North", suffix: ".ST", yahooExchange: "NGM" },
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
// Yahoo Finance Crumb authentication
// ---------------------------------------------------------------------------

interface YahooAuth {
  crumb: string;
  cookie: string;
}

async function getYahooCrumb(): Promise<YahooAuth> {
  // Step 1: Get cookie
  const initRes = await fetch("https://fc.yahoo.com/curveball", {
    redirect: "manual",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Finloom/0.1)" },
  });
  const setCookies = initRes.headers.getSetCookie?.() ?? [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");

  // Step 2: Get crumb
  const crumbRes = await fetch(
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Finloom/0.1)",
        Cookie: cookie,
      },
    },
  );
  const crumb = await crumbRes.text();

  if (!crumb || crumb.length < 5) {
    throw new Error("Failed to get Yahoo crumb");
  }

  return { crumb, cookie };
}

// ---------------------------------------------------------------------------
// Yahoo Finance Screener — fetches ALL tickers for a given exchange
// ---------------------------------------------------------------------------

async function fetchTickersFromScreener(
  exchangeCode: string,
  auth: YahooAuth,
): Promise<string[]> {
  const allTickers: string[] = [];
  const pageSize = 250;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const body = JSON.stringify({
      size: pageSize,
      offset,
      sortField: "intradaymarketcap",
      sortType: "DESC",
      quoteType: "EQUITY",
      query: {
        operator: "AND",
        operands: [
          { operator: "eq", operands: ["exchange", exchangeCode] },
        ],
      },
    });

    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(auth.crumb)}`,
      {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Finloom/0.1)",
          "Content-Type": "application/json",
          Cookie: auth.cookie,
        },
        body,
      },
    );

    if (!res.ok) {
      console.warn(
        `  Screener returned ${res.status} for ${exchangeCode} at offset ${offset}`,
      );
      break;
    }

    const json = (await res.json()) as {
      finance?: {
        result?: Array<{
          total?: number;
          quotes?: Array<{ symbol?: string }>;
        }>;
      };
    };

    const result = json?.finance?.result?.[0];
    if (!result) {
      console.warn(`  No result for ${exchangeCode} at offset ${offset}`);
      break;
    }

    total = result.total ?? 0;
    const quotes = result.quotes ?? [];

    for (const q of quotes) {
      if (q.symbol) {
        allTickers.push(q.symbol);
      }
    }

    if (quotes.length === 0) break;

    offset += pageSize;

    // Be nice to Yahoo
    await sleep(300);
  }

  return allTickers;
}

// ---------------------------------------------------------------------------
// US tickers via NASDAQ public API (faster than screener for US)
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
// Load/save ticker cache
// ---------------------------------------------------------------------------

const CACHE_FILE = "tickers-cache.json";

interface TickerCache {
  timestamp: string;
  exchanges: Record<string, string[]>;
}

async function loadCache(): Promise<TickerCache | null> {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const data = JSON.parse(await readFile(CACHE_FILE, "utf-8")) as TickerCache;
    // Cache valid for 24 hours
    const age = Date.now() - new Date(data.timestamp).getTime();
    if (age < 24 * 60 * 60 * 1000) {
      return data;
    }
    console.log("  Ticker cache expired, refreshing...");
    return null;
  } catch {
    return null;
  }
}

async function saveCache(exchanges: Map<string, string[]>): Promise<void> {
  const cache: TickerCache = {
    timestamp: new Date().toISOString(),
    exchanges: Object.fromEntries(exchanges),
  };
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`  Cached ticker lists to ${CACHE_FILE}`);
}

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

export async function discoverAllTickers(): Promise<Map<string, string[]>> {
  // Check cache first
  const cached = await loadCache();
  if (cached) {
    console.log("  Using cached ticker lists");
    const result = new Map<string, string[]>();
    for (const [exchange, tickers] of Object.entries(cached.exchanges)) {
      result.set(exchange, tickers);
    }
    return result;
  }

  // Check for manual override file
  if (existsSync("tickers.json")) {
    try {
      const data = JSON.parse(
        await readFile("tickers.json", "utf-8"),
      ) as Record<string, string[]>;
      console.log("  Using ticker list from tickers.json");
      const result = new Map<string, string[]>();
      for (const [exchange, tickers] of Object.entries(data)) {
        result.set(exchange, tickers);
      }
      return result;
    } catch {
      // fall through
    }
  }

  const result = new Map<string, string[]>();

  // US stocks — NASDAQ API (faster)
  console.log("Fetching NYSE tickers from NASDAQ API...");
  const nyse = await fetchNasdaqScreener("nyse");
  console.log(`  Found ${nyse.length} NYSE tickers`);
  result.set("NYSE", nyse);
  await sleep(1000);

  console.log("Fetching NASDAQ tickers from NASDAQ API...");
  const nasdaq = await fetchNasdaqScreener("nasdaq");
  console.log(`  Found ${nasdaq.length} NASDAQ tickers`);
  result.set("NASDAQ", nasdaq);
  await sleep(1000);

  // All other exchanges — Yahoo Screener
  console.log("Authenticating with Yahoo Finance...");
  const auth = await getYahooCrumb();
  console.log("  Got crumb, fetching exchange lists...");

  const screenerExchanges = EXCHANGES.filter(
    (e) => e.name !== "NYSE" && e.name !== "NASDAQ",
  );

  for (const exchange of screenerExchanges) {
    console.log(
      `Fetching ${exchange.name} (${exchange.yahooExchange}) tickers...`,
    );
    const tickers = await fetchTickersFromScreener(
      exchange.yahooExchange,
      auth,
    );
    console.log(`  Found ${tickers.length} ${exchange.name} tickers`);
    result.set(exchange.name, tickers);
    await sleep(500);
  }

  // Save cache
  await saveCache(result);

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
