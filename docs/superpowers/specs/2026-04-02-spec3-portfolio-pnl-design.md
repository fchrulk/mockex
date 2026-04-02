# Spec 3: Portfolio & PnL Dashboard

**Date:** 2026-04-02
**Status:** Approved
**Depends on:** Spec 2 (Trading Engine)

## Overview

Add a portfolio dashboard view to mockex with comprehensive performance metrics, an equity curve chart, PnL-by-trade visualization, and a detailed trade log. Portfolio snapshots taken every 5 minutes provide the data for historical performance analysis.

## Portfolio Metrics

### Core Metrics

| Metric | Formula | Update Frequency |
|---|---|---|
| Total Equity | cash_balance + reserved + (position_qty x current_price) | Every tick |
| Total PnL | total_equity - initial_balance | Every tick |
| ROI % | (total_pnl / initial_balance) x 100 | Every tick |
| Realized PnL | Sum of all paper_trades.realized_pnl | On trade close |
| Unrealized PnL | (current_price - entry_price) x position_qty | Every tick |
| Win Rate | winning_trades / total_closed_trades x 100 | On trade close |
| Profit Factor | gross_profit / gross_loss | On trade close |
| Max Drawdown | Largest peak-to-trough % decline in equity | Every snapshot |
| Sharpe Ratio | (avg_daily_return - 0) / stddev_daily_returns x sqrt(365) | Daily recalc; daily return = last snapshot of day N equity / last snapshot of day N-1 equity - 1 |
| Avg Win / Avg Loss | mean(winning_pnl) / abs(mean(losing_pnl)) | On trade close |

### Snapshot System

Server takes a portfolio snapshot every 5 minutes via an `asyncio.create_task` loop started on app startup:
- Records total equity, cash balance, unrealized PnL, realized PnL, BTC price
- Used for equity curve rendering and drawdown calculation
- Snapshots are lightweight — one row per 5 minutes
- Always snapshots while server is running (even with no open position — tracks cash-only equity)
- On server restart, snapshot loop resumes; gap in data is expected and handled gracefully by the equity curve chart

### Database Table

```sql
CREATE TABLE mockex.portfolio_snapshots (
    id              SERIAL PRIMARY KEY,
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    total_equity    NUMERIC(19,2) NOT NULL,
    cash_balance    NUMERIC(19,2) NOT NULL,
    unrealized_pnl  NUMERIC(19,2) NOT NULL DEFAULT 0,
    realized_pnl    NUMERIC(19,2) NOT NULL DEFAULT 0,
    btc_price       NUMERIC(18,2) NOT NULL,
    snapshot_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_snapshots_account_time 
    ON mockex.portfolio_snapshots(account_id, snapshot_at);
```

## Portfolio UI

Accessible via a "Portfolio" button in the header. Toggles between trading view and portfolio view (no page navigation — SPA state switch).

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Trading]  [Portfolio]                    BTC: $XX,XXX.XX  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Equity   │ │ Total PnL│ │ Win Rate │ │ Sharpe   │      │
│  │$102,340  │ │+$2,340   │ │  62.5%   │ │  1.84    │      │
│  │          │ │ +2.34%   │ │ 10/16    │ │          │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  ┌──────────┐ ┌──────────┐                                 │
│  │Max Drawdn│ │Profit Fac│                                 │
│  │  -3.2%   │ │  2.15    │                                 │
│  └──────────┘ └──────────┘                                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  EQUITY CURVE                                       │   │
│  │  ~~~~~~~~~/\~~~~/\~~~~~/\~~~~~~~                    │   │
│  │  -------- buy & hold benchmark --------             │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  PnL BY TRADE                                       │   │
│  │  ▓▓  ▓▓     ▓▓ ▓▓     ▓▓                          │   │
│  │      ██ ██         ██                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  TRADE LOG                                          │   │
│  │  Date | Side | Entry | Exit | Qty | Fee | PnL | Dur │   │
│  │  ...scrollable table...                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Summary Cards

Top row of metric cards:
- **Total Equity**: large white number, dollar formatted
- **Total PnL**: green if positive, red if negative; shows both $ and %
- **Win Rate**: percentage with W/L count below
- **Sharpe Ratio**: number, green if > 1, yellow if 0.5-1, red if < 0.5
- **Max Drawdown**: always red/negative percentage
- **Profit Factor**: number, green if > 1.5

### Equity Curve Chart

Canvas-rendered line chart:
- X-axis: time (from first snapshot to now)
- Y-axis: portfolio value in USD
- **Portfolio line**: cyan (#00d4ff), filled area below with gradient
- **Benchmark line**: gray dashed — buy-and-hold BTC from same start date and initial balance
- **Breakeven line**: horizontal dashed line at initial_balance
- Hover tooltip: date, equity value, benchmark value, difference
- Time range buttons: 1D | 1W | 1M | ALL

### PnL by Trade Chart

Canvas-rendered bar chart:
- Each bar = one closed trade's realized PnL
- Green bars above zero line = winning trades
- Red bars below zero line = losing trades
- Hover: trade details (date, entry, exit, PnL)

### Trade Log Table

Full trade history:
- Columns: Date, Side, Entry Price, Exit Price, Quantity, Fee, PnL, Duration
- Sortable by any column (click header)
- Newest first by default
- Color-coded PnL column (green/red)
- Scrollable with fixed header

## REST API Endpoints

```
GET /api/portfolio              — Current portfolio metrics
GET /api/portfolio/snapshots    — Equity curve data (query: from, to)
GET /api/portfolio/trades       — Closed trades with PnL, entry/exit prices, duration (enriched view of Spec 2's /api/trades, grouped by position close events)
```

### Response Examples

```json
// GET /api/portfolio
{
  "total_equity": 102340.50,
  "cash_balance": 95840.50,
  "unrealized_pnl": 1500.00,
  "realized_pnl": 840.50,
  "total_pnl": 2340.50,
  "roi_pct": 2.34,
  "win_rate": 62.5,
  "profit_factor": 2.15,
  "max_drawdown_pct": -3.2,
  "sharpe_ratio": 1.84,
  "avg_win": 450.00,
  "avg_loss": -210.00,
  "total_trades": 16,
  "winning_trades": 10,
  "losing_trades": 6
}

// GET /api/portfolio/snapshots?from=2026-04-01&to=2026-04-02
{
  "snapshots": [
    {"timestamp": "...", "equity": 100000, "btc_price": 65000},
    {"timestamp": "...", "equity": 100150, "btc_price": 65100},
    ...
  ],
  "benchmark": [
    {"timestamp": "...", "value": 100000},
    {"timestamp": "...", "value": 100153.85},
    ...
  ]
}
```

## Benchmark Calculation

Buy-and-hold benchmark: what the portfolio would be worth if the entire initial balance was used to buy BTC at the first snapshot's price.

```
benchmark_btc_qty = initial_balance / first_snapshot_btc_price
benchmark_value_at_time_t = benchmark_btc_qty × btc_price_at_time_t
```

## Success Criteria

1. Portfolio view toggles cleanly from trading view
2. All 6 metric cards display correct, live-updating values
3. Equity curve renders from snapshot data with benchmark comparison
4. PnL by trade chart shows correct green/red bars for each closed trade
5. Trade log is scrollable, sortable, and shows all historical trades
6. Snapshot system reliably records every 5 minutes
7. Max drawdown and Sharpe ratio calculate correctly from snapshot history
8. Portfolio state is correct after server restart (loaded from DB)
