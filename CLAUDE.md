# CLAUDE.md — Mockex

## What is this?

Mockex is a real-time BTC/USDT trading dashboard that streams live market data from Binance. Long-term vision: a full crypto trading simulator (virtual wallet, buy/sell, limit orders, portfolio) using live data.

## Architecture

```
Binance WebSocket API → services/binance.py → Browser WebSocket → ES module UI
Binance REST API (/klines) → routes/candles.py → Initial chart data
Config: .env → services/config.py
Database: PostgreSQL → services/db.py (asyncpg + migrations)
```

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
| `index.html` | HTML layout only (~99 lines) |
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

## Design Specs & Plans

See `docs/superpowers/specs/` for approved design specs (6 total).
See `docs/superpowers/plans/` for implementation plans.
