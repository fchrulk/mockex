"""AI Trading Signals: rule-based engine + Claude API analysis."""

import asyncio
import json
import logging
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta

from aiohttp import web

from services import config, db
from services.indicators import calc_sma, calc_ema, calc_rsi, calc_macd, calc_bollinger

log = logging.getLogger("mockex.signals")

EVAL_INTERVAL = 60  # rule-based: every 60 seconds
CLAUDE_INTERVAL = 600  # Claude analysis: every 10 minutes
DEDUP_WINDOW = 300  # 5-minute dedup window
OUTCOME_DELAY = 900  # 15 minutes for outcome check


@dataclass
class Signal:
    id: str
    signal_type: str
    source: str  # "rule" or "claude"
    direction: str  # "buy", "sell", "neutral"
    strength: str  # "weak", "moderate", "strong"
    confidence: int
    price_at_signal: float
    indicators: dict
    reasoning: str
    timestamp: datetime

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "signal_type": self.signal_type,
            "source": self.source,
            "direction": self.direction,
            "strength": self.strength,
            "confidence": self.confidence,
            "price": self.price_at_signal,
            "reasoning": self.reasoning,
            "indicators": self.indicators,
            "timestamp": self.timestamp.isoformat(),
        }


class SignalEngine:
    """Dual-layer signal system: rule-based + Claude API."""

    def __init__(self, matching_engine):
        self._engine = matching_engine
        self._candle_buffer: deque = deque(maxlen=200)
        self._active_signals: list[Signal] = []
        self._recent_types: dict[str, datetime] = {}  # dedup: type -> last emit time
        self._claude_analysis: dict | None = None
        self._claude_analysis_ts: datetime | None = None
        self.browser_clients: set[web.WebSocketResponse] = set()
        self._eval_task: asyncio.Task | None = None
        self._claude_task: asyncio.Task | None = None
        self._outcome_task: asyncio.Task | None = None
        self._prev_indicators: dict = {}

    async def start(self):
        """Start signal evaluation loops."""
        self._eval_task = asyncio.create_task(self._eval_loop())
        self._outcome_task = asyncio.create_task(self._outcome_loop())
        if config.CLAUDE_API_KEY:
            self._claude_task = asyncio.create_task(self._claude_loop())
            log.info("Signal engine started (rule-based + Claude)")
        else:
            log.info("Signal engine started (rule-based only, no CLAUDE_API_KEY)")

    async def stop(self):
        """Stop all loops."""
        for task in [self._eval_task, self._claude_task, self._outcome_task]:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    def on_candle(self, candle: dict):
        """Feed a 1-minute candle into the buffer."""
        self._candle_buffer.append(candle)

    def get_active_signals(self) -> list[dict]:
        """Return signals from last 30 minutes."""
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
        return [s.to_dict() for s in self._active_signals if s.timestamp > cutoff]

    def get_claude_analysis(self) -> dict | None:
        """Return latest Claude analysis."""
        if self._claude_analysis:
            return {
                **self._claude_analysis,
                "timestamp": self._claude_analysis_ts.isoformat() if self._claude_analysis_ts else None,
            }
        return None

    # ── Rule-based evaluation ──

    async def _eval_loop(self):
        while True:
            await asyncio.sleep(EVAL_INTERVAL)
            try:
                await self._evaluate_rules()
            except Exception as e:
                log.warning("Signal eval error: %s", e)

    async def _evaluate_rules(self):
        if len(self._candle_buffer) < 30:
            return

        candles = list(self._candle_buffer)
        closes = [c["c"] for c in candles]
        volumes = [c["v"] for c in candles]
        current_price = closes[-1]
        now = datetime.now(timezone.utc)

        # Calculate indicators
        rsi_vals = calc_rsi(closes, 14)
        sma7 = calc_sma(closes, 7)
        sma25 = calc_sma(closes, 25)
        macd_line, signal_line, histogram = calc_macd(closes)
        bb_upper, bb_middle, bb_lower = calc_bollinger(closes)

        rsi = rsi_vals[-1]
        prev_rsi = rsi_vals[-2] if len(rsi_vals) > 1 else None

        indicators = {
            "rsi": round(rsi, 1) if rsi else None,
            "sma7": round(sma7[-1], 2) if sma7[-1] else None,
            "sma25": round(sma25[-1], 2) if sma25[-1] else None,
            "macd": round(macd_line[-1], 2) if macd_line[-1] else None,
            "macd_signal": round(signal_line[-1], 2) if signal_line[-1] else None,
            "macd_hist": round(histogram[-1], 2) if histogram[-1] else None,
            "bb_upper": round(bb_upper[-1], 2) if bb_upper[-1] else None,
            "bb_lower": round(bb_lower[-1], 2) if bb_lower[-1] else None,
        }

        signals_this_round = []

        # RSI signals
        if rsi is not None:
            if rsi > 70:
                signals_this_round.append(("rsi_overbought", "sell", f"RSI at {rsi:.1f} — overbought conditions"))
            elif rsi < 30:
                signals_this_round.append(("rsi_oversold", "buy", f"RSI at {rsi:.1f} — oversold conditions"))

        # SMA crossover signals
        prev = self._prev_indicators
        if sma7[-1] and sma25[-1] and sma7[-2] and sma25[-2]:
            if sma7[-2] <= sma25[-2] and sma7[-1] > sma25[-1]:
                signals_this_round.append(("sma_golden_cross", "buy", f"SMA(7) crossed above SMA(25)"))
            elif sma7[-2] >= sma25[-2] and sma7[-1] < sma25[-1]:
                signals_this_round.append(("sma_death_cross", "sell", f"SMA(7) crossed below SMA(25)"))

        # MACD crossover signals
        if macd_line[-1] is not None and signal_line[-1] is not None:
            if len(macd_line) > 1 and macd_line[-2] is not None and signal_line[-2] is not None:
                if macd_line[-2] <= signal_line[-2] and macd_line[-1] > signal_line[-1]:
                    signals_this_round.append(("macd_bullish_cross", "buy", "MACD crossed above Signal line"))
                elif macd_line[-2] >= signal_line[-2] and macd_line[-1] < signal_line[-1]:
                    signals_this_round.append(("macd_bearish_cross", "sell", "MACD crossed below Signal line"))

        # Bollinger Band signals
        avg_vol = sum(volumes[-20:]) / min(len(volumes), 20) if volumes else 0
        curr_vol = volumes[-1] if volumes else 0
        if bb_upper[-1] and bb_lower[-1] and avg_vol > 0:
            if current_price >= bb_upper[-1] and curr_vol > avg_vol * 1.5:
                signals_this_round.append(("bb_upper_touch", "sell", f"Price at upper Bollinger Band with {curr_vol/avg_vol:.1f}x volume"))
            elif current_price <= bb_lower[-1] and curr_vol > avg_vol * 1.5:
                signals_this_round.append(("bb_lower_touch", "buy", f"Price at lower Bollinger Band with {curr_vol/avg_vol:.1f}x volume"))

        # Volume spike
        if avg_vol > 0 and curr_vol > avg_vol * 2:
            signals_this_round.append(("volume_spike", "neutral", f"Volume spike: {curr_vol/avg_vol:.1f}x average"))

        # Calculate strength and confidence, emit signals
        buy_count = sum(1 for _, d, _ in signals_this_round if d == "buy")
        sell_count = sum(1 for _, d, _ in signals_this_round if d == "sell")

        for sig_type, direction, reasoning in signals_this_round:
            if not self._should_emit(sig_type, now):
                continue

            aligned = buy_count if direction == "buy" else sell_count if direction == "sell" else 0
            strength = "strong" if aligned >= 3 else "moderate" if aligned >= 2 else "weak"
            confidence = self._calc_confidence(sig_type, indicators, aligned, curr_vol, avg_vol)

            signal = Signal(
                id=str(uuid.uuid4()),
                signal_type=sig_type,
                source="rule",
                direction=direction,
                strength=strength,
                confidence=confidence,
                price_at_signal=current_price,
                indicators=indicators,
                reasoning=reasoning,
                timestamp=now,
            )

            self._active_signals.append(signal)
            self._recent_types[sig_type] = now
            await self._persist_signal(signal)
            await self._broadcast({"type": "signal", "data": signal.to_dict()})

        self._prev_indicators = indicators
        # Prune old signals
        cutoff = now - timedelta(minutes=30)
        self._active_signals = [s for s in self._active_signals if s.timestamp > cutoff]

    def _should_emit(self, signal_type: str, now: datetime) -> bool:
        last = self._recent_types.get(signal_type)
        if last and (now - last).total_seconds() < DEDUP_WINDOW:
            return False
        return True

    def _calc_confidence(self, sig_type: str, indicators: dict, aligned: int, vol: float, avg_vol: float) -> int:
        score = 0
        rsi = indicators.get("rsi")
        hist = indicators.get("macd_hist")

        if rsi is not None and (rsi < 25 or rsi > 75):
            score += 30
        if "sma" in sig_type:
            score += 25
        if hist is not None:
            if ("bullish" in sig_type and hist > 0) or ("bearish" in sig_type and hist < 0):
                score += 20
        if "bb_" in sig_type and avg_vol > 0 and vol > avg_vol * 1.5:
            score += 20
        if "volume_spike" in sig_type:
            score += 15
        score += max(0, (aligned - 1)) * 10

        return min(100, score)

    # ── Claude API analysis ──

    async def _claude_loop(self):
        await asyncio.sleep(30)  # Initial delay to let data accumulate
        while True:
            try:
                await self._run_claude_analysis()
            except Exception as e:
                log.warning("Claude analysis error: %s", e)
            await asyncio.sleep(CLAUDE_INTERVAL)

    async def _run_claude_analysis(self):
        if len(self._candle_buffer) < 10:
            return

        try:
            import anthropic
        except ImportError:
            log.warning("anthropic package not installed — skipping Claude analysis")
            return

        candles = list(self._candle_buffer)
        closes = [c["c"] for c in candles]
        current_price = closes[-1]

        rsi_vals = calc_rsi(closes, 14)
        sma7 = calc_sma(closes, 7)
        sma25 = calc_sma(closes, 25)
        macd_line, signal_line, histogram = calc_macd(closes)
        bb_upper, bb_middle, bb_lower = calc_bollinger(closes)

        # Last 10 candles summary
        recent = candles[-10:]
        candle_summary = "\n".join(
            f"  {i+1}. O:{c['o']:.2f} H:{c['h']:.2f} L:{c['l']:.2f} C:{c['c']:.2f} V:{c['v']:.4f}"
            for i, c in enumerate(recent)
        )

        active_sigs = ", ".join(
            f"{s.direction.upper()} {s.signal_type} ({s.confidence}%)"
            for s in self._active_signals[-5:]
        ) or "None"

        rsi = rsi_vals[-1] or 50
        macd_val = macd_line[-1] or 0
        sig_val = signal_line[-1] or 0
        hist_val = histogram[-1] or 0

        prompt = f"""You are a cryptocurrency market analyst. Analyze the current BTC/USDT market conditions.

Current Market Data:
- Price: ${current_price:,.2f}

Technical Indicators:
- RSI(14): {rsi:.1f}
- SMA(7): ${sma7[-1]:,.2f} (vs SMA(25): ${sma25[-1]:,.2f})
- MACD: {macd_val:.2f} (Signal: {sig_val:.2f}, Histogram: {hist_val:.2f})
- Bollinger Bands: Upper ${bb_upper[-1]:,.2f}, Lower ${bb_lower[-1]:,.2f}

Recent Price Action (last 10 candles, 1-minute):
{candle_summary}

Active Rule-Based Signals: {active_sigs}

Provide a concise analysis in this exact JSON format:
{{"trend": "bullish" | "bearish" | "neutral", "analysis": "2-3 sentence market analysis", "key_levels": {{"support": [price1, price2], "resistance": [price1, price2]}}, "risk": "low" | "medium" | "high", "suggestion": "Brief actionable suggestion", "confidence": 0-100}}"""

        try:
            client = anthropic.AsyncAnthropic(api_key=config.CLAUDE_API_KEY)
            response = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text.strip()
            # Extract JSON from response
            if "```" in text:
                text = text.split("```")[1].strip()
                if text.startswith("json"):
                    text = text[4:].strip()

            analysis = json.loads(text)
            self._claude_analysis = analysis
            self._claude_analysis_ts = datetime.now(timezone.utc)
            await self._broadcast({"type": "ai_analysis", "data": {
                **analysis,
                "timestamp": self._claude_analysis_ts.isoformat(),
            }})
            log.info("Claude analysis updated: trend=%s, confidence=%s", analysis.get("trend"), analysis.get("confidence"))
        except Exception as e:
            log.warning("Claude API call failed: %s", e)

    # ── Outcome tracking ──

    async def _outcome_loop(self):
        while True:
            await asyncio.sleep(60)
            try:
                await self._check_outcomes()
            except Exception as e:
                log.warning("Outcome check error: %s", e)

    async def _check_outcomes(self):
        try:
            pool = await db.get_pool()
        except RuntimeError:
            return

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=OUTCOME_DELAY)
        current_price = float(self._engine._last_price) if self._engine._last_price > 0 else None
        if current_price is None:
            return

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, direction, price_at_signal FROM mockex.ai_signals
                   WHERE outcome = 'pending' AND created_at < $1""",
                cutoff,
            )
            for row in rows:
                signal_price = float(row["price_at_signal"])
                direction = row["direction"]
                if direction == "buy":
                    outcome = "correct" if current_price > signal_price else "incorrect"
                elif direction == "sell":
                    outcome = "correct" if current_price < signal_price else "incorrect"
                else:
                    outcome = "correct"  # neutral signals always "correct"

                await conn.execute(
                    """UPDATE mockex.ai_signals
                       SET outcome = $1, outcome_price = $2, outcome_at = $3
                       WHERE id = $4""",
                    outcome, current_price, now, row["id"],
                )

    # ── Persistence & broadcast ──

    async def _persist_signal(self, signal: Signal):
        try:
            pool = await db.get_pool()
            account_id = self._engine.account.id if self._engine.account else 0
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO mockex.ai_signals
                       (id, account_id, signal_type, source, direction, strength,
                        confidence, price_at_signal, indicators_data, reasoning, outcome)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')""",
                    uuid.UUID(signal.id),
                    account_id,
                    signal.signal_type,
                    signal.source,
                    signal.direction,
                    signal.strength,
                    signal.confidence,
                    signal.price_at_signal,
                    json.dumps(signal.indicators),
                    signal.reasoning,
                )
        except RuntimeError:
            pass

    async def _broadcast(self, message: dict):
        text = json.dumps(message)
        dead = set()
        for client in self.browser_clients:
            try:
                await client.send_str(text)
            except Exception:
                dead.add(client)
        self.browser_clients -= dead

    async def get_signal_history(self) -> list[dict]:
        """Return signal history with outcomes."""
        try:
            pool = await db.get_pool()
            account_id = self._engine.account.id if self._engine.account else 0
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT * FROM mockex.ai_signals
                       WHERE account_id = $1
                       ORDER BY created_at DESC LIMIT 100""",
                    account_id,
                )
                return [
                    {
                        "id": str(r["id"]),
                        "signal_type": r["signal_type"],
                        "source": r["source"],
                        "direction": r["direction"],
                        "strength": r["strength"],
                        "confidence": r["confidence"],
                        "price": float(r["price_at_signal"]),
                        "reasoning": r["reasoning"],
                        "outcome": r["outcome"],
                        "outcome_price": float(r["outcome_price"]) if r["outcome_price"] else None,
                        "created_at": r["created_at"].isoformat(),
                    }
                    for r in rows
                ]
        except RuntimeError:
            return []
