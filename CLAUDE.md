# CLAUDE.md — Mockex

## What is this?

Mockex is a real-time BTC/USDT trading dashboard and paper trading simulator. Streams live market data from Binance, supports virtual wallet with market/limit/stop orders, position tracking with live PnL, and order book walking for realistic fill simulation.

## Architecture

```
Binance WebSocket API → services/binance.py → Browser WebSocket → ES module UI
                                            → services/matching.py (tick-by-tick order checking)
Binance REST API (/klines) → routes/candles.py → Initial chart data
Trading: Browser WS/REST → routes/trading.py → services/matching.py → DB + broadcast
Config: .env → services/config.py
Database: PostgreSQL → services/db.py (asyncpg + migrations)
```

## Files

| File/Dir | Purpose |
|---|---|
| `server.py` | Entry point — wires up routes, services, static files |
| `routes/websocket.py` | Browser WebSocket handler (market data + trading messages) |
| `routes/candles.py` | GET /api/candles endpoint |
| `routes/trading.py` | REST endpoints: orders, positions, trades, account |
| `services/config.py` | Configuration from .env with defaults |
| `services/binance.py` | Binance WebSocket relay + candle cache + matching feed |
| `services/matching.py` | Paper trading engine: validation, fills, positions, PnL |
| `services/db.py` | asyncpg pool + SQL migration runner |
| `models/migrations/` | Numbered SQL migration files |
| `index.html` | HTML layout (dashboard + trading panel) |
| `css/styles.css` | All CSS styles |
| `js/main.js` | Frontend entry point, initialization |
| `js/state.js` | Centralized pub/sub state store |
| `js/websocket.js` | WebSocket connection + reconnect + trading message routing |
| `js/trading.js` | Trading panel: wallet, order entry, positions/orders/history |
| `js/api.js` | REST API fetch wrappers |
| `js/chart.js` | Candlestick chart + hover/crosshair |
| `js/rsi.js` | RSI sub-chart rendering |
| `js/indicators.js` | SMA, RSI calculation (pure math) |
| `js/orderbook.js` | Order book rendering |
| `js/trades.js` | Recent trades feed |
| `js/ticker.js` | Price display, 24h stats, timers |
| `js/utils.js` | Number/date formatting helpers |
| `serve.py` | Legacy simple HTTP server (unused) |

## Running

```bash
# Activate venv
source /home/fchrulk/venvs/btc-dashboard/bin/activate

# Start the server (port 3000)
cd /home/fchrulk/apps/mockex
python server.py
```

Access at `http://localhost:3000`. For remote VPS access, use SSH tunnel:
```bash
ssh -L 3000:localhost:3000 <vps>
```

## Dependencies

Python venv at `/home/fchrulk/venvs/btc-dashboard/`:
- `aiohttp` — HTTP server + WebSocket + REST client
- `websockets` — Binance upstream WebSocket connection
- `asyncpg` — Async PostgreSQL driver
- `python-dotenv` — .env file loading

See `requirements.txt` for pinned versions.

## Binance Streams

Connected via combined stream endpoint:
- `btcusdt@trade` — individual trades (real-time price updates)
- `btcusdt@kline_1s` — 1-second kline candles
- `btcusdt@ticker` — 24h rolling stats
- `btcusdt@depth10` — top 10 order book levels

## Key Behaviors

- Candlestick chart is 1-minute interval, rendered on HTML Canvas
- Last candle updates in real-time from trade events (close/high/low)
- Technical indicators: SMA(7), SMA(25), RSI(14) computed client-side
- Chart redraws throttled via `requestAnimationFrame`
- Server auto-reconnects to Binance on disconnect (3s retry)
- Candle cache refreshes every 30s
- Database migrations run automatically on server startup
- Config loaded from `.env` with sensible defaults

## Paper Trading Engine

- Virtual wallet: $100,000 USDT starting balance (configurable)
- Order types: market (instant fill), limit (price trigger), stop (stop-loss/buy stop)
- Market orders walk the real order book (depth10) for realistic slippage
- Limit/stop orders checked on every depth10 tick from Binance
- Self-crossing: limit orders that cross the spread fill immediately as market
- One position per symbol (long only, spot simulation)
- Entry price: volume-weighted average across multiple buys
- Realized PnL on sell: `(sell_price - entry_price) × qty - fee`
- Unrealized PnL updated live: `(current_price - entry_price) × qty`
- Fee: 0.1% per fill (configurable via `TRADING_FEE_RATE`)
- Account reset: wipes all orders/trades/positions, restores initial balance
- State persists to PostgreSQL, recovered on server restart

## Trading API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/orders` | Place order (side, order_type, quantity, price, stop_price) |
| DELETE | `/api/orders/{id}` | Cancel open order |
| GET | `/api/orders` | List orders (?status=open/filled/cancelled) |
| GET | `/api/positions` | Current position with live PnL |
| GET | `/api/trades` | Executed trade history |
| GET | `/api/account` | Account balances (cash, reserved, equity) |
| POST | `/api/account/reset` | Reset account |

WebSocket messages: `place_order`, `cancel_order`, `close_position`, `reset_account` (client→server); `order_update`, `trade_executed`, `balance_update`, `position_update` (server→client).

## Design Specs & Plans

See `docs/superpowers/specs/` for approved design specs (6 total).
See `docs/superpowers/plans/` for implementation plans.

### Implementation Status

- [x] Spec 1: Foundation & Refactoring
- [x] Spec 2: Trading Engine
- [ ] Spec 3: Portfolio & PnL
- [ ] Spec 4: Chart & Indicators
- [ ] Spec 5: AI Trading Signals
- [ ] Spec 6: Polish & Extras
