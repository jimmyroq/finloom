# Finloom — Backlog

## Phase 1: Foundation 🏗️

### Database
- [ ] Design PostgreSQL schema (stocks, stock_prices, stock_events, stock_graph)
- [ ] Create migration scripts
- [ ] Set up event sourcing tables (all changes as append-only events)
- [ ] Add indexes for search (ticker, name, ISIN — full-text + trigram)

### Swedish Stocks (MVP)
- [ ] Script to fetch all OMX Stockholm + First North tickers via yfinance
- [ ] Import stock metadata (name, sector, industry, country, currency, market cap, description)
- [ ] Import daily historical prices (5+ years)
- [ ] Validate data quality — check for gaps, duplicates, stale tickers

### REST API (Minimal)
- [ ] Set up Node.js/Express server on Piccolo
- [ ] `GET /api/search?q=saab` — fuzzy search by name/ticker
- [ ] `GET /api/stocks/:ticker` — full stock details + metadata
- [ ] `GET /api/stocks/:ticker/prices?from=&to=` — historical prices
- [ ] CORS setup for savr-vibe frontend

---

## Phase 1b: US + European Stocks (required for competition) 🏗️

### US Stocks
- [ ] Import NYSE + NASDAQ tickers (~8,000)
- [ ] Batch metadata import (respect rate limits)

### European Stocks
- [ ] Import London, Frankfurt, Paris, Helsinki, Copenhagen, Oslo
- [ ] Handle multi-exchange stocks (same company, different tickers)
- [ ] Currency tracking (SEK, USD, EUR, GBP, etc.)

---

## Phase 2: Scale 📈

### OpenFIGI Integration
- [ ] ISIN ↔ ticker mapping for all imported stocks
- [ ] Cross-exchange identification (is ERIC B.ST the same as ERIC on NYSE?)

### Daily Updates
- [ ] Cron job for end-of-day price updates
- [ ] Cron job for metadata refresh (weekly)
- [ ] Error handling + retry logic
- [ ] Monitoring — report missing/failed updates

---

## Phase 3: Knowledge Graph 🕸️

### Graph Structure
- [ ] Define graph schema (nodes, edges, properties)
- [ ] Build initial graph from imported metadata (stock → company → industry → country)
- [ ] IS_A hierarchies for industries (GICS: Sector → Industry Group → Industry → Sub-Industry)
- [ ] IS_A hierarchies for geography (Country → Region → Super-region)

### Finnhub Enrichment
- [ ] Company profiles (employees, IPO date, market cap, website)
- [ ] GICS classification codes → industry graph nodes
- [ ] Peer companies → RELATED_TO edges
- [ ] Earnings calendar data

### AI Enrichment
- [ ] LLM pass to classify companies into fine-grained categories
- [ ] Identify peer groups and competitors
- [ ] Extract themes/trends (AI, EV, Defense, etc.)
- [ ] Generate company descriptions/summaries

### Graph API
- [ ] `GET /api/graph/node/:id` — node with edges
- [ ] `GET /api/graph/traverse?from=&edge=&depth=` — graph traversal
- [ ] `GET /api/graph/industry/:id/stocks` — all stocks in an industry (recursive through IS_A)
- [ ] `GET /api/graph/country/:id/stocks` — all stocks in a country/region

---

## Phase 4: Real-time ⚡

### Price Streaming
- [ ] Finnhub WebSocket for US stocks (free tier)
- [ ] Evaluate options for Nordic/European real-time
- [ ] Store latest price in fast-access cache (Redis or in-memory)
- [ ] WebSocket endpoint for frontend price updates

### News & Events
- [ ] Finnhub news feed integration
- [ ] Earnings announcements
- [ ] Dividend dates
- [ ] Stock splits

---

## Phase 5: Intelligence 🧠

### Correlation Analysis
- [ ] Calculate price correlations between stocks
- [ ] CORRELATED_WITH edges in graph
- [ ] Sector/industry performance tracking

### Portfolio Analysis
- [ ] Given a set of holdings, analyze exposure
- [ ] Country/sector/currency distribution
- [ ] Risk metrics

### Trend Detection
- [ ] Identify trending sectors/industries
- [ ] Volume anomaly detection
- [ ] Momentum scoring

---

## Technical Debt & Infra

- [ ] `.gitignore` for Python/Node
- [ ] Docker setup for local development
- [ ] CI/CD for Piccolo deployment
- [ ] API authentication (API keys)
- [ ] Rate limiting on API
- [ ] Logging and monitoring
- [ ] Data backup strategy
- [ ] Documentation — API docs (OpenAPI/Swagger)

---

## Notes

- **Event sourcing first** — every data change is an event. We can always replay/rebuild.
- **Graph is a JSON file** initially (like topprecept), migrate to DB later if needed.
- **Piccolo constraints** — 8GB RAM, so be mindful of batch sizes during imports.
- **yfinance rate limits** — throttle requests, use batch downloads where possible.
- **Priority:** Get Swedish + US + European stocks + search API working ASAP for the savr-vibe competition (deadline March 26).
