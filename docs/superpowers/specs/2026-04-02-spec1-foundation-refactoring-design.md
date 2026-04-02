# Spec 1: Foundation & Refactoring

**Date:** 2026-04-02
**Status:** Approved
**Depends on:** Nothing (first spec)

## Overview

Refactor mockex from a single-file MVP into a modular, maintainable architecture that supports the upcoming trading engine, portfolio tracking, and AI signals features. Split the monolithic index.html into JS/CSS modules, restructure the Python server into organized routes and services, add PostgreSQL integration, and introduce configuration management.

## Frontend Module Split

Current state: single 1194-line `index.html` containing HTML, CSS, and all JavaScript.

### Proposed File Structure

```
index.html              — Layout/HTML only (~150 lines)
css/
  styles.css            — All styles extracted from <style> block
js/
  main.js               — Entry point, initialization, page load
  state.js              — Centralized state store with pub/sub
  websocket.js          — WebSocket connection, reconnect, message routing
  api.js                — REST API calls (fetch wrappers)
  chart.js              — Candlestick chart rendering, hover/tooltip, crosshair
  rsi.js                — RSI sub-chart rendering
  indicators.js         — SMA, RSI calculation functions (pure math)
  orderbook.js          — Order book rendering
  trades.js             — Recent trades feed rendering
  ticker.js             — Price display, 24h stats, header updates
  utils.js              — Number formatting, date formatting helpers
```

### State Management (state.js)

Simple pub/sub pattern — no framework needed:

```javascript
// State store with subscriber notifications
const state = {
  candles: [],
  lastPrice: 0,
  trades: [],
  ticker: {},
  orderBook: { bids: [], asks: [] },
  connected: false,
  // ... more state keys added by later specs
};

// Components subscribe to specific keys
subscribe('candles', (candles) => { drawChart(candles); });
subscribe('lastPrice', (price) => { updatePriceDisplay(price); });

// When data arrives, update state and notify
update('candles', newCandles);  // triggers all 'candles' subscribers
```

### Module Loading

Use ES modules (`<script type="module">`) for clean dependency management:
- `main.js` imports from all other modules
- Each module exports its public API
- No build step required — modern browsers support ES modules natively

## Server Refactoring

Current state: single `server.py` with 4 handlers (147 lines).

### Proposed File Structure

```
server.py                   — Entry point, app setup, startup/shutdown
routes/
  __init__.py               — Route registration
  websocket.py              — WebSocket handler (browser clients)
  candles.py                — GET /api/candles
  orders.py                 — Order CRUD endpoints (placeholder for Spec 2)
  portfolio.py              — Portfolio endpoints (placeholder for Spec 3)
  signals.py                — AI signals endpoint (placeholder for Spec 5)
services/
  __init__.py
  binance.py                — Binance WebSocket relay + REST proxy
  db.py                     — Database connection pool (asyncpg)
  config.py                 — Configuration from environment variables
models/
  schema.sql                — PostgreSQL schema definition
```

### Key Server Changes

1. **Route organization**: Each route file registers its own routes via a setup function
2. **Binance service**: Extract WebSocket relay logic into a standalone service class
3. **Database service**: asyncpg connection pool, initialized on app startup, closed on shutdown
4. **Config service**: Loads from `.env` file with sensible defaults
5. **Logging**: Python `logging` module replacing any print statements
6. **Error middleware**: Catches unhandled exceptions, returns proper JSON error responses
7. **Bidirectional WebSocket**: The WebSocket handler will accept client messages (for order placement in Spec 2), not just broadcast

### WebSocket Protocol

Current: server broadcasts Binance stream data one-way.

Extended protocol (foundation for Spec 2+):
```
Server → Client:
  {"stream": "btcusdt@trade", "data": {...}}       — existing
  {"stream": "btcusdt@kline_1s", "data": {...}}    — existing
  {"stream": "btcusdt@ticker", "data": {...}}       — existing
  {"stream": "btcusdt@depth10", "data": {...}}      — existing
  {"type": "order_update", "data": {...}}            — Spec 2
  {"type": "trade_executed", "data": {...}}          — Spec 2
  {"type": "balance_update", "data": {...}}          — Spec 2
  {"type": "position_update", "data": {...}}         — Spec 2
  {"type": "signal", "data": {...}}                  — Spec 5
  {"type": "ai_analysis", "data": {...}}             — Spec 5
  {"type": "alert_triggered", "data": {...}}         — Spec 6
  {"type": "error", "data": {"message": "..."}}      — Spec 6

Client → Server:
  {"type": "place_order", "data": {...}}             — Spec 2
  {"type": "cancel_order", "data": {"id": "..."}}    — Spec 2
```

## PostgreSQL Integration

Use existing `fchrulk-db` (PostgreSQL 16 on port 5432).

### Schema

```sql
CREATE SCHEMA IF NOT EXISTS mockex;
```

### Migration Strategy

All schema changes are managed via numbered SQL migration files in `models/migrations/`:
```
models/migrations/
  001_create_schema.sql          — Spec 1: CREATE SCHEMA mockex
  002_paper_accounts.sql         — Spec 2: paper_accounts table
  003_paper_orders.sql           — Spec 2: paper_orders, paper_trades, paper_positions
  004_portfolio_snapshots.sql    — Spec 3: portfolio_snapshots table
  005_ai_signals.sql             — Spec 5: ai_signals table
  006_price_alerts.sql           — Spec 6: price_alerts table
```

On server startup, `services/db.py` checks a `mockex.schema_version` table and applies any unapplied migrations in order. This keeps schema changes incremental and reproducible.

```sql
CREATE TABLE IF NOT EXISTS mockex.schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Connection

- **Driver**: asyncpg (async, fast, no ORM)
- **Pool**: min 2, max 10 connections
- **Connection string**: from .env file
- **Schema search path**: set to `mockex` on each connection

## Configuration Management

### .env File

```env
# Server
PORT=3000
LOG_LEVEL=INFO

# Database
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=financial
DB_USER=fchrulk
DB_PASSWORD=
DB_SCHEMA=mockex

# Binance
BINANCE_SYMBOL=btcusdt

# Claude API (for Spec 5)
CLAUDE_API_KEY=

# Paper Trading (for Spec 2)
INITIAL_BALANCE=100000
TRADING_FEE_RATE=0.001
```

### config.py Behavior

- Loads `.env` via `python-dotenv`
- Falls back to sensible defaults for all values
- Validates required values on startup (fail fast)
- Exposes as a frozen dataclass or module-level constants

## Dependencies

### requirements.txt

```
aiohttp>=3.9
websockets>=12.0
asyncpg>=0.29
python-dotenv>=1.0
anthropic>=0.40
pytest>=8.0
pytest-asyncio>=0.23
```

### Venv

Continue using existing venv at `/home/fchrulk/venvs/btc-dashboard/`.

## Migration Notes

- All existing functionality must continue working after refactoring
- No visual changes to the dashboard
- WebSocket reconnect behavior preserved
- Candle REST endpoint preserved at same path
- The refactoring is purely structural — same features, better organization

## Success Criteria

1. Dashboard loads and displays live BTC/USDT data identically to current version
2. All JS modules load correctly via ES module imports
3. Server starts with proper logging output
4. PostgreSQL connection pool initializes on startup
5. `.env` configuration loads correctly
6. No regressions in WebSocket reconnect or candle loading
