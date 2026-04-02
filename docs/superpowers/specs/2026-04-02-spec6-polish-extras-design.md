# Spec 6: Polish & Extras

**Date:** 2026-04-02
**Status:** Approved
**Depends on:** Specs 1-5

## Overview

Final polish pass: price alerts with browser notifications, data export, error handling improvements, testing, and keyboard shortcuts. This spec hardens the application and adds quality-of-life features.

## Price Alerts

### Alert Types

| Alert | Condition | Example |
|---|---|---|
| Price Above | BTC price > threshold | "Alert when BTC > $70,000" |
| Price Below | BTC price < threshold | "Alert when BTC < $60,000" |
| RSI Above | RSI crosses above threshold | "Alert when RSI > 70" |
| RSI Below | RSI crosses below threshold | "Alert when RSI < 30" |

### Alert Lifecycle

1. User creates alert via UI
2. Stored in DB and loaded into server memory
3. Checked on every relevant tick (price alerts on trade ticks, RSI alerts on candle close)
4. When triggered: send WebSocket notification to client, browser Notification API fires
5. Alert marked as "triggered" — one-shot, doesn't repeat
6. User can delete or recreate alerts

### Database Table

```sql
CREATE TABLE mockex.price_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    alert_type      VARCHAR(20) NOT NULL CHECK (alert_type IN ('price_above', 'price_below', 'rsi_above', 'rsi_below')),
    threshold       NUMERIC(18,2) NOT NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'deleted')),
    triggered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### Alert UI

Small "Alerts" panel or button that opens a dropdown:
```
┌─────────────────────────────────┐
│  Price Alerts            [+ Add]│
├─────────────────────────────────┤
│  BTC > $70,000     Active   [X] │
│  RSI < 30          Active   [X] │
│  BTC < $60,000     Triggered ✓  │
└─────────────────────────────────┘
```

Add alert form:
- Dropdown: Price Above | Price Below | RSI Above | RSI Below
- Threshold input
- Create button

### Browser Notifications

```javascript
// Request permission on first alert creation
if (Notification.permission === 'default') {
    await Notification.requestPermission();
}

// On trigger
new Notification('Mockex Alert', {
    body: 'BTC price crossed above $70,000!',
    icon: '/favicon.ico'
});
```

Also play a subtle notification sound (optional, can be muted).

## Data Export

### Export Options

1. **Trade History CSV**: all closed trades with columns Date, Side, Entry, Exit, Qty, Fee, PnL, Duration
2. **Equity Curve CSV**: snapshot data with columns Timestamp, Equity, Cash, Unrealized PnL, BTC Price
3. **Chart Screenshot PNG**: current chart canvas exported as image

### Implementation

Trade/Equity CSV:
```javascript
function exportCSV(data, headers, filename) {
    const csv = [headers.join(','), ...data.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    // trigger download via hidden <a> element
}
```

Chart Screenshot:
```javascript
function exportChart() {
    const dataUrl = chartCanvas.toDataURL('image/png');
    // trigger download
}
```

### UI

Export buttons in relevant locations:
- Trade History tab: "Export CSV" button
- Portfolio view: "Export Equity Data" button
- Chart area: camera icon button for screenshot

## Error Handling & Resilience

### WebSocket Reconnect (Exponential Backoff)

Replace fixed 3-second retry:
```javascript
let reconnectDelay = 3000;   // start at 3s
const MAX_DELAY = 60000;     // cap at 60s
const BACKOFF_FACTOR = 2;

function reconnect() {
    setTimeout(() => {
        connect();
        reconnectDelay = Math.min(reconnectDelay * BACKOFF_FACTOR, MAX_DELAY);
    }, reconnectDelay);
}

function onConnected() {
    reconnectDelay = 3000;  // reset on successful connection
}
```

### Data Gap Detection

- Track last received candle timestamp
- If gap > 2x expected interval, show warning banner: "Data gap detected — some candles may be missing"
- On reconnect, re-fetch candles from REST API to fill gaps

### Graceful Degradation

- If DB is down on startup: log error, disable trading features, still serve live dashboard
- If Binance WebSocket drops: show "Disconnected" status, attempt reconnect, freeze chart (don't show stale data as live)
- If Claude API fails: show "AI Analysis unavailable" with last known analysis timestamp

### Input Validation

All order parameters validated server-side:
- Quantity: > 0, reasonable precision (max 8 decimals)
- Price: > 0, reasonable range (within 50% of current market price)
- Balance check: sufficient funds for order + estimated fee
- Return clear error messages via WebSocket: `{"type": "error", "message": "Insufficient balance"}`

## Testing

### Python Unit Tests

Location: `tests/` directory

```
tests/
  test_indicators.py      — SMA, RSI, MACD, Bollinger calculations
  test_matching.py         — Order matching logic, slippage simulation
  test_positions.py        — Position create/update/close, PnL calculation
  test_signals.py          — Rule-based signal conditions
  test_portfolio.py        — Metric calculations (Sharpe, drawdown, etc.)
```

Test framework: `pytest` with `pytest-asyncio` for async tests

Key test cases:
- SMA/RSI/MACD produce correct values against known datasets
- Market order walks order book correctly
- Limit order fills at correct price when condition met
- Position entry price averages correctly on multiple buys
- Realized PnL calculated correctly on partial and full close
- Signals fire and don't duplicate within cooldown
- Portfolio metrics match manual calculation

### Integration Tests

```
tests/
  test_websocket.py        — WebSocket message flow (connect, receive, send order)
  test_db.py               — DB operations (create account, place order, query trades)
  test_api.py              — REST endpoint responses
```

### Frontend Testing

Manual test checklist (not automated — keeping scope reasonable):
- [ ] Dashboard loads with live data
- [ ] All timeframes load and aggregate correctly
- [ ] Order entry: market, limit, stop orders place successfully
- [ ] Position appears with live PnL after market buy
- [ ] Limit order fills when price crosses
- [ ] Cancel order works, balance released
- [ ] Portfolio view displays all metrics and charts
- [ ] Indicator toggles show/hide correctly
- [ ] AI signals panel updates
- [ ] Alerts trigger browser notification
- [ ] Export CSV downloads correctly
- [ ] Chart screenshot works
- [ ] Keyboard shortcuts function
- [ ] WebSocket reconnect works after disconnect

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `B` | Focus buy button / open buy order |
| `S` | Focus sell button / open sell order |
| `Escape` | Cancel current order entry / close modal |
| `1` | Switch to 1m timeframe |
| `2` | Switch to 5m timeframe |
| `3` | Switch to 15m timeframe |
| `4` | Switch to 1h timeframe |
| `5` | Switch to 4h timeframe |
| `6` | Switch to 1d timeframe |
| `P` | Toggle portfolio view |
| `Enter` | Confirm order (when order form is focused) |

### Implementation

```javascript
document.addEventListener('keydown', (e) => {
    // Don't trigger when typing in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch(e.key.toLowerCase()) {
        case 'b': focusBuyOrder(); break;
        case 's': focusSellOrder(); break;
        case 'escape': cancelCurrentAction(); break;
        case 'p': togglePortfolioView(); break;
        case '1': case '2': case '3': case '4': case '5': case '6':
            switchTimeframe(parseInt(e.key) - 1); break;
    }
});
```

Keyboard shortcut hint shown on hover over relevant buttons (e.g., Buy button tooltip: "Buy (B)").

## REST API Endpoints

```
POST   /api/alerts            — Create alert
GET    /api/alerts             — List alerts
DELETE /api/alerts/:id         — Delete alert
GET    /api/export/trades      — Export trades as CSV
GET    /api/export/equity      — Export equity snapshots as CSV
```

## Success Criteria

1. Price alerts trigger browser notifications at correct thresholds
2. RSI alerts trigger on indicator threshold crossing
3. Trade history exports as valid, complete CSV
4. Equity data exports as valid CSV
5. Chart screenshot saves as PNG
6. WebSocket reconnects with exponential backoff (3s → 6s → 12s → ... → 60s max)
7. Data gap detection warns user when candles are missing
8. All Python unit tests pass
9. Integration tests pass against test database
10. All keyboard shortcuts work (not triggered when typing in inputs)
11. Error messages display clearly for invalid orders
