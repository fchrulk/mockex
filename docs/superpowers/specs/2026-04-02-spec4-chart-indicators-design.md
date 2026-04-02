# Spec 4: Chart & Indicator Upgrades

**Date:** 2026-04-02
**Status:** Approved
**Depends on:** Spec 1 (Foundation & Refactoring)

## Overview

Upgrade the candlestick chart with zoom/pan interactions, multiple timeframe support, and three new technical indicators: MACD, Bollinger Bands, and Volume Profile. Add an indicator toggle panel for user customization.

## Chart Interactions

### Zoom

- **Mouse wheel**: scroll up to zoom in (fewer candles visible), scroll down to zoom out
- **Visible range**: minimum 20 candles, maximum 200 candles
- **Zoom center**: zoom is anchored at the mouse cursor position
- **Touch**: pinch-to-zoom on touch devices

### Pan

- **Click and drag**: hold left mouse button and drag left/right to pan through candle history
- **Boundaries**: can pan back to oldest available candle, can pan forward to latest
- **Auto-scroll**: when panned to the rightmost position (latest), new candles automatically scroll in. If user has panned back, auto-scroll pauses until they return to the right edge.

### Reset

- **Double-click**: resets to default view (latest 100 candles, auto-scroll on)

### Implementation

Track viewport state in chart.js:
```javascript
const viewport = {
  startIndex: 0,       // first visible candle index
  visibleCount: 100,   // number of candles to display
  isDragging: false,
  dragStartX: 0,
  autoScroll: true     // auto-advance when new candles arrive
};
```

## Timeframe Switching

### Supported Timeframes

| Button | Binance Interval | Candle Count |
|---|---|---|
| 1m | 1m | 100 |
| 5m | 5m | 100 |
| 15m | 15m | 100 |
| 1h | 1h | 100 |
| 4h | 4h | 100 |
| 1d | 1d | 100 |

### UI

Button row above the chart:
```
[1m] [5m] [15m] [1h] [4h] [1d]
```
Active timeframe highlighted with accent color.

### Data Flow

1. User clicks timeframe button
2. Frontend calls `GET /api/candles?interval=5m` (or whichever)
3. Server fetches from Binance REST: `GET /api/v3/klines?symbol=BTCUSDT&interval=5m&limit=100`
4. Server returns candles, frontend replaces candle array and redraws
5. Real-time aggregation continues: 1s klines are aggregated into the active timeframe's current candle

### Server Changes

Update `/api/candles` to accept an `interval` query parameter:
```
GET /api/candles?interval=5m
```

Each interval's response is cached independently (30-second TTL per interval).

### Real-Time Aggregation

The `onKline()` handler in the frontend must adapt to the active timeframe:
- For 1m: round to 60000ms boundaries (existing behavior)
- For 5m: round to 300000ms boundaries
- For 15m: round to 900000ms boundaries
- For 1h: round to 3600000ms boundaries
- For 4h: round to 14400000ms boundaries
- For 1d: round to 86400000ms boundaries

Generic formula: `Math.floor(timestamp / intervalMs) * intervalMs`

The Binance WebSocket subscription stays on `btcusdt@kline_1s` regardless of active timeframe. The 1s klines are aggregated client-side into whichever timeframe is active. This avoids reconnecting the upstream WebSocket on every timeframe switch. For longer timeframes (1h, 4h, 1d), only the current open candle is aggregated from 1s data — historical candles come from the REST API fetch.

### Indicator Warmup

When fetching candles from Binance REST, request 130 candles (not 100) to provide sufficient lookback for indicators:
- SMA(25) needs 25 candles of warmup
- Bollinger(20) needs 20 candles
- MACD needs 26 candles (slow EMA period)
- Fetch 130, display last 100, use first 30 for indicator calculation warmup

## New Indicators

### MACD (Moving Average Convergence Divergence)

**Calculation (in indicators.js):**
```
MACD Line = EMA(12) - EMA(26)
Signal Line = EMA(9) of MACD Line
Histogram = MACD Line - Signal Line
```

Where EMA is Exponential Moving Average:
```
EMA_today = (price × k) + (EMA_yesterday × (1 - k))
k = 2 / (period + 1)
```

**Rendering (separate sub-chart, 80px height, below RSI):**
- MACD line: blue (#2196f3)
- Signal line: orange (#ff9800)
- Histogram: green bars above zero, red bars below zero
- Zero line: gray dashed
- Y-axis labels on right

### Bollinger Bands

**Calculation (in indicators.js):**
```
Middle Band = SMA(20)
Upper Band = Middle Band + (2 × StdDev(20))
Lower Band = Middle Band - (2 × StdDev(20))
```

**Rendering (overlay on main candlestick chart):**
- Middle band: gray dashed line
- Upper band: solid gray line
- Lower band: solid gray line
- Fill between bands: semi-transparent white (rgba(255,255,255,0.03))
- When price touches upper band: subtle red highlight
- When price touches lower band: subtle green highlight

### Volume Profile (Simplified)

**Calculation:**
- Divide visible price range into 20 equal buckets
- Sum volume at each price level from visible candles
- Normalize to percentage of max bucket

**Rendering (overlay on right side of main chart):**
- Horizontal bars extending leftward from the right Y-axis area
- Bar width proportional to volume at that price level
- Color: semi-transparent cyan for high-volume nodes, gray for normal
- Max width: 15% of chart width
- Point of Control (POC): highest volume price level, highlighted

## Indicator Toggle Panel

### UI

Horizontal bar above the chart, below the timeframe buttons:

```
┌─────────────────────────────────────────────────────────┐
│ Indicators: [✓ SMA 7] [✓ SMA 25] [  Bollinger]        │
│             [✓ RSI]   [  MACD]    [  Vol Profile]      │
└─────────────────────────────────────────────────────────┘
```

- Each indicator is a checkbox-style toggle button
- Active indicators: accent border + filled background
- Inactive: dim border, no fill
- SMA 7, SMA 25, RSI enabled by default
- Bollinger, MACD, Volume Profile disabled by default

### Settings (Gear Icon)

Click gear icon next to any indicator to customize parameters:
- SMA: period (default 7 or 25)
- RSI: period (default 14)
- MACD: fast (12), slow (26), signal (9)
- Bollinger: period (20), std dev multiplier (2)

Settings shown as a small popup/dropdown. Changes apply immediately.

### Persistence

Indicator toggle state and custom parameters saved to `localStorage`:
```json
{
  "indicators": {
    "sma7": {"enabled": true, "period": 7},
    "sma25": {"enabled": true, "period": 25},
    "rsi": {"enabled": true, "period": 14},
    "macd": {"enabled": false, "fast": 12, "slow": 26, "signal": 9},
    "bollinger": {"enabled": false, "period": 20, "stddev": 2},
    "volumeProfile": {"enabled": false}
  }
}
```

Restored on page load.

## Chart Layout Adjustments

With multiple sub-charts, the layout becomes dynamic:

```
┌─────────────────────────────────────┐
│  Timeframe buttons                  │
│  Indicator toggles                  │
├─────────────────────────────────────┤
│                                     │
│  Main Chart (candlesticks +         │  Dynamic height:
│  SMA + Bollinger + Vol Profile)     │  fills remaining space
│                                     │
├─────────────────────────────────────┤
│  RSI (if enabled)         80px      │
├─────────────────────────────────────┤
│  MACD (if enabled)        80px      │
└─────────────────────────────────────┘
```

- Main chart height adjusts based on which sub-charts are enabled
- If both RSI and MACD disabled, main chart gets full height
- Sub-charts share the same X-axis alignment as the main chart

## Success Criteria

1. Mouse wheel zoom smoothly adjusts visible candle count (20-200 range)
2. Click-drag panning works, auto-scroll resumes at right edge
3. All 6 timeframes load correct candles and aggregate real-time data correctly
4. MACD sub-chart renders correctly with histogram
5. Bollinger Bands overlay on main chart with proper fill
6. Volume Profile shows horizontal bars aligned to price levels
7. Indicator toggles show/hide indicators without page reload
8. Custom indicator parameters apply immediately
9. Indicator state persists across page refreshes via localStorage
10. Chart layout dynamically adjusts when sub-charts are toggled
