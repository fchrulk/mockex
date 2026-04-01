# CLAUDE.md — Mockex

## What is this?

Mockex is a real-time BTC/USDT trading dashboard that streams live market data from Binance. Long-term vision: a full crypto trading simulator (virtual wallet, buy/sell, limit orders, portfolio) using live data.

## Architecture

```
Binance WebSocket API → server.py (aiohttp proxy) → Browser WebSocket → Canvas chart + UI
Binance REST API (/klines) → server.py (/api/candles) → Initial chart data
```

## Files

| File | Purpose |
|---|---|
| `server.py` | aiohttp WebSocket proxy — connects to Binance server-side, fans out to browser clients, caches candles |
| `index.html` | Single-file frontend — dark trading terminal UI, canvas candlestick chart, order book, trades, 24h stats |
| `serve.py` | Legacy simple HTTP server (unused, kept for reference) |

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

## Future Plans (Mockex Trading Simulator)

Phase 1: Virtual wallet + market buy/sell
Phase 2: Limit/stop orders + order matching
Phase 3: Portfolio view + PnL tracking
Phase 4: Historical replay + backtesting
Phase 5: AI decision layer
