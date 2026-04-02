# Spec 5: AI Trading Signals

**Date:** 2026-04-02
**Status:** Approved
**Depends on:** Spec 1 (Foundation), Spec 2 (paper_accounts table), Spec 4 (Indicator algorithms reference)

## Overview

Add a dual-layer signal system: a fast rule-based engine that evaluates indicator conditions every minute, and a Claude API integration that provides deeper market analysis every 10 minutes. Signals are displayed in a dedicated UI panel and stored in the database for accuracy tracking.

## Rule-Based Signal Engine

### Location

Server-side: `services/signals.py`

### Server-Side Indicator Calculations

The signal engine requires indicator values computed server-side in Python. Create `services/indicators.py` with Python implementations of:
- SMA(period) — Simple Moving Average
- EMA(period) — Exponential Moving Average
- RSI(period) — Relative Strength Index
- MACD(fast, slow, signal) — Moving Average Convergence Divergence
- Bollinger Bands(period, stddev) — Standard deviation bands

These are the same algorithms as the frontend `js/indicators.js` but ported to Python. The server maintains a rolling buffer of the last 200 candles (aggregated from the Binance kline stream) to feed these calculations. The frontend and server calculate independently — they don't share indicator state.

### Signal Types

| Signal | Condition | Direction |
|---|---|---|
| RSI Overbought | RSI(14) > 70 | Sell |
| RSI Oversold | RSI(14) < 30 | Buy |
| SMA Golden Cross | SMA(7) crosses above SMA(25) | Buy |
| SMA Death Cross | SMA(7) crosses below SMA(25) | Sell |
| MACD Bullish Cross | MACD crosses above Signal | Buy |
| MACD Bearish Cross | MACD crosses below Signal | Sell |
| Bollinger Upper Touch | Price >= Upper Band with volume > 1.5x avg | Sell |
| Bollinger Lower Touch | Price <= Lower Band with volume > 1.5x avg | Buy |
| Volume Spike | Current volume > 2x 20-period average | Neutral (alert) |

### Signal Properties

Each signal emitted has:
```python
@dataclass
class Signal:
    signal_type: str          # "rsi_oversold", "sma_golden_cross", etc.
    direction: str            # "buy", "sell", "neutral"
    strength: str             # "weak", "moderate", "strong"
    confidence: int           # 0-100
    price_at_signal: float    # BTC price when signal generated
    indicators: dict          # snapshot of indicator values
    reasoning: str            # human-readable explanation
    timestamp: datetime
```

### Strength & Confidence Calculation

**Strength** is based on how many indicators agree:
- 1 indicator: weak
- 2 indicators agreeing: moderate
- 3+ indicators agreeing: strong

**Confidence** is a weighted score:
```
RSI extreme (< 25 or > 75): +30 points
SMA crossover confirmed by 3+ candles: +25 points
MACD histogram growing in signal direction: +20 points
Bollinger band touch with high volume: +20 points
Volume spike: +15 points
Multiple signals aligned: +10 bonus per aligned signal
Cap at 100
```

### Evaluation Loop

- Runs every 60 seconds on the server
- Computes indicators from the latest candle data (kept in memory from Binance stream)
- Compares current values to previous values to detect crossovers
- Emits signals when conditions are met
- Deduplicates: same signal type won't fire again within 5 minutes
- Broadcasts new signals to connected clients via WebSocket

## Claude API Integration

### Trigger

Every 10 minutes, the server calls Claude API with structured market data.

### Data Payload Sent to Claude

```python
analysis_prompt = f"""
You are a cryptocurrency market analyst. Analyze the current BTC/USDT market conditions.

Current Market Data:
- Price: ${current_price:,.2f}
- 24h Change: {change_pct:+.2f}%
- 24h High: ${high:,.2f}
- 24h Low: ${low:,.2f}
- 24h Volume: {volume:,.0f} BTC

Technical Indicators:
- RSI(14): {rsi:.1f}
- SMA(7): ${sma7:,.2f}
- SMA(25): ${sma25:,.2f}
- MACD: {macd:.2f} (Signal: {signal:.2f}, Histogram: {histogram:.2f})
- Bollinger Bands: Upper ${bb_upper:,.2f}, Middle ${bb_middle:,.2f}, Lower ${bb_lower:,.2f}

Recent Price Action (last 10 candles, 1-minute):
{candle_summary}

Active Rule-Based Signals:
{active_signals_summary}

Provide a concise analysis in this exact JSON format:
{{
  "trend": "bullish" | "bearish" | "neutral",
  "analysis": "2-3 sentence market analysis",
  "key_levels": {{
    "support": [price1, price2],
    "resistance": [price1, price2]
  }},
  "risk": "low" | "medium" | "high",
  "suggestion": "Brief actionable suggestion",
  "confidence": 0-100
}}
"""
```

### Claude API Call

```python
import anthropic

client = anthropic.AsyncAnthropic(api_key=config.CLAUDE_API_KEY)

response = await client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=500,
    messages=[{"role": "user", "content": analysis_prompt}]
)
```

- Use `claude-sonnet-4-6` for cost efficiency (called every 10 min)
- Parse JSON response, validate structure
- Cache result until next analysis cycle
- If API call fails, keep previous analysis and log error

### Fallback

If `CLAUDE_API_KEY` is not set:
- Skip Claude analysis entirely
- Rule-based signals still work
- UI shows "AI Analysis unavailable — set CLAUDE_API_KEY" in the panel

## Database Table

```sql
CREATE TABLE mockex.ai_signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    signal_type     VARCHAR(30) NOT NULL,
    source          VARCHAR(10) NOT NULL CHECK (source IN ('rule', 'claude')),
    direction       VARCHAR(7) NOT NULL CHECK (direction IN ('buy', 'sell', 'neutral')),
    strength        VARCHAR(10),
    confidence      INTEGER CHECK (confidence BETWEEN 0 AND 100),
    price_at_signal NUMERIC(18,2) NOT NULL,
    indicators_data JSONB,
    reasoning       TEXT,
    outcome         VARCHAR(10) CHECK (outcome IN ('correct', 'incorrect', 'pending')),
    outcome_price   NUMERIC(18,2),
    outcome_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_account_time ON mockex.ai_signals(account_id, created_at DESC);
CREATE INDEX idx_signals_outcome ON mockex.ai_signals(outcome) WHERE outcome = 'pending';
```

### Signal Outcome Tracking

After a signal is generated, track whether it was correct:
- **Buy signal**: correct if price is higher 15 minutes later
- **Sell signal**: correct if price is lower 15 minutes later
- Background task checks pending signals every minute, resolves those older than 15 minutes
- Outcome stored for accuracy statistics

## WebSocket Messages

```json
// Server → Client
{"type": "signal", "data": {
  "id": "uuid",
  "signal_type": "rsi_oversold",
  "source": "rule",
  "direction": "buy",
  "strength": "moderate",
  "confidence": 65,
  "price": 64800.00,
  "reasoning": "RSI at 28.3 indicates oversold conditions. SMA7 approaching SMA25 from below suggests potential reversal.",
  "timestamp": "2026-04-02T06:30:00Z"
}}

{"type": "ai_analysis", "data": {
  "trend": "bullish",
  "analysis": "BTC showing signs of recovery from oversold conditions...",
  "key_levels": {"support": [64500, 64000], "resistance": [65500, 66000]},
  "risk": "medium",
  "suggestion": "Consider small long position with stop below $64,000",
  "confidence": 72,
  "timestamp": "2026-04-02T06:30:00Z"
}}
```

## Signals UI

### AI Market Analysis Card (Right sidebar)

```
┌─────────────────────────────────┐
│  AI Market Analysis             │
│  Updated 3 min ago              │
├─────────────────────────────────┤
│  Trend: [BULLISH]  Risk: [MED]  │
│                                 │
│  "BTC showing signs of recovery │
│  from oversold conditions.      │
│  RSI bounce from 28 with        │
│  increasing volume suggests     │
│  potential upward move."        │
│                                 │
│  Support: $64,500 / $64,000     │
│  Resistance: $65,500 / $66,000  │
│                                 │
│  Suggestion: Consider small     │
│  long position with stop below  │
│  $64,000                        │
│  Confidence: 72%                │
└─────────────────────────────────┘
```

- Trend badge: green "BULLISH", red "BEARISH", gray "NEUTRAL"
- Risk badge: green "LOW", yellow "MED", red "HIGH"
- Confidence shown as percentage with colored bar

### Active Signals List (Below AI Analysis card)

```
┌─────────────────────────────────┐
│  Active Signals                 │
├─────────────────────────────────┤
│  ▲ BUY  RSI Oversold     65%   │
│    28.3 — oversold bounce  2m   │
│                                 │
│  ▲ BUY  SMA Cross        55%   │
│    SMA7 crossing SMA25    8m    │
│                                 │
│  ⚠ ALERT Volume Spike    40%   │
│    2.3x avg volume       12m    │
└─────────────────────────────────┘
```

- Direction icon: ▲ green (buy), ▼ red (sell), ⚠ yellow (neutral)
- Each signal shows type, confidence bar, age
- Click to expand full reasoning
- Signals fade out after 15 minutes

### Signal History (In Portfolio View)

Added as a new tab in the portfolio view: [Equity] [Trades] [Signals]

Signal accuracy table:
- Columns: Time, Type, Direction, Confidence, Price, Outcome, Outcome Price
- Outcome: green check (correct), red X (incorrect), gray clock (pending)
- Summary stats at top: Total signals, Accuracy %, Avg confidence

## REST API Endpoints

```
GET /api/signals              — Active signals (last 30 minutes)
GET /api/signals/history      — Signal history with outcomes
GET /api/analysis             — Latest Claude analysis (cached)
```

## Success Criteria

1. Rule-based signals fire correctly when indicator conditions are met
2. Signals don't fire duplicates within 5-minute window
3. Claude analysis updates every 10 minutes with structured response
4. Graceful fallback when CLAUDE_API_KEY is not set
5. Signal outcomes tracked and accuracy calculated correctly
6. AI Analysis card displays correctly with trend/risk badges
7. Active signals list updates in real-time via WebSocket
8. Signal history shows correct accuracy statistics
9. No excessive API costs (Claude called max 6x per hour)
