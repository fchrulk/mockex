# Mockex

Real-time BTC/USDT trading dashboard with live Binance data. Built as the foundation for a crypto trading simulator.

## Features

- Live candlestick chart (1-minute candles, real-time updates)
- Technical indicators: SMA(7), SMA(25), RSI(14)
- Order book depth (top 10 bids/asks)
- Recent trades feed
- 24-hour market statistics
- Interactive chart with hover tooltips and crosshair

## Quick Start

### Prerequisites

- Python 3.10+
- pip

### Install

```bash
python -m venv venv
source venv/bin/activate
pip install aiohttp websockets
```

### Run

```bash
python server.py
```

Open [http://localhost:3000](http://localhost:3000)

## How It Works

The server connects to Binance WebSocket streams server-side and relays data to your browser. This avoids regional restrictions and CORS issues.

```
Binance WebSocket → server.py (proxy) → Browser
```

### Data Streams

| Stream | Data |
|---|---|
| `btcusdt@trade` | Individual trades |
| `btcusdt@kline_1s` | 1-second candles |
| `btcusdt@ticker` | 24h rolling stats |
| `btcusdt@depth10` | Order book (top 10) |

## Roadmap

- [ ] Virtual wallet with simulated balance
- [ ] Market buy/sell orders
- [ ] Limit and stop orders
- [ ] Portfolio tracking with PnL
- [ ] Historical replay and backtesting
- [ ] AI-powered trading signals

## License

MIT
