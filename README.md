# Finloom

Financial knowledge graph infrastructure. Weaves together stock data, metadata, and relationships into a queryable graph.

## What is this?

Finloom is a self-hosted financial data platform that:

1. **Ingests** stock data from open APIs (prices, metadata, fundamentals)
2. **Stores** everything in PostgreSQL with event sourcing
3. **Builds** a knowledge graph of relationships between stocks, companies, industries, countries, and regions
4. **Serves** a REST API for searching and querying the data

Think of it as a financial brain — not just a database of prices, but a graph that understands that SAAB B is a stock for SAAB, which is in the defense industry, headquartered in Sweden, which is a Nordic country, which is in Europe.

## Architecture

```
┌─────────────────────────────────────┐
│  Financial Worker (cron on Piccolo) │
│                                     │
│  1. yfinance — bulk import          │
│     All tickers per exchange        │
│     Metadata + daily prices         │
│                                     │
│  2. Finnhub — enrichment            │
│     Company profiles, GICS sectors  │
│     News, earnings                  │
│                                     │
│  3. OpenFIGI — identification       │
│     ISIN ↔ ticker mapping           │
│     Cross-exchange references       │
└──────────────┬──────────────────────┘
               │
    ┌──────────▼──────────┐
    │  PostgreSQL          │
    │  (event sourced)     │
    │                      │
    │  stocks              │
    │  stock_prices        │
    │  stock_events        │
    │  stock_graph         │
    └──────────┬───────────┘
               │
    ┌──────────▼──────────┐
    │  REST API            │
    │                      │
    │  GET /api/search     │
    │  GET /api/stocks/:id │
    │  GET /api/prices/:id │
    │  GET /api/graph/...  │
    └──────────────────────┘
```

## The Knowledge Graph

Inspired by the recipe graph in [topprecept.io](https://topprecept.io), but for finance.

### Node types
- **Stock** — a tradeable security (e.g. SAAB B, AAPL)
- **Company** — the entity behind one or more stocks
- **Industry** — sector/industry classification (e.g. Defense, SaaS)
- **Country** — where a company is headquartered
- **Region** — geographic groupings (Nordic, Europe, North America)
- **Exchange** — where stocks are traded (OMX Stockholm, NYSE, XETRA)

### Edge types
- `STOCK_FOR` — Stock → Company
- `IN_INDUSTRY` — Company → Industry
- `IN_COUNTRY` — Company → Country
- `ON_EXCHANGE` — Stock → Exchange
- `IS_A` — hierarchical (Industry → Parent Industry, Country → Region)
- `RELATED_TO` — peer companies, competitors
- `CORRELATED_WITH` — statistical correlation between stocks

### Building the graph
The graph is built through a combination of:
- **Algorithmic rules** — exchange listings, GICS classification codes
- **API data** — company profiles, industry tags from data providers
- **AI enrichment** — LLM analysis for relationships, peer mapping, nuanced classification

## Data Sources

| Source | What | Free tier | Notes |
|--------|------|-----------|-------|
| **yfinance** | Prices, metadata, fundamentals | Unlimited (unofficial) | Primary source. All global exchanges |
| **Finnhub** | Company profiles, GICS, news, earnings | 60 req/min | Great metadata. US realtime free |
| **OpenFIGI** | ISIN/ticker/FIGI mapping | Unlimited | Cross-reference identifiers |

## Target Coverage

### MVP
- 🇸🇪 **Sweden** — OMX Stockholm + First North (~1,000 stocks)
- 🇺🇸 **USA** — NYSE + NASDAQ (~8,000 stocks)
- 🇪🇺 **Europe** — London, Frankfurt, Paris, Helsinki, Copenhagen, Oslo (~5,000+ stocks)

### Future
- Asia-Pacific, emerging markets
- ETFs, funds, crypto
- Real-time price streaming

## Infrastructure

- **Host:** Piccolo (Raspberry Pi 5, 8GB RAM, NVMe SSD)
- **Database:** PostgreSQL on port 5433
- **Runtime:** Python (workers), Node.js (API)
- **Event sourcing:** All data changes tracked as events

## Tech Stack

- **Python** — data ingestion workers (yfinance, requests)
- **Node.js** — REST API server
- **PostgreSQL** — storage + event log
- **JSON** — knowledge graph (like recipe_graph.json)

## Related Projects

- **savr-vibe** — competition entry for SAVR's vibecoding contest, consumes Finloom's API
- **topprecept.io** — sister project using the same graph architecture for recipes
