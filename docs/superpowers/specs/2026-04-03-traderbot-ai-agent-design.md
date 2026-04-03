# TraderBot — AI Trading Agent Design Spec

## Overview

TraderBot is an autonomous AI trading agent for BTC/USDT. It connects to mockex for paper trading simulation, then swaps to Binance's real API for live trading with real money. The agent uses a hybrid approach: rule-based strategies generate signals, a risk manager enforces limits, and Claude AI reviews every trade before execution.

**Goal:** Build a configurable trading agent that proves itself on paper first, then trades real money with full AI oversight and Telegram-based human control.

**Location:** `apps/traderbot/` — sibling to `apps/mockex/`, same git repository. Separate Python project with its own venv and entry point. Communicates with mockex exclusively via HTTP/WebSocket API (same interface it uses for Binance).

## Architecture

```
Market Data (WebSocket)
    ↓
Candle Aggregator (1s → 5m, 15m, etc.)
    ↓
Strategy Engine (pluggable strategies)
    ↓ Signal
Risk Manager (position size, daily loss, drawdown, cooldown)
    ↓ Approved Signal
Claude AI Reviewer (mandatory — approve/reject/modify)
    ↓ AI-Approved Signal
Autonomy Gate (semi: Telegram approval, full: auto-execute)
    ↓
Exchange Adapter (mockex | binance_testnet | binance)
    ↓
Order Execution + Stop-Loss Placement
    ↓
Telegram Notification
```

**3-Stage Progression:**

1. **mockex** — paper trading against live Binance data relayed through mockex. Prove strategy works.
2. **Binance Testnet** (`testnet.binance.vision`) — real Binance API with fake money. Prove integration works.
3. **Binance Production** — real money. Same code, different URL and API keys.

Switch via single config: `EXCHANGE=mockex|binance_testnet|binance`

## Project Structure

```
apps/traderbot/
├── main.py                  # Entry point — starts the agent
├── config.py                # Config from .env
├── .env.example             # Config template
├── requirements.txt         # Dependencies
│
├── core/
│   ├── agent.py             # Main agent loop — orchestrates everything
│   ├── events.py            # Internal event bus (pub/sub)
│   └── models.py            # Data classes: Candle, Signal, Order, Trade, Position
│
├── exchange/
│   ├── base.py              # Abstract Exchange interface
│   ├── mockex.py            # Mockex adapter (REST + WS at localhost:3000)
│   ├── binance.py           # Binance adapter (REST + WS + HMAC signing)
│   └── binance_testnet.py   # Inherits binance.py, different base URLs
│
├── strategy/
│   ├── base.py              # Abstract Strategy interface
│   ├── ema_crossover.py     # V1: EMA 9/21 crossover + RSI filter
│   └── registry.py          # Load/enable/disable strategies from config
│
├── risk/
│   └── manager.py           # All risk checks before execution
│
├── brain/
│   └── claude_reviewer.py   # Claude AI signal review (mandatory)
│
├── notify/
│   └── telegram.py          # Telegram bot: alerts, approvals, commands
│
└── utils/
    └── indicators.py        # EMA, RSI, MACD, Bollinger Bands calculations
```

## Exchange Adapter Interface

All adapters implement this abstract interface:

```python
class BaseExchange:
    async def connect() -> None
    async def disconnect() -> None
    async def place_order(side, order_type, quantity, price?) -> Order
    async def cancel_order(order_id) -> Order
    async def get_balance() -> dict  # {cash, reserved, equity}
    async def get_position() -> Position | None
    async def subscribe_market_data(callback) -> None

    # Event callbacks (registered by agent)
    on_order_update: Callable
    on_balance_update: Callable
    on_trade_executed: Callable
```

### MockexAdapter

- REST: `http://localhost:3000/api/` — orders, positions, trades, account
- WebSocket: `ws://localhost:3000/ws` — market data streams + trading events
- Maps directly to mockex's existing API (no translation needed)

### BinanceAdapter

- REST: `https://api.binance.com/api/v3/` — orders, account
- WebSocket market data: `wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1s/btcusdt@trade/btcusdt@depth10`
- WebSocket user data: `wss://stream.binance.com:9443/ws/<listenKey>` — order updates, balance changes
- Authentication: HMAC-SHA256 signing on every signed request (API key in `X-MBX-APIKEY` header, signature + timestamp in query params)
- Listen key management: `POST /api/v3/userDataStream` to create, `PUT` every 30 minutes to renew

### BinanceTestnetAdapter

- Inherits from BinanceAdapter
- Overrides base URLs to `https://testnet.binance.vision/api` and `wss://testnet.binance.vision/ws`
- Same code, different endpoints, fake money

## Strategy Framework

### BaseStrategy Interface

```python
class BaseStrategy:
    name: str             # e.g., "ema_crossover"
    timeframe: str        # e.g., "5m" — which candle interval this strategy uses

    def on_candle(candle: Candle) -> Signal | None  # called when a candle closes
    def on_tick(price: float) -> Signal | None     # called on every price update; default returns None
    def configure(params: dict) -> None            # runtime param updates
```

### Signal Model

```python
@dataclass
class Signal:
    direction: str        # "buy" | "sell" | "hold"
    strength: float       # 0.0 to 1.0
    reason: str           # human-readable explanation
    strategy_name: str    # which strategy produced this
    suggested_quantity: float | None
    stop_loss: float | None
    take_profit: float | None
```

### Strategy Registry

- Config: `STRATEGIES=ema_crossover` (comma-separated list)
- Auto-discovers strategy classes from `strategy/` directory
- Routes candles to strategies based on their declared timeframe
- Collects signals and forwards to risk manager

### V1 Strategy: EMA Crossover

- **Buy signal:** EMA(9) crosses above EMA(21) AND RSI(14) < 70
- **Sell signal:** EMA(9) crosses below EMA(21) OR RSI(14) > 80
- **Timeframe:** 5m candles (aggregated from 1s WebSocket stream)
- **Strength:** Based on EMA divergence magnitude (wider gap = stronger signal)
- **Stop-loss:** 3% below entry (default, configurable)

## Risk Manager

Every signal must pass ALL checks before becoming an order. All thresholds configurable via `.env`.

| Check | Config Key | Default | Behavior on Breach |
|---|---|---|---|
| Position size | `MAX_POSITION_PCT` | 10% | Reduce quantity to fit limit |
| Daily loss limit | `MAX_DAILY_LOSS_PCT` | 5% | Halt trading until 00:00 UTC |
| Max drawdown | `MAX_DRAWDOWN_PCT` | 15% | Halt ALL trading (manual reset required) |
| Max open trades | `MAX_OPEN_TRADES` | 3 | Reject signal |
| Trade cooldown | `TRADE_COOLDOWN_SECONDS` | 300 | Reject signal (wait) |
| Stop-loss required | Always on | — | Every buy MUST have a stop-loss |

When a check fails:
- Signal rejected with reason
- Event logged
- Telegram notification sent

## Claude AI Reviewer

The Claude reviewer is **mandatory** — every signal must pass AI review before execution. No bypass.

### Review Flow

1. Signal passes risk manager
2. Agent constructs a prompt with:
   - The signal (direction, strength, strategy reasoning)
   - Recent price action (last 20 candles as OHLCV)
   - Current indicator values (RSI, MACD, EMA, Bollinger Bands)
   - Current position (if any)
   - Recent trade history (last 5 trades with outcomes)
3. Claude responds with structured JSON:
   - `decision`: "approve" | "reject" | "modify"
   - `confidence`: 0.0 to 1.0
   - `reasoning`: explanation
   - `modified_quantity`: (optional, if suggesting size adjustment)
4. If approved → proceed to execution
5. If rejected → signal dropped, logged, Telegram notification
6. If modified → apply modifications, proceed to execution

### Configuration

| Config Key | Default | Description |
|---|---|---|
| `CLAUDE_MODEL` | `haiku` | Model to use: `haiku`, `sonnet`, `opus` |
| `CLAUDE_API_KEY` | — | Anthropic API key |
| `CLAUDE_MIN_INTERVAL_SECONDS` | 120 | Min time between Claude calls (cost control) |
| `CLAUDE_FALLBACK` | `block` | What to do if Claude API is down: `block` (no trades) or `pass` (allow through) |

### Cost Estimates

- Haiku: ~$0.01/review → ~$3/month at 10 reviews/day
- Sonnet: ~$0.03/review → ~$9/month
- Opus: ~$0.15/review → ~$45/month

## Telegram Integration

The agent runs a Telegram bot using `python-telegram-bot` library.

### Notifications (Agent → User)

| Event | Example Message |
|---|---|
| Trade executed | "BUY 0.005 BTC @ $95,200 \| Stop-loss: $92,344" |
| Trade closed | "SELL 0.005 BTC @ $96,100 \| PnL: +$4.50 (+0.9%)" |
| Signal rejected (risk) | "EMA crossover BUY rejected: daily loss limit reached (-4.8%)" |
| Signal rejected (Claude) | "EMA crossover BUY rejected by Claude: bearish RSI divergence" |
| Risk alert | "Daily loss limit reached. Trading paused until 00:00 UTC" |
| Daily summary | "Today: 3 trades, 2 wins, PnL: +$12.30. Equity: $10,045" |
| Agent status | "Agent started (mockex mode)" / "Agent stopped" |

### Commands (User → Agent)

| Command | Description |
|---|---|
| `/status` | Current position, balance, active orders |
| `/performance` | Today's PnL, win rate, trade count |
| `/pause` | Pause trading (keeps monitoring market) |
| `/resume` | Resume trading |
| `/mode` | Show current exchange mode |
| `/risk` | Show current risk parameters |
| `/approve` | Approve a pending trade (semi-autonomous mode) |
| `/reject` | Reject a pending trade |

### Semi-Autonomous Approval Flow

1. Signal passes risk + Claude review
2. Agent sends: "TRADE PROPOSAL: BUY 0.005 BTC @ $95,200. Claude confidence: 0.82. /approve or /reject"
3. User responds with `/approve` or `/reject`
4. Timeout after 5 minutes → auto-reject (safe default)

Configure via: `AUTONOMY_MODE=semi|full`
- `semi`: requires Telegram approval for every trade
- `full`: executes immediately after Claude approval

## Agent Loop & Lifecycle

### Startup

1. Load config from `.env`
2. Initialize exchange adapter (mockex/binance based on `EXCHANGE`)
3. Connect to exchange (WebSocket + REST)
4. Register enabled strategies from config
5. Initialize risk manager (load current balance, reset daily counters)
6. Start Telegram bot
7. Send "Agent started (mode: {exchange})" notification

### Main Loop (Event-Driven)

```
Market data arrives via WebSocket
  → Candle aggregator builds timeframe candles (1s → 5m, 15m, etc.)
  → When candle closes → feed to all strategies for that timeframe
  → Strategy returns Signal or None
  → If Signal:
    1. Risk manager checks → pass/reject
    2. Claude AI reviews → approve/reject/modify
    3. If semi-autonomous → Telegram approval → wait (5m timeout)
    4. Execute order via exchange adapter
    5. Place stop-loss order immediately after fill
    6. Send Telegram notification
    7. Update internal state
```

### Background Tasks (asyncio)

| Task | Interval | Purpose |
|---|---|---|
| Balance sync | 30s | Update balance + position from exchange |
| Performance calc | 5m | Calculate metrics for `/performance` command |
| Daily summary | 24h (00:00 UTC) | Send daily summary, reset daily loss counter |
| Listen key renewal | 30m (Binance only) | Renew userDataStream listenKey |

### Graceful Shutdown

1. Stop accepting new signals
2. Cancel all open orders (configurable via `CANCEL_ON_SHUTDOWN=true`)
3. Send "Agent stopped" Telegram notification
4. Disconnect from exchange
5. Clean up resources

## Configuration Summary

```env
# Exchange
EXCHANGE=mockex                    # mockex | binance_testnet | binance
MOCKEX_URL=http://localhost:3000
BINANCE_API_KEY=
BINANCE_API_SECRET=

# Strategy
STRATEGIES=ema_crossover
SYMBOL=BTCUSDT

# Risk Management
MAX_POSITION_PCT=10
MAX_DAILY_LOSS_PCT=5
MAX_DRAWDOWN_PCT=15
MAX_OPEN_TRADES=3
TRADE_COOLDOWN_SECONDS=300
DEFAULT_STOP_LOSS_PCT=3

# Claude AI
CLAUDE_API_KEY=
CLAUDE_MODEL=haiku
CLAUDE_MIN_INTERVAL_SECONDS=120
CLAUDE_FALLBACK=block

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Autonomy
AUTONOMY_MODE=semi

# Agent
CANCEL_ON_SHUTDOWN=true
LOG_LEVEL=INFO
```

## Dependencies

```
aiohttp>=3.9          # HTTP client for REST API calls
websockets>=12.0      # WebSocket connections
anthropic>=0.40       # Claude API client
python-telegram-bot>=21.0  # Telegram bot
python-dotenv>=1.0    # .env file loading
```

## Scope & Decomposition

This spec covers the full TraderBot agent. Recommended implementation order:

1. **Foundation** — project setup, config, models, exchange interface, mockex adapter
2. **Strategy Framework** — base strategy, registry, EMA crossover, candle aggregation, indicator utils
3. **Risk Manager + Claude Reviewer** — risk checks, Claude integration, signal pipeline
4. **Telegram Integration + Agent Loop** — Telegram bot, commands, approval flow, main loop, lifecycle
5. **Binance Adapter** — HMAC signing, user data stream, testnet adapter

Each phase produces working, testable software. Phase 1-4 work with mockex. Phase 5 adds Binance support.
