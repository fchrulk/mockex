# Spec 2: Trading Engine

**Date:** 2026-04-02
**Status:** Approved
**Depends on:** Spec 1 (Foundation & Refactoring)

## Overview

Add a paper trading engine to mockex: virtual wallet with simulated USDT balance, market/limit/stop order placement, realistic order matching against live Binance data, position tracking with live unrealized PnL, and a tabbed panel showing positions, open orders, and trade history.

## Virtual Wallet & Account

### Account Model

- Single paper trading account per instance
- Configurable starting balance (default: $100,000 USDT)
- Tracks three balances:
  - **Cash balance**: available USDT for new orders
  - **Reserved balance**: USDT locked in open limit/stop orders
  - **Total equity**: cash + reserved + (position_qty x current_price) — the full asset value of the account
- Reset feature: wipes all orders, trades, positions; restores initial balance
- Account created automatically on first server start if none exists

### Database Table

```sql
CREATE TABLE mockex.paper_accounts (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL DEFAULT 'Default',
    initial_balance NUMERIC(19,2) NOT NULL DEFAULT 100000.00,
    cash_balance    NUMERIC(19,2) NOT NULL DEFAULT 100000.00,
    reserved_balance NUMERIC(19,2) NOT NULL DEFAULT 0.00,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    reset_at        TIMESTAMPTZ
);
```

### Frontend: Wallet Bar

Horizontal bar above the chart area:
- Available: $XX,XXX.XX (green)
- Reserved: $X,XXX.XX (yellow)
- Equity: $XX,XXX.XX (white, bold)
- Reset button (with confirmation dialog)

## Order Types

### Market Order

- Fills immediately at best available price
- Walks the real order book (depth10 data) for realistic slippage
- If order size exceeds visible book depth, fills remainder at worst visible price + estimated slippage
- Fee: 0.1% of fill value (configurable via TRADING_FEE_RATE)

### Limit Order

- Placed at a specific price, persists as "open" until filled or cancelled
- **Buy limit**: fills when the best ask price drops to or below limit price
- **Sell limit**: fills when the best bid price rises to or above limit price
- Checked on every incoming trade tick from the Binance WebSocket stream
- Reserved balance locked on placement, released on fill or cancel
- Fee charged on fill

### Stop Order

- Has a stop (trigger) price; when triggered, becomes a market order
- **Sell stop (stop-loss)**: triggers when bid price falls to or below stop price
- **Buy stop**: triggers when ask price rises to or above stop price
- After trigger, executes as market order with slippage simulation
- Reserved balance locked on placement

### Order Validation

Before accepting any order:
1. Quantity > 0
2. Sufficient cash balance (for buys) or sufficient position (for sells)
3. Price > 0 (for limit/stop orders)
4. Self-crossing check: if a buy limit price >= current ask, or sell limit price <= current bid, fill immediately as a market order at placement time (not queued as open)

## Order Matching Engine

### Location

Server-side: `services/matching.py`

### Architecture

```
Binance trade tick AND depth10 update arrive
  ↓
matching_engine.on_tick(trade_price, best_bid, best_ask, timestamp)
  (best_bid/best_ask sourced from latest depth10 data)
  ↓
Check all open limit orders:
  - Buy limits: fill if best_ask <= limit_price
  - Sell limits: fill if best_bid >= limit_price
  ↓
Check all open stop orders:
  - Sell stops: trigger if best_bid <= stop_price → execute as market
  - Buy stops: trigger if best_ask >= stop_price → execute as market
  ↓
On fill:
  - Update order status → "filled"
  - Create trade record
  - Update position (create/modify/close)
  - Update account balance
  - Broadcast updates via WebSocket
```

### Market Order Fill Simulation

Walk the order book depth:
```python
def simulate_market_fill(side, quantity, order_book):
    """Walk the order book to calculate realistic fill price."""
    remaining = quantity
    total_cost = 0
    levels = order_book['asks'] if side == 'buy' else order_book['bids']
    
    for price, available_qty in levels:
        fill_qty = min(remaining, available_qty)
        total_cost += fill_qty * price
        remaining -= fill_qty
        if remaining <= 0:
            break
    
    # If remaining > 0, fill at worst level + 0.1% slippage estimate
    if remaining > 0:
        worst_price = levels[-1][0]
        slippage = worst_price * 0.001
        total_cost += remaining * (worst_price + slippage)
    
    avg_price = total_cost / quantity
    return avg_price
```

### Open Order Storage

- Open orders kept in memory (Python list) for fast tick-by-tick checking
- Also persisted to DB for recovery on server restart
- On startup: load all "open" orders from DB into memory

### WebSocket Messages

```json
// Client → Server
{"type": "place_order", "data": {
  "side": "buy",
  "order_type": "limit",
  "quantity": 0.01,
  "price": 65000.00
}}

{"type": "cancel_order", "data": {"order_id": "uuid-here"}}

// Server → Client
{"type": "order_update", "data": {
  "id": "uuid", "status": "open", "side": "buy",
  "order_type": "limit", "quantity": 0.01, "price": 65000.00
}}

{"type": "trade_executed", "data": {
  "order_id": "uuid", "side": "buy", "quantity": 0.01,
  "price": 65012.50, "fee": 6.50, "timestamp": "..."
}}

{"type": "balance_update", "data": {
  "cash": 99343.50, "reserved": 0.00, "equity": 99993.50
}}

{"type": "position_update", "data": {
  "symbol": "BTCUSDT", "side": "long", "quantity": 0.01,
  "entry_price": 65012.50, "unrealized_pnl": -6.50
}}
```

## Database Tables

```sql
CREATE TABLE mockex.paper_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    symbol          VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    side            VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    order_type      VARCHAR(10) NOT NULL CHECK (order_type IN ('market', 'limit', 'stop')),
    quantity        NUMERIC(18,8) NOT NULL,
    price           NUMERIC(18,2),
    stop_price      NUMERIC(18,2),
    status          VARCHAR(10) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'open', 'filled', 'cancelled')),
    filled_qty      NUMERIC(18,8) NOT NULL DEFAULT 0,
    avg_fill_price  NUMERIC(18,2),
    fee             NUMERIC(18,8) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE mockex.paper_trades (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    order_id        UUID NOT NULL REFERENCES mockex.paper_orders(id),
    symbol          VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    side            VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    quantity        NUMERIC(18,8) NOT NULL,
    price           NUMERIC(18,2) NOT NULL,
    fee             NUMERIC(18,8) NOT NULL,
    realized_pnl    NUMERIC(18,2),
    executed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE mockex.paper_positions (
    id              SERIAL PRIMARY KEY,
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    symbol          VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    side            VARCHAR(5) NOT NULL CHECK (side IN ('long')),
    quantity        NUMERIC(18,8) NOT NULL,
    entry_price     NUMERIC(18,2) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, symbol)
);

CREATE INDEX idx_orders_account_status ON mockex.paper_orders(account_id, status);
CREATE INDEX idx_trades_account ON mockex.paper_trades(account_id, executed_at DESC);
```

## Position Management

### Rules

- One position per symbol per account (BTC/USDT only)
- Long positions only — no short selling (spot trading simulation, not futures)
- Buying BTC creates or adds to a "long" position
- Selling BTC reduces or closes the position
- Cannot sell more BTC than currently held in position
- Entry price = volume-weighted average of all buy fills
- Partial close: reduces quantity, records realized PnL for the closed portion
- Full close: records realized PnL, deletes position row
- Unrealized PnL = (current_price - entry_price) x quantity — updated every tick via WebSocket broadcast

### PnL Calculation

```
Realized PnL (on sell):
  (sell_price - entry_price) × sell_quantity - sell_fee

Unrealized PnL (live):
  (current_price - entry_price) × remaining_quantity
```

## Order Entry Panel UI

Located below the chart, full width.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Market] [Limit] [Stop]                                │
├──────────────────────┬──────────────────────────────────┤
│  Quantity: [____] BTC│  [25%] [50%] [75%] [100%]       │
│  Price:   [____] USD │  (shown for limit/stop only)     │
│  Stop:    [____] USD │  (shown for stop only)           │
├──────────────────────┴──────────────────────────────────┤
│  Est. Cost: $XXX.XX  |  Fee: $X.XX  |  Total: $XXX.XX  │
├─────────────────────────────────────────────────────────┤
│  [████ BUY ████]  [████ SELL ████]                       │
└─────────────────────────────────────────────────────────┘
```

- Quick quantity buttons calculate % of available balance (for buys) or position size (for sells)
- Estimated cost updates live as user types
- Buy button: green (#00e87b), Sell button: red (#ff2952)
- Confirmation: order summary tooltip before execution

### Tabbed Panel Below Order Entry

```
┌─────────────────────────────────────────────────────────┐
│  [Open Positions] [Open Orders] [Trade History]         │
├─────────────────────────────────────────────────────────┤
│  Symbol | Side | Qty | Entry | Current | PnL | [Close] │
│  BTCUSDT  LONG  0.01  65012   65150    +$1.38  [X]     │
└─────────────────────────────────────────────────────────┘
```

- **Open Positions**: live PnL updates, close button
- **Open Orders**: order details, cancel button
- **Trade History**: executed trades, scrollable, newest first

## REST API Endpoints

```
POST   /api/orders           — Place new order
DELETE /api/orders/:id        — Cancel order
GET    /api/orders            — List orders (filter by status)
GET    /api/positions         — Get current positions
GET    /api/trades            — Get trade history (all executed trades)
GET    /api/account           — Get account info (balances)
POST   /api/account/reset     — Reset account to initial state
```

**Canonical order path:** Both REST (`POST /api/orders`) and WebSocket (`place_order` message) go through the same `services/matching.py` validation and execution logic. REST is used for initial page load state; WebSocket is used for real-time order placement from the UI. The matching engine is the single source of truth.

## Success Criteria

1. Can place market buy order and see position appear with live PnL
2. Can place limit order that fills when price crosses the limit
3. Can place stop order that triggers on price movement
4. Can cancel open orders and see reserved balance released
5. Order book walking produces realistic slippage on market orders
6. Position entry price correctly averages on multiple buys
7. Closing a position records correct realized PnL
8. Account reset clears all data and restores initial balance
9. All state survives server restart (loaded from DB)
