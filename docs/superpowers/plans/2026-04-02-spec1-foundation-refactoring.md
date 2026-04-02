# Spec 1: Foundation & Refactoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor mockex from a single-file MVP into a modular architecture with ES modules, organized Python server, PostgreSQL integration, and config management — without changing any visible behavior.

**Architecture:** Split the monolithic `index.html` (1194 lines) into 11 JS modules + 1 CSS file using ES module imports. Restructure `server.py` (147 lines) into routes/, services/, and models/ directories. Add asyncpg for PostgreSQL with a migration system. All config via `.env` + `python-dotenv`.

**Tech Stack:** Python 3.10+ (aiohttp, asyncpg, websockets, python-dotenv), vanilla JS (ES modules), PostgreSQL 16 (existing fchrulk-db)

---

## File Structure

### New Files to Create

```
# Python server modules
services/__init__.py            — Empty init
services/config.py              — Config loading from .env
services/binance.py             — Binance WS relay + candles cache (extracted from server.py)
services/db.py                  — asyncpg pool + migration runner
routes/__init__.py              — Route registration helper
routes/websocket.py             — Browser WS handler
routes/candles.py               — GET /api/candles
models/migrations/001_create_schema.sql  — Initial schema

# Frontend modules
css/styles.css                  — All CSS extracted from index.html <style>
js/utils.js                     — fmt(), fmtK(), setColor()
js/state.js                     — Pub/sub state store
js/api.js                       — REST fetch wrappers
js/indicators.js                — calcSMA(), calcRSI()
js/chart.js                     — drawChart(), chartLayout, hover/crosshair
js/rsi.js                       — drawRSI()
js/orderbook.js                 — renderDepth()
js/trades.js                    — onTrade(), renderTrades()
js/ticker.js                    — onTicker(), updateLastUpdateTime(), header updates
js/websocket.js                 — connectProxy(), reconnect, message routing
js/main.js                      — Entry point, imports, init

# Config
.env.example                    — Template with defaults
requirements.txt                — Python dependencies
```

### Files to Modify

```
server.py                       — Gutted to thin entry point
index.html                      — Gutted to HTML-only (~150 lines)
```

### Files Unchanged

```
CLAUDE.md, README.md, serve.py, docs/
```

---

## Task 1: Configuration & Dependencies

**Files:**
- Create: `services/__init__.py`
- Create: `services/config.py`
- Create: `.env.example`
- Create: `requirements.txt`

- [ ] **Step 1: Create requirements.txt**

```
aiohttp>=3.9
websockets>=12.0
asyncpg>=0.29
python-dotenv>=1.0
```

- [ ] **Step 2: Create .env.example**

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
```

- [ ] **Step 3: Create services/__init__.py**

Empty file.

- [ ] **Step 4: Create services/config.py**

```python
"""Application configuration loaded from .env with defaults."""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)


def _get(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _int(key: str, default: int = 0) -> int:
    return int(_get(key, str(default)))


# Server
PORT = _int("PORT", 3000)
LOG_LEVEL = _get("LOG_LEVEL", "INFO")

# Database
DB_HOST = _get("DB_HOST", "127.0.0.1")
DB_PORT = _int("DB_PORT", 5432)
DB_NAME = _get("DB_NAME", "financial")
DB_USER = _get("DB_USER", "fchrulk")
DB_PASSWORD = _get("DB_PASSWORD", "")
DB_SCHEMA = _get("DB_SCHEMA", "mockex")

# Binance
BINANCE_SYMBOL = _get("BINANCE_SYMBOL", "btcusdt")
BINANCE_WS_URL = (
    f"wss://stream.binance.com:9443/stream?streams="
    f"{BINANCE_SYMBOL}@trade/{BINANCE_SYMBOL}@kline_1s/"
    f"{BINANCE_SYMBOL}@ticker/{BINANCE_SYMBOL}@depth10"
)
BINANCE_CANDLES_URL = (
    f"https://api.binance.com/api/v3/klines"
    f"?symbol={BINANCE_SYMBOL.upper()}&interval=1m&limit=100"
)
```

- [ ] **Step 5: Install new dependencies**

Run:
```bash
source /home/fchrulk/venvs/btc-dashboard/bin/activate
pip install asyncpg python-dotenv
```

- [ ] **Step 6: Create .env from example (copy and fill in password)**

Run:
```bash
cp .env.example .env
```

Then edit `.env` to set `DB_PASSWORD` to the actual password for fchrulk user.

- [ ] **Step 7: Commit**

```bash
git add services/__init__.py services/config.py .env.example requirements.txt
git commit -m "feat: add config module, requirements.txt, and .env.example"
```

Note: `.env` should NOT be committed (add to `.gitignore` if not already there).

---

## Task 2: Database Service & Migrations

**Files:**
- Create: `services/db.py`
- Create: `models/migrations/001_create_schema.sql`

- [ ] **Step 1: Create models/ directory and migration file**

Create `models/migrations/001_create_schema.sql`:

```sql
CREATE SCHEMA IF NOT EXISTS mockex;
```

- [ ] **Step 2: Create services/db.py**

```python
"""Database connection pool and migration runner using asyncpg."""

import logging
from pathlib import Path

import asyncpg

from services import config

log = logging.getLogger("mockex.db")

_pool: asyncpg.Pool | None = None

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "models" / "migrations"


async def init_pool() -> asyncpg.Pool:
    """Create the connection pool and run pending migrations."""
    global _pool
    dsn = (
        f"postgresql://{config.DB_USER}:{config.DB_PASSWORD}"
        f"@{config.DB_HOST}:{config.DB_PORT}/{config.DB_NAME}"
    )
    _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
    log.info("Database pool created (%s:%s/%s)", config.DB_HOST, config.DB_PORT, config.DB_NAME)
    await _run_migrations()
    return _pool


async def get_pool() -> asyncpg.Pool:
    """Return the existing pool (init_pool must have been called)."""
    if _pool is None:
        raise RuntimeError("Database pool not initialized — call init_pool() first")
    return _pool


async def close_pool():
    """Close the connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        log.info("Database pool closed")
        _pool = None


async def _run_migrations():
    """Apply any pending SQL migration files in order."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Ensure schema and version table exist
        await conn.execute("CREATE SCHEMA IF NOT EXISTS mockex")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS mockex.schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)

        # Find already-applied versions
        rows = await conn.fetch("SELECT version FROM mockex.schema_version ORDER BY version")
        applied = {r["version"] for r in rows}

        # Discover and sort migration files
        if not MIGRATIONS_DIR.exists():
            log.info("No migrations directory found at %s", MIGRATIONS_DIR)
            return

        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        for mf in migration_files:
            # Extract version number from filename prefix (e.g., "001_create_schema.sql" -> 1)
            try:
                version = int(mf.name.split("_", 1)[0])
            except ValueError:
                log.warning("Skipping non-numbered migration file: %s", mf.name)
                continue

            if version in applied:
                continue

            log.info("Applying migration %03d: %s", version, mf.name)
            sql = mf.read_text()
            await conn.execute(sql)
            await conn.execute(
                "INSERT INTO mockex.schema_version (version) VALUES ($1)", version
            )
            log.info("Migration %03d applied", version)

    log.info("All migrations up to date")
```

- [ ] **Step 3: Verify the migration file is loadable**

Run:
```bash
python -c "from services.db import MIGRATIONS_DIR; print(list(MIGRATIONS_DIR.glob('*.sql')))"
```

Expected: one file `001_create_schema.sql` in the list.

- [ ] **Step 4: Commit**

```bash
git add services/db.py models/migrations/001_create_schema.sql
git commit -m "feat: add database service with asyncpg pool and migration runner"
```

---

## Task 3: Binance Service (Extract from server.py)

**Files:**
- Create: `services/binance.py`

- [ ] **Step 1: Create services/binance.py**

Extract the Binance WebSocket relay and candle caching logic from `server.py` into a service class:

```python
"""Binance WebSocket relay and candle cache service."""

import asyncio
import json
import logging
import time

import aiohttp
import websockets

from services import config

log = logging.getLogger("mockex.binance")


class BinanceService:
    """Maintains a persistent Binance WS connection and fans out to browser clients."""

    def __init__(self):
        self.browser_clients: set[aiohttp.web.WebSocketResponse] = set()
        self.latest_messages: dict[str, str] = {}
        self._cached_candles: str | None = None
        self._cached_candles_ts: float = 0
        self._relay_task: asyncio.Task | None = None

    async def start(self):
        """Start the Binance relay background task."""
        self._relay_task = asyncio.create_task(self._relay_loop())
        log.info("Binance relay started")

    async def stop(self):
        """Cancel the relay task and close all browser clients."""
        if self._relay_task:
            self._relay_task.cancel()
            try:
                await self._relay_task
            except asyncio.CancelledError:
                pass
        for client in list(self.browser_clients):
            await client.close()
        self.browser_clients.clear()
        log.info("Binance relay stopped")

    async def _relay_loop(self):
        """Maintain a persistent connection to Binance and fan-out to browsers."""
        while True:
            try:
                log.info("Connecting to Binance WebSocket...")
                async with websockets.connect(
                    config.BINANCE_WS_URL, ping_interval=20, ping_timeout=10
                ) as ws:
                    log.info("Connected to Binance WebSocket")
                    async for raw in ws:
                        data = json.loads(raw)
                        stream = data.get("stream", "")
                        tagged = json.dumps({"stream": stream, "data": data.get("data", data)})
                        self.latest_messages[stream] = tagged
                        await self._broadcast(tagged)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("Binance WS error: %s — reconnecting in 3s", e)
            await asyncio.sleep(3)

    async def _broadcast(self, message: str):
        """Send a message to all connected browser clients."""
        dead = set()
        for client in self.browser_clients:
            try:
                await client.send_str(message)
            except Exception:
                dead.add(client)
        self.browser_clients -= dead

    def add_client(self, ws: aiohttp.web.WebSocketResponse):
        """Register a new browser client."""
        self.browser_clients.add(ws)
        log.info("Browser client connected (%d total)", len(self.browser_clients))

    def remove_client(self, ws: aiohttp.web.WebSocketResponse):
        """Unregister a browser client."""
        self.browser_clients.discard(ws)
        log.info("Browser client disconnected (%d remaining)", len(self.browser_clients))

    async def send_cached_to(self, ws: aiohttp.web.WebSocketResponse):
        """Send latest cached messages to a newly connected client."""
        for msg in self.latest_messages.values():
            try:
                await ws.send_str(msg)
            except Exception:
                break

    async def get_candles(self) -> str | None:
        """Return cached candles, refreshing if stale (>30s)."""
        if self._cached_candles is None or (time.time() - self._cached_candles_ts) > 30:
            await self._fetch_candles()
        return self._cached_candles

    async def _fetch_candles(self):
        """Fetch initial candles from Binance REST API."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(config.BINANCE_CANDLES_URL) as resp:
                    self._cached_candles = await resp.text()
                    self._cached_candles_ts = time.time()
                    log.info("Fetched candles (%d bytes)", len(self._cached_candles))
        except Exception as e:
            log.warning("Failed to fetch candles: %s", e)
```

- [ ] **Step 2: Verify import works**

Run:
```bash
cd /home/fchrulk/apps/mockex && python -c "from services.binance import BinanceService; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add services/binance.py
git commit -m "feat: extract Binance relay into services/binance.py"
```

---

## Task 4: Route Modules (Extract from server.py)

**Files:**
- Create: `routes/__init__.py`
- Create: `routes/websocket.py`
- Create: `routes/candles.py`

- [ ] **Step 1: Create routes/__init__.py**

```python
"""Route registration and error middleware for the aiohttp application."""

import json
import logging

from aiohttp import web

from routes import websocket, candles

log = logging.getLogger("mockex.routes")


@web.middleware
async def error_middleware(request, handler):
    """Catch unhandled exceptions and return JSON error responses."""
    try:
        return await handler(request)
    except web.HTTPException:
        raise  # Let aiohttp handle HTTP exceptions normally
    except Exception as e:
        log.exception("Unhandled error on %s %s", request.method, request.path)
        return web.json_response(
            {"error": str(e)}, status=500, content_type="application/json"
        )


def setup_routes(app: web.Application):
    """Register all route handlers and middleware on the app."""
    app.middlewares.append(error_middleware)
    app.router.add_get("/ws", websocket.handle_ws)
    app.router.add_get("/api/candles", candles.handle_candles)
```

- [ ] **Step 2: Create routes/websocket.py**

```python
"""WebSocket handler for browser clients."""

from aiohttp import web


async def handle_ws(request: web.Request) -> web.WebSocketResponse:
    """Accept a browser WebSocket connection and relay Binance data."""
    binance = request.app["binance"]
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    binance.add_client(ws)
    await binance.send_cached_to(ws)

    try:
        async for msg in ws:
            # Future: handle client messages (order placement, etc.)
            pass
    finally:
        binance.remove_client(ws)

    return ws
```

- [ ] **Step 3: Create routes/candles.py**

```python
"""Candle data REST endpoint."""

from aiohttp import web


async def handle_candles(request: web.Request) -> web.Response:
    """Return cached 1-minute candles as JSON."""
    binance = request.app["binance"]
    data = await binance.get_candles()
    if data:
        return web.Response(text=data, content_type="application/json")
    return web.Response(status=502, text="Failed to fetch candles")
```

- [ ] **Step 4: Verify imports**

Run:
```bash
cd /home/fchrulk/apps/mockex && python -c "from routes import setup_routes; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add routes/__init__.py routes/websocket.py routes/candles.py
git commit -m "feat: add route modules for websocket and candles endpoints"
```

---

## Task 5: Rewrite server.py as Thin Entry Point

**Files:**
- Modify: `server.py`

- [ ] **Step 1: Rewrite server.py**

Replace the entire contents of `server.py` with:

```python
#!/usr/bin/env python3
"""Mockex — BTC/USDT real-time trading dashboard server.

Entry point that wires up routes, services, and static file serving.
"""

import logging
from pathlib import Path

from aiohttp import web

from services import config
from services.binance import BinanceService
from services import db
from routes import setup_routes

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("mockex")

STATIC_DIR = Path(__file__).parent


async def on_startup(app: web.Application):
    """Initialize services on server start."""
    # Database
    try:
        await db.init_pool()
    except Exception as e:
        log.warning("Database unavailable: %s — running without DB", e)

    # Binance relay
    binance = BinanceService()
    app["binance"] = binance
    await binance.start()


async def on_cleanup(app: web.Application):
    """Shut down services gracefully."""
    binance = app.get("binance")
    if binance:
        await binance.stop()
    await db.close_pool()


def main():
    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    setup_routes(app)

    # Static files and index — must be last (catch-all)
    app.router.add_get("/", lambda r: web.FileResponse(STATIC_DIR / "index.html"))
    app.router.add_static("/", STATIC_DIR, show_index=False)

    log.info("Starting Mockex on port %d", config.PORT)
    web.run_app(
        app,
        host="0.0.0.0",
        port=config.PORT,
        print=lambda _: log.info("Server ready on http://localhost:%d", config.PORT),
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test that the server starts**

Run:
```bash
cd /home/fchrulk/apps/mockex
source /home/fchrulk/venvs/btc-dashboard/bin/activate
timeout 10 python server.py || true
```

Expected: Logs showing "Starting Mockex on port 3000", "Database pool created" (or "Database unavailable" if no password set), "Binance relay started", "Server ready". The `timeout 10` will kill it after 10s — that's fine, we just want to see it boot without import errors.

- [ ] **Step 3: Commit**

```bash
git add server.py
git commit -m "refactor: rewrite server.py as thin entry point using services and routes"
```

---

## Task 6: Extract CSS from index.html

**Files:**
- Create: `css/styles.css`
- Modify: `index.html` (remove `<style>` block, add `<link>`)

- [ ] **Step 1: Create css/styles.css**

Extract everything between `<style>` (line 7) and `</style>` (line 547) from `index.html` into `css/styles.css`. This is the entire CSS content — all 540 lines, verbatim, no changes.

Copy lines 8-546 of `index.html` (the CSS content inside the `<style>` tags) into `css/styles.css`.

- [ ] **Step 2: Update index.html head**

Replace the entire `<style>...</style>` block (lines 7-547) in `index.html` with a single link tag:

```html
<link rel="stylesheet" href="/css/styles.css">
```

- [ ] **Step 3: Verify by loading in browser**

Run the server and open http://localhost:3000. The page should look identical. Check browser dev tools Network tab — `styles.css` should load with 200 status.

- [ ] **Step 4: Commit**

```bash
git add css/styles.css index.html
git commit -m "refactor: extract CSS into css/styles.css"
```

---

## Task 7: Create js/utils.js and js/state.js

**Files:**
- Create: `js/utils.js`
- Create: `js/state.js`

- [ ] **Step 1: Create js/utils.js**

```javascript
/**
 * Shared formatting and DOM helper utilities.
 */

/** Format a number with fixed decimal places and locale separators. */
export function fmt(v, d = 2) {
  return parseFloat(v).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Format a large number with K/M/B suffix. */
export function fmtK(v) {
  const n = parseFloat(v);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

/** Set element color based on positive/negative value. */
export function setColor(el, val) {
  const n = parseFloat(val);
  el.style.color = n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text)';
}
```

- [ ] **Step 2: Create js/state.js**

```javascript
/**
 * Centralized state store with pub/sub notifications.
 *
 * Usage:
 *   import { state, subscribe, update } from './state.js';
 *   subscribe('candles', (candles) => drawChart(candles));
 *   update('candles', newCandles);
 */

const _subscribers = {};

export const state = {
  candles: [],
  lastPrice: 0,
  trades: [],
  ticker: {},
  orderBook: { bids: [], asks: [] },
  connected: false,
  lastUpdateTime: 0,
};

/**
 * Subscribe to changes on a specific state key.
 * Returns an unsubscribe function.
 */
export function subscribe(key, callback) {
  if (!_subscribers[key]) _subscribers[key] = [];
  _subscribers[key].push(callback);
  return () => {
    _subscribers[key] = _subscribers[key].filter((cb) => cb !== callback);
  };
}

/**
 * Update a state key and notify all subscribers.
 */
export function update(key, value) {
  state[key] = value;
  const subs = _subscribers[key];
  if (subs) {
    for (const cb of subs) {
      cb(value);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add js/utils.js js/state.js
git commit -m "feat: add js/utils.js and js/state.js pub/sub store"
```

---

## Task 8: Create js/indicators.js

**Files:**
- Create: `js/indicators.js`

- [ ] **Step 1: Create js/indicators.js**

Extract `calcSMA` and `calcRSI` from `index.html` (lines 682-714):

```javascript
/**
 * Technical indicator calculations (pure math, no DOM).
 */

/** Simple Moving Average over close prices. */
export function calcSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].c;
    result.push(sum / period);
  }
  return result;
}

/** Relative Strength Index. */
export function calcRSI(data, period = 14) {
  const result = [];
  if (data.length < period + 1) return data.map(() => null);

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i].c - data[i - 1].c;
    if (diff > 0) gainSum += diff;
    else lossSum -= diff;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = 0; i < period; i++) result.push(null);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].c - data[i - 1].c;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add js/indicators.js
git commit -m "feat: add js/indicators.js with SMA and RSI calculations"
```

---

## Task 9: Create js/chart.js and js/rsi.js

**Files:**
- Create: `js/chart.js`
- Create: `js/rsi.js`

- [ ] **Step 1: Create js/rsi.js**

Extract the `drawRSI` function (index.html lines 841-898):

```javascript
/**
 * RSI sub-chart rendering.
 */

import { calcRSI } from './indicators.js';

export function drawRSI(candles) {
  const canvas = document.getElementById('rsi-canvas');
  const container = document.getElementById('rsi-container');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = container.clientWidth;
  const H = container.clientHeight;
  const padR = 70;
  const padL = 10;

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0a0f1a');
  bgGrad.addColorStop(1, '#060a12');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const rsi = calcRSI(candles);
  const cw = (W - padL - padR) / candles.length;
  const yR = (v) => 5 + (1 - v / 100) * (H - 10);

  // Overbought zone
  ctx.fillStyle = 'rgba(255,41,82,0.05)';
  ctx.fillRect(padL, yR(100), W - padL - padR, yR(70) - yR(100));
  // Oversold zone
  ctx.fillStyle = 'rgba(0,232,123,0.05)';
  ctx.fillRect(padL, yR(30), W - padL - padR, yR(0) - yR(30));

  // Grid lines
  [30, 50, 70].forEach((v) => {
    ctx.strokeStyle = 'rgba(30,42,58,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, yR(v));
    ctx.lineTo(W - padR, yR(v));
    ctx.stroke();
    ctx.fillStyle = '#4a5a74';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(v, W - 5, yR(v) + 4);
  });

  // RSI line
  ctx.strokeStyle = '#ab47bc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  rsi.forEach((v, i) => {
    if (v === null) return;
    const x = padL + i * cw + cw / 2;
    if (!started) {
      ctx.moveTo(x, yR(v));
      started = true;
    } else {
      ctx.lineTo(x, yR(v));
    }
  });
  ctx.stroke();

  // Update indicator display
  const lastRSI = rsi.filter((v) => v !== null).pop();
  const rsiEl = document.getElementById('rsi-val');
  const rsiLabel = document.getElementById('rsi-label');
  if (lastRSI != null) {
    rsiEl.textContent = lastRSI.toFixed(1);
    if (lastRSI >= 70) {
      rsiEl.style.color = 'var(--red)';
      rsiLabel.textContent = 'Overbought';
      rsiLabel.style.color = 'var(--red)';
    } else if (lastRSI <= 30) {
      rsiEl.style.color = 'var(--green)';
      rsiLabel.textContent = 'Oversold';
      rsiLabel.style.color = 'var(--green)';
    } else {
      rsiEl.style.color = 'var(--text)';
      rsiLabel.textContent = 'Neutral';
      rsiLabel.style.color = 'var(--text2)';
    }
  }
}
```

- [ ] **Step 2: Create js/chart.js**

Extract the `drawChart` function, `chartLayout`, `scheduleChartDraw`, and hover/crosshair logic (index.html lines 716-839, 1024-1032, 1117-1181):

```javascript
/**
 * Candlestick chart rendering, scheduling, and hover/crosshair interaction.
 */

import { fmt, fmtK } from './utils.js';
import { calcSMA } from './indicators.js';
import { drawRSI } from './rsi.js';
import { state } from './state.js';

let chartLayout = { padL: 10, padR: 70, cw: 0, chartH: 0, minL: 0, totalRange: 1 };
let chartDirty = false;
let chartRAF = null;

export function scheduleChartDraw() {
  if (!chartDirty) {
    chartDirty = true;
    cancelAnimationFrame(chartRAF);
    chartRAF = requestAnimationFrame(() => {
      chartDirty = false;
      drawChart();
    });
  }
}

export function drawChart() {
  const candles = state.candles;
  const canvas = document.getElementById('chart-canvas');
  const container = document.getElementById('chart-container');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = container.clientWidth;
  const H = container.clientHeight;

  // Dark background with subtle gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0a0f1a');
  bgGrad.addColorStop(1, '#060a12');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  if (candles.length < 2) return;

  const volH = H * 0.18;
  const chartH = H - volH - 10;
  const padR = 70;
  const padL = 10;
  const cw = (W - padL - padR) / candles.length;

  let minL = Infinity;
  let maxH = -Infinity;
  let maxVol = 0;
  candles.forEach((c) => {
    if (c.l < minL) minL = c.l;
    if (c.h > maxH) maxH = c.h;
    if (c.v > maxVol) maxVol = c.v;
  });
  const pRange = maxH - minL || 1;
  const pPad = pRange * 0.05;
  minL -= pPad;
  maxH += pPad;
  const totalRange = maxH - minL;

  chartLayout = { padL, padR, cw, chartH, minL, totalRange };

  const yP = (p) => 5 + (1 - (p - minL) / totalRange) * chartH;

  // Grid lines
  ctx.fillStyle = '#4a5a74';
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const p = minL + (totalRange * i) / 5;
    const y = yP(p);
    ctx.strokeStyle = 'rgba(30,42,58,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(fmt(p), W - 5, y + 4);
  }

  // Time labels
  ctx.fillStyle = '#4a5a74';
  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'center';
  const labelEvery = Math.max(1, Math.floor(candles.length / 6));
  for (let i = 0; i < candles.length; i += labelEvery) {
    const x = padL + i * cw + cw / 2;
    const time = new Date(candles[i].t).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    ctx.fillText(time, x, H - volH + 12);
  }

  // Volume bars
  candles.forEach((c, i) => {
    const x = padL + i * cw;
    const vh = maxVol > 0 ? (c.v / maxVol) * (volH - 15) : 0;
    const vGrad = ctx.createLinearGradient(0, H - vh, 0, H);
    if (c.c >= c.o) {
      vGrad.addColorStop(0, 'rgba(0,232,123,0.25)');
      vGrad.addColorStop(1, 'rgba(0,232,123,0.05)');
    } else {
      vGrad.addColorStop(0, 'rgba(255,41,82,0.25)');
      vGrad.addColorStop(1, 'rgba(255,41,82,0.05)');
    }
    ctx.fillStyle = vGrad;
    ctx.fillRect(x + cw * 0.15, H - vh, cw * 0.7, vh);
  });

  // Candles
  candles.forEach((c, i) => {
    const x = padL + i * cw + cw / 2;
    const green = c.c >= c.o;
    const color = green ? '#00e87b' : '#ff2952';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yP(c.h));
    ctx.lineTo(x, yP(c.l));
    ctx.stroke();
    const yOpen = yP(c.o);
    const yClose = yP(c.c);
    const bodyH = Math.max(Math.abs(yClose - yOpen), 1);
    ctx.fillStyle = color;
    ctx.fillRect(x - cw * 0.35, Math.min(yOpen, yClose), cw * 0.7, bodyH);
  });

  // SMA lines
  const sma7 = calcSMA(candles, 7);
  const sma25 = calcSMA(candles, 25);

  function drawLine(data, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    data.forEach((v, i) => {
      if (v === null) return;
      const x = padL + i * cw + cw / 2;
      const y = yP(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }
  drawLine(sma7, '#2196f3');
  drawLine(sma25, '#ff9800');

  const lastSma7 = sma7.filter((v) => v !== null).pop();
  const lastSma25 = sma25.filter((v) => v !== null).pop();
  document.getElementById('sma7-val').textContent = lastSma7 ? fmt(lastSma7) : '--';
  document.getElementById('sma25-val').textContent = lastSma25 ? fmt(lastSma25) : '--';

  drawRSI(candles);
}

/** Set up hover tooltip and crosshair on the chart container. */
export function initChartInteraction() {
  const chartContainer = document.getElementById('chart-container');
  const tooltip = document.getElementById('chart-tooltip');
  const crosshair = document.getElementById('chart-crosshair');
  const chH = document.getElementById('ch-h');
  const chV = document.getElementById('ch-v');
  const chPriceLabel = document.getElementById('ch-price-label');

  chartContainer.addEventListener('mousemove', (e) => {
    const candles = state.candles;
    if (candles.length < 2) return;
    const rect = chartContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { padL, padR, cw, chartH, minL, totalRange } = chartLayout;

    const idx = Math.floor((x - padL) / cw);
    if (idx < 0 || idx >= candles.length) {
      tooltip.style.display = 'none';
      crosshair.style.display = 'none';
      return;
    }

    const c = candles[idx];
    const green = c.c >= c.o;
    const time = new Date(c.t).toLocaleTimeString('en-US', { hour12: false });
    const date = new Date(c.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    tooltip.innerHTML = `
      <div class="tt-time">${date} ${time}</div>
      <div><span class="tt-label">O</span> <span class="${green ? 'tt-green' : 'tt-red'}">${fmt(c.o)}</span></div>
      <div><span class="tt-label">H</span> <span class="${green ? 'tt-green' : 'tt-red'}">${fmt(c.h)}</span></div>
      <div><span class="tt-label">L</span> <span class="${green ? 'tt-green' : 'tt-red'}">${fmt(c.l)}</span></div>
      <div><span class="tt-label">C</span> <span class="${green ? 'tt-green' : 'tt-red'}">${fmt(c.c)}</span></div>
      <div><span class="tt-label">Vol</span> ${fmtK(c.v)}</div>
    `;
    tooltip.style.display = 'block';

    const ttW = tooltip.offsetWidth;
    const ttH = tooltip.offsetHeight;
    let tx = x + 15;
    let ty = y - ttH / 2;
    if (tx + ttW > rect.width - 10) tx = x - ttW - 15;
    if (ty < 5) ty = 5;
    if (ty + ttH > rect.height - 5) ty = rect.height - ttH - 5;
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';

    crosshair.style.display = 'block';
    chH.style.top = y + 'px';
    chV.style.left = padL + idx * cw + cw / 2 + 'px';

    if (y <= chartH + 5 && totalRange > 0) {
      const hoverPrice = minL + (1 - (y - 5) / chartH) * totalRange;
      chPriceLabel.textContent = fmt(hoverPrice);
      chPriceLabel.style.top = y + 'px';
      chPriceLabel.style.display = 'block';
    } else {
      chPriceLabel.style.display = 'none';
    }
  });

  chartContainer.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    crosshair.style.display = 'none';
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add js/chart.js js/rsi.js
git commit -m "feat: add js/chart.js and js/rsi.js for candlestick and RSI rendering"
```

---

## Task 10: Create js/orderbook.js, js/trades.js, js/ticker.js

**Files:**
- Create: `js/orderbook.js`
- Create: `js/trades.js`
- Create: `js/ticker.js`

- [ ] **Step 1: Create js/orderbook.js**

```javascript
/**
 * Order book rendering.
 */

import { fmt } from './utils.js';
import { update } from './state.js';

let depthRenderScheduled = false;
let pendingDepth = null;

export function onDepth(d) {
  if (depthRenderScheduled) {
    pendingDepth = d;
    return;
  }
  depthRenderScheduled = true;
  pendingDepth = null;
  requestAnimationFrame(() => {
    depthRenderScheduled = false;
    renderDepth(pendingDepth || d);
  });
  renderDepth(d);
}

function renderDepth(d) {
  const asks = d.asks.slice(0, 10).reverse();
  const bids = d.bids.slice(0, 10);
  const maxQty = Math.max(
    ...asks.map((a) => parseFloat(a[1])),
    ...bids.map((b) => parseFloat(b[1]))
  );

  document.getElementById('asks').innerHTML = asks
    .map((a) => {
      const pct = ((parseFloat(a[1]) / maxQty) * 100).toFixed(0);
      return `<div class="ob-row ask mono"><div class="ob-bg" style="width:${pct}%"></div><span class="ob-price" style="color:var(--red)">${fmt(parseFloat(a[0]))}</span><span class="ob-qty">${parseFloat(a[1]).toFixed(5)}</span></div>`;
    })
    .join('');

  document.getElementById('bids').innerHTML = bids
    .map((b) => {
      const pct = ((parseFloat(b[1]) / maxQty) * 100).toFixed(0);
      return `<div class="ob-row bid mono"><div class="ob-bg" style="width:${pct}%"></div><span class="ob-price" style="color:var(--green)">${fmt(parseFloat(b[0]))}</span><span class="ob-qty">${parseFloat(b[1]).toFixed(5)}</span></div>`;
    })
    .join('');

  if (d.asks.length && d.bids.length) {
    const bestAsk = parseFloat(d.asks[0][0]);
    const bestBid = parseFloat(d.bids[0][0]);
    const spread = bestAsk - bestBid;
    const spreadPct = ((spread / bestAsk) * 100).toFixed(4);
    document.getElementById('ob-spread').textContent = `Spread: $${fmt(spread)} (${spreadPct}%)`;
    document.getElementById('s-spread').textContent = '$' + fmt(spread);
  }

  update('lastUpdateTime', Date.now());
}
```

- [ ] **Step 2: Create js/trades.js**

```javascript
/**
 * Recent trades feed rendering.
 */

import { fmt } from './utils.js';
import { state, update } from './state.js';
import { scheduleChartDraw } from './chart.js';

let tradeRenderScheduled = false;

export function onTrade(d) {
  const price = parseFloat(d.p);
  const priceEl = document.getElementById('price');

  if (state.lastPrice > 0 && price !== state.lastPrice) {
    priceEl.classList.remove('flash-green', 'flash-red', 'pulse');
    void priceEl.offsetWidth; // force reflow
    priceEl.classList.add(price >= state.lastPrice ? 'flash-green' : 'flash-red', 'pulse');
  }
  update('lastPrice', price);
  priceEl.textContent = '$' + fmt(price);
  document.title = '$' + fmt(price) + ' | BTC/USDT';

  update('lastUpdateTime', Date.now());

  const trades = state.trades;
  trades.unshift({
    price: d.p,
    qty: d.q,
    time: new Date(d.T),
    buyer: d.m === false,
    isNew: true,
  });
  if (trades.length > 50) trades.length = 50;

  if (!tradeRenderScheduled) {
    tradeRenderScheduled = true;
    requestAnimationFrame(() => {
      tradeRenderScheduled = false;
      renderTrades();
    });
  }

  // Update last candle from trade data
  const candles = state.candles;
  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    last.c = price;
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
    scheduleChartDraw();
  }
}

function renderTrades() {
  const el = document.getElementById('trades-list');
  const displayTrades = state.trades.slice(0, 20);
  el.innerHTML = displayTrades
    .map((t) => {
      const cls = t.buyer ? 'buy' : 'sell';
      const newCls = t.isNew ? ' new-trade' : '';
      const time = t.time.toLocaleTimeString('en-US', { hour12: false });
      t.isNew = false;
      return `<div class="trade-row ${cls}${newCls} mono">
      <span class="trade-price">${fmt(parseFloat(t.price))}</span>
      <span class="trade-qty">${parseFloat(t.qty).toFixed(5)}</span>
      <span class="trade-time">${time}</span>
    </div>`;
    })
    .join('');
}
```

- [ ] **Step 3: Create js/ticker.js**

```javascript
/**
 * Price display, 24h stats, header status updates.
 */

import { fmt, fmtK, setColor } from './utils.js';
import { state, update } from './state.js';

export function onTicker(d) {
  const change = parseFloat(d.p);
  const pct = parseFloat(d.P);
  const changeEl = document.getElementById('s-change');
  const pctEl = document.getElementById('s-pct');
  changeEl.textContent = (change >= 0 ? '+' : '') + fmt(change);
  pctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  setColor(changeEl, change);
  setColor(pctEl, pct);
  document.getElementById('s-high').textContent = fmt(parseFloat(d.h));
  document.getElementById('s-low').textContent = fmt(parseFloat(d.l));
  document.getElementById('s-vol').textContent = fmtK(d.q) + ' USDT';
  update('lastUpdateTime', Date.now());
}

/** Start the periodic UI timers (last-update display, footer clock). */
export function startTimers() {
  // "Last update" display
  setInterval(() => {
    if (!state.lastUpdateTime) return;
    const el = document.getElementById('last-update');
    const ago = Math.floor((Date.now() - state.lastUpdateTime) / 1000);
    if (ago < 2) {
      el.textContent = 'Just now';
      document.getElementById('live-badge').style.display = 'flex';
    } else if (ago < 60) {
      el.textContent = `Updated ${ago}s ago`;
    } else {
      el.textContent = `Updated ${Math.floor(ago / 60)}m ago`;
    }
    if (ago > 5) document.getElementById('live-badge').style.display = 'none';
  }, 1000);

  // Footer clock
  setInterval(() => {
    const now = new Date();
    const tz = now.getTimezoneOffset();
    document.getElementById('footer-time').textContent =
      now.toLocaleTimeString('en-US', { hour12: false }) +
      ' UTC' +
      (tz > 0 ? '-' : '+') +
      Math.abs(tz / 60);
  }, 1000);
}
```

- [ ] **Step 4: Commit**

```bash
git add js/orderbook.js js/trades.js js/ticker.js
git commit -m "feat: add orderbook, trades, and ticker JS modules"
```

---

## Task 11: Create js/api.js, js/websocket.js, and js/main.js

**Files:**
- Create: `js/api.js`
- Create: `js/websocket.js`
- Create: `js/main.js`

- [ ] **Step 1: Create js/api.js**

```javascript
/**
 * REST API fetch wrappers.
 */

import { state, update } from './state.js';

const MAX_CANDLES = 100;

/** Fetch initial candle data from server. */
export async function loadCandles() {
  try {
    const resp = await fetch('/api/candles');
    const data = await resp.json();
    const candles = data.map((k) => ({
      t: k[0],
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: parseFloat(k[5]),
    }));
    update('candles', candles);
  } catch (e) {
    console.error('Failed to load candles:', e);
  }
}

export { MAX_CANDLES };
```

- [ ] **Step 2: Create js/websocket.js**

```javascript
/**
 * WebSocket connection to the local proxy server.
 */

import { update } from './state.js';
import { onTrade } from './trades.js';
import { onTicker } from './ticker.js';
import { onDepth } from './orderbook.js';
import { onKline } from './main.js';

let proxyWs = null;
let proxyReconnectTimer = null;

const streamHandlers = {
  'btcusdt@trade': onTrade,
  'btcusdt@kline_1s': onKline,
  'btcusdt@ticker': onTicker,
  'btcusdt@depth10': onDepth,
};

export function connectProxy() {
  if (proxyWs) {
    try {
      proxyWs.close();
    } catch (e) {
      /* ignore */
    }
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  proxyWs = new WebSocket(`${proto}//${location.host}/ws`);

  proxyWs.onopen = () => {
    update('connected', true);
    updateConnStatus(true);
  };

  proxyWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      const handler = streamHandlers[msg.stream];
      if (handler) handler(msg.data);
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  proxyWs.onclose = () => {
    update('connected', false);
    updateConnStatus(false);
    clearTimeout(proxyReconnectTimer);
    proxyReconnectTimer = setTimeout(connectProxy, 3000);
  };

  proxyWs.onerror = () => proxyWs.close();
}

function updateConnStatus(connected) {
  const dot = document.getElementById('conn-dot');
  const txt = document.getElementById('conn-text');
  if (connected) {
    dot.className = 'connected';
    txt.textContent = 'Connected';
  } else {
    dot.className = 'disconnected';
    txt.textContent = 'Disconnected';
  }
}
```

- [ ] **Step 3: Create js/main.js**

```javascript
/**
 * Application entry point.
 * Initializes all modules and starts the dashboard.
 */

import { state, update, subscribe } from './state.js';
import { loadCandles, MAX_CANDLES } from './api.js';
import { drawChart, scheduleChartDraw, initChartInteraction } from './chart.js';
import { connectProxy } from './websocket.js';
import { startTimers } from './ticker.js';

/**
 * Handle 1-second kline stream data.
 * Aggregates into 1-minute candles.
 */
export function onKline(d) {
  const k = d.k;
  const candle = {
    t: k.t,
    o: parseFloat(k.o),
    h: parseFloat(k.h),
    l: parseFloat(k.l),
    c: parseFloat(k.c),
    v: parseFloat(k.v),
  };
  const minuteT = Math.floor(candle.t / 60000) * 60000;
  const candles = state.candles;

  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    const lastMinute = Math.floor(last.t / 60000) * 60000;
    if (minuteT === lastMinute) {
      last.h = Math.max(last.h, candle.h);
      last.l = Math.min(last.l, candle.l);
      last.c = candle.c;
      last.v = candle.v;
    } else if (minuteT > lastMinute) {
      candles.push({
        t: minuteT,
        o: candle.o,
        h: candle.h,
        l: candle.l,
        c: candle.c,
        v: candle.v,
      });
      if (candles.length > MAX_CANDLES) candles.shift();
    }
  }
  scheduleChartDraw();
}

// ── Subscribe to state changes that require chart redraws ──
subscribe('candles', () => drawChart());

// ── Initialize ──
async function init() {
  startTimers();
  initChartInteraction();
  await loadCandles();
  connectProxy();

  // Redraw chart on window resize
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawChart, 100);
  });
}

init();
```

- [ ] **Step 4: Fix circular dependency**

Note: `js/websocket.js` imports `onKline` from `js/main.js`, and `js/main.js` imports `connectProxy` from `js/websocket.js` — this is a circular dependency. Fix by moving `onKline` out of `main.js` and into a new approach: have `websocket.js` accept handlers via a registration function instead.

Replace `js/websocket.js` with:

```javascript
/**
 * WebSocket connection to the local proxy server.
 */

import { update } from './state.js';

let proxyWs = null;
let proxyReconnectTimer = null;
let streamHandlers = {};

/** Register stream handlers before connecting. */
export function setStreamHandlers(handlers) {
  streamHandlers = handlers;
}

export function connectProxy() {
  if (proxyWs) {
    try {
      proxyWs.close();
    } catch (e) {
      /* ignore */
    }
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  proxyWs = new WebSocket(`${proto}//${location.host}/ws`);

  proxyWs.onopen = () => {
    update('connected', true);
    updateConnStatus(true);
  };

  proxyWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      const handler = streamHandlers[msg.stream];
      if (handler) handler(msg.data);
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  proxyWs.onclose = () => {
    update('connected', false);
    updateConnStatus(false);
    clearTimeout(proxyReconnectTimer);
    proxyReconnectTimer = setTimeout(connectProxy, 3000);
  };

  proxyWs.onerror = () => proxyWs.close();
}

function updateConnStatus(connected) {
  const dot = document.getElementById('conn-dot');
  const txt = document.getElementById('conn-text');
  if (connected) {
    dot.className = 'connected';
    txt.textContent = 'Connected';
  } else {
    dot.className = 'disconnected';
    txt.textContent = 'Disconnected';
  }
}
```

And update `js/main.js` to register handlers:

```javascript
/**
 * Application entry point.
 * Initializes all modules and starts the dashboard.
 */

import { state, subscribe } from './state.js';
import { loadCandles, MAX_CANDLES } from './api.js';
import { drawChart, scheduleChartDraw, initChartInteraction } from './chart.js';
import { connectProxy, setStreamHandlers } from './websocket.js';
import { onTicker, startTimers } from './ticker.js';
import { onTrade } from './trades.js';
import { onDepth } from './orderbook.js';

/**
 * Handle 1-second kline stream data.
 * Aggregates into 1-minute candles.
 */
function onKline(d) {
  const k = d.k;
  const candle = {
    t: k.t,
    o: parseFloat(k.o),
    h: parseFloat(k.h),
    l: parseFloat(k.l),
    c: parseFloat(k.c),
    v: parseFloat(k.v),
  };
  const minuteT = Math.floor(candle.t / 60000) * 60000;
  const candles = state.candles;

  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    const lastMinute = Math.floor(last.t / 60000) * 60000;
    if (minuteT === lastMinute) {
      last.h = Math.max(last.h, candle.h);
      last.l = Math.min(last.l, candle.l);
      last.c = candle.c;
      last.v = candle.v;
    } else if (minuteT > lastMinute) {
      candles.push({
        t: minuteT,
        o: candle.o,
        h: candle.h,
        l: candle.l,
        c: candle.c,
        v: candle.v,
      });
      if (candles.length > MAX_CANDLES) candles.shift();
    }
  }
  scheduleChartDraw();
}

// ── Register stream handlers ──
setStreamHandlers({
  'btcusdt@trade': onTrade,
  'btcusdt@kline_1s': onKline,
  'btcusdt@ticker': onTicker,
  'btcusdt@depth10': onDepth,
});

// ── Subscribe to state changes that require chart redraws ──
subscribe('candles', () => drawChart());

// ── Initialize ──
async function init() {
  startTimers();
  initChartInteraction();
  await loadCandles();
  connectProxy();

  // Redraw chart on window resize
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawChart, 100);
  });
}

init();
```

- [ ] **Step 5: Commit**

```bash
git add js/api.js js/websocket.js js/main.js
git commit -m "feat: add api, websocket, and main entry point JS modules"
```

---

## Task 12: Rewrite index.html to HTML-Only

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace index.html with HTML-only version**

Replace the entire `index.html` with this version that has no inline CSS or JS — just HTML structure with module imports:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BTC/USDT Dashboard</title>
<link rel="stylesheet" href="/css/styles.css">
</head>
<body>

<header>
  <div class="header-left">
    <div class="logo">
      <div class="logo-icon">B</div>
      <span class="logo-text">BTC / USDT</span>
    </div>
    <span class="pair-badge">Spot</span>
  </div>
  <div class="header-right">
    <div class="live-badge" id="live-badge" style="display:none"><span class="live-dot"></span>LIVE</div>
    <span id="last-update"></span>
    <div id="conn-status"><span id="conn-dot"></span><span id="conn-text">Connecting...</span></div>
  </div>
</header>

<div class="grid">
  <!-- Price Hero -->
  <div class="card price-section">
    <div id="price" class="mono">--</div>
    <div class="price-subtitle">Bitcoin / Tether</div>
    <div class="stats-row">
      <div class="stat"><div class="stat-label">24h Change</div><div class="stat-value mono" id="s-change">--</div></div>
      <div class="stat"><div class="stat-label">24h %</div><div class="stat-value mono" id="s-pct">--</div></div>
      <div class="stat"><div class="stat-label">24h High</div><div class="stat-value mono" id="s-high">--</div></div>
      <div class="stat"><div class="stat-label">24h Low</div><div class="stat-value mono" id="s-low">--</div></div>
      <div class="stat"><div class="stat-label">24h Volume</div><div class="stat-value mono" id="s-vol">--</div></div>
      <div class="stat"><div class="stat-label">Spread</div><div class="stat-value mono" id="s-spread">--</div></div>
    </div>
  </div>

  <!-- Chart -->
  <div class="card chart-section">
    <h2>1-Minute Candles</h2>
    <div id="chart-container">
      <canvas id="chart-canvas"></canvas>
      <div id="chart-tooltip"></div>
      <div id="chart-crosshair"><div id="ch-h"></div><div id="ch-v"></div><div id="ch-price-label"></div></div>
    </div>
    <div id="rsi-container"><canvas id="rsi-canvas"></canvas></div>
    <div class="indicator-legend">
      <div class="legend-item"><div class="legend-dot" style="background:#2196f3"></div>SMA 7</div>
      <div class="legend-item"><div class="legend-dot" style="background:#ff9800"></div>SMA 25</div>
      <div class="legend-item"><div class="legend-dot" style="background:#ab47bc"></div>RSI 14</div>
    </div>
  </div>

  <!-- Order Book -->
  <div class="card">
    <h2>Order Book (Top 10)</h2>
    <div id="orderbook">
      <div class="orderbook-side"><h3>Asks</h3><div id="asks"></div></div>
      <div class="spread-row" id="ob-spread">--</div>
      <div class="orderbook-side"><h3>Bids</h3><div id="bids"></div></div>
    </div>
  </div>

  <!-- Indicators -->
  <div class="card">
    <h2>Indicators</h2>
    <div class="indicator-item">
      <div class="stat-label">RSI (14)</div>
      <div class="mono indicator-main" id="rsi-val">--</div>
      <div id="rsi-label" style="font-size:12px;margin-top:4px;font-weight:500;letter-spacing:0.5px">--</div>
    </div>
    <div class="indicator-item">
      <div class="stat-label">SMA 7</div>
      <div class="mono indicator-secondary" id="sma7-val">--</div>
    </div>
    <div class="indicator-item">
      <div class="stat-label">SMA 25</div>
      <div class="mono indicator-secondary" id="sma25-val">--</div>
    </div>
  </div>

  <!-- Recent Trades -->
  <div class="card">
    <h2>Recent Trades</h2>
    <div id="trades-list"></div>
  </div>
</div>

<footer>
  <span>BTC/USDT Real-Time Dashboard</span>
  <span id="footer-time"></span>
</footer>

<script type="module" src="/js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify in browser**

Run the server and open http://localhost:3000. Verify:
1. Page loads without console errors
2. CSS styles render correctly (dark theme, grid layout)
3. Live price updates appear
4. Candlestick chart draws correctly
5. Order book updates
6. Recent trades scroll in
7. RSI and SMA indicators display
8. Tooltip and crosshair work on chart hover
9. Connection status shows "Connected"
10. "LIVE" badge appears

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "refactor: replace monolithic index.html with HTML-only + ES module imports"
```

---

## Task 13: Add .gitignore and Update CLAUDE.md

**Files:**
- Create or modify: `.gitignore`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create .gitignore**

```gitignore
.env
__pycache__/
*.pyc
```

- [ ] **Step 2: Update CLAUDE.md**

Update the CLAUDE.md to reflect the new modular structure. Replace the Files table section with:

```markdown
## Files

| File/Dir | Purpose |
|---|---|
| `server.py` | Entry point — wires up routes, services, static files |
| `routes/websocket.py` | Browser WebSocket handler |
| `routes/candles.py` | GET /api/candles endpoint |
| `services/config.py` | Configuration from .env with defaults |
| `services/binance.py` | Binance WebSocket relay + candle cache |
| `services/db.py` | asyncpg pool + SQL migration runner |
| `models/migrations/` | Numbered SQL migration files |
| `index.html` | HTML layout only (~120 lines) |
| `css/styles.css` | All CSS styles |
| `js/main.js` | Frontend entry point, initialization |
| `js/state.js` | Centralized pub/sub state store |
| `js/websocket.js` | WebSocket connection + reconnect |
| `js/api.js` | REST API fetch wrappers |
| `js/chart.js` | Candlestick chart + hover/crosshair |
| `js/rsi.js` | RSI sub-chart rendering |
| `js/indicators.js` | SMA, RSI calculation (pure math) |
| `js/orderbook.js` | Order book rendering |
| `js/trades.js` | Recent trades feed |
| `js/ticker.js` | Price display, 24h stats, timers |
| `js/utils.js` | Number/date formatting helpers |
| `serve.py` | Legacy simple HTTP server (unused) |
```

Also update the Dependencies section to:

```markdown
## Dependencies

Python venv at `/home/fchrulk/venvs/btc-dashboard/`:
- `aiohttp` — HTTP server + WebSocket + REST client
- `websockets` — Binance upstream WebSocket connection
- `asyncpg` — Async PostgreSQL driver
- `python-dotenv` — .env file loading

See `requirements.txt` for pinned versions.
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore CLAUDE.md
git commit -m "chore: add .gitignore and update CLAUDE.md for new module structure"
```

---

## Task 14: End-to-End Verification

**Files:** None (testing only)

- [ ] **Step 1: Start the server and verify full functionality**

Run:
```bash
cd /home/fchrulk/apps/mockex
source /home/fchrulk/venvs/btc-dashboard/bin/activate
python server.py
```

Open http://localhost:3000 in a browser (via SSH tunnel if remote).

- [ ] **Step 2: Verify checklist**

Check each item:
- [ ] Server starts with proper logging (config, DB, Binance)
- [ ] No Python import errors in terminal
- [ ] No JavaScript errors in browser console
- [ ] Dashboard displays live BTC/USDT price
- [ ] Price flashes green/red on changes
- [ ] Candlestick chart renders with volume bars
- [ ] SMA 7 (blue) and SMA 25 (orange) lines visible
- [ ] RSI sub-chart renders with zones
- [ ] Order book shows 10 bids and 10 asks
- [ ] Recent trades scroll in with buy/sell colors
- [ ] 24h stats (Change, %, High, Low, Volume, Spread) update
- [ ] Chart hover tooltip shows OHLCV
- [ ] Crosshair follows mouse
- [ ] "LIVE" badge appears when data is flowing
- [ ] Connection status shows "Connected"
- [ ] Browser title updates with price
- [ ] Footer clock ticks
- [ ] Responsive: shrink browser window, layout reflows to 2-col then 1-col

- [ ] **Step 3: Verify PostgreSQL migration**

Check that the mockex schema was created:
```bash
psql -h 127.0.0.1 -U fchrulk -d financial -c "SELECT * FROM mockex.schema_version;"
```

Expected: one row with version=1.

- [ ] **Step 4: Final commit (if any fixes needed)**

If any fixes were required during verification, commit them:
```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
