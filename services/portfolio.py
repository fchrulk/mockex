"""Portfolio analytics: snapshots, metrics, and benchmark calculations."""

import asyncio
import logging
import math
from decimal import Decimal

from services import config, db

log = logging.getLogger("mockex.portfolio")

D = Decimal
TWO_PLACES = D("0.01")
SNAPSHOT_INTERVAL = 300  # 5 minutes


class PortfolioService:
    """Manages portfolio snapshots and computes performance metrics."""

    def __init__(self, matching_engine):
        self._engine = matching_engine
        self._snapshot_task: asyncio.Task | None = None

    async def start(self):
        """Start the periodic snapshot loop."""
        self._snapshot_task = asyncio.create_task(self._snapshot_loop())
        log.info("Portfolio snapshot loop started (every %ds)", SNAPSHOT_INTERVAL)

    async def stop(self):
        """Stop the snapshot loop."""
        if self._snapshot_task:
            self._snapshot_task.cancel()
            try:
                await self._snapshot_task
            except asyncio.CancelledError:
                pass
        log.info("Portfolio snapshot loop stopped")

    async def _snapshot_loop(self):
        """Take a portfolio snapshot every SNAPSHOT_INTERVAL seconds."""
        while True:
            await asyncio.sleep(SNAPSHOT_INTERVAL)
            try:
                await self._take_snapshot()
            except Exception as e:
                log.warning("Snapshot failed: %s", e)

    async def _take_snapshot(self):
        """Record current portfolio state to DB."""
        engine = self._engine
        if engine.account is None:
            return

        try:
            pool = await db.get_pool()
        except RuntimeError:
            return

        account = engine.account
        position = engine.position
        last_price = engine._last_price

        unrealized = D("0")
        if position and last_price > 0:
            unrealized = ((last_price - position.entry_price) * position.quantity).quantize(TWO_PLACES)

        # Sum realized PnL from trades
        realized = D("0")
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT COALESCE(SUM(realized_pnl), 0) AS total
                   FROM mockex.paper_trades
                   WHERE account_id = $1 AND realized_pnl IS NOT NULL""",
                account.id,
            )
            if row:
                realized = row["total"]

        pos_value = D("0")
        if position and last_price > 0:
            pos_value = position.quantity * last_price
        total_equity = (account.cash_balance + account.reserved_balance + pos_value).quantize(TWO_PLACES)

        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO mockex.portfolio_snapshots
                   (account_id, total_equity, cash_balance, unrealized_pnl, realized_pnl, btc_price)
                   VALUES ($1, $2, $3, $4, $5, $6)""",
                account.id,
                total_equity,
                account.cash_balance,
                unrealized,
                realized,
                last_price if last_price > 0 else D("0"),
            )
        log.debug("Snapshot: equity=%s, unrealized=%s, realized=%s", total_equity, unrealized, realized)

    async def get_metrics(self) -> dict:
        """Compute all portfolio performance metrics."""
        engine = self._engine
        if engine.account is None:
            return {}

        account = engine.account
        position = engine.position
        last_price = float(engine._last_price)
        initial = float(account.initial_balance)

        # Current equity
        pos_value = 0.0
        unrealized = 0.0
        if position and last_price > 0:
            pos_value = float(position.quantity) * last_price
            unrealized = (last_price - float(position.entry_price)) * float(position.quantity)
        total_equity = float(account.cash_balance) + float(account.reserved_balance) + pos_value
        total_pnl = total_equity - initial
        roi_pct = (total_pnl / initial * 100) if initial > 0 else 0

        # Trade-based metrics from DB
        trade_stats = await self._get_trade_stats()
        snapshot_stats = await self._get_snapshot_stats()

        return {
            "total_equity": round(total_equity, 2),
            "cash_balance": round(float(account.cash_balance), 2),
            "unrealized_pnl": round(unrealized, 2),
            "realized_pnl": trade_stats["realized_pnl"],
            "total_pnl": round(total_pnl, 2),
            "roi_pct": round(roi_pct, 2),
            "win_rate": trade_stats["win_rate"],
            "profit_factor": trade_stats["profit_factor"],
            "max_drawdown_pct": snapshot_stats["max_drawdown_pct"],
            "sharpe_ratio": snapshot_stats["sharpe_ratio"],
            "avg_win": trade_stats["avg_win"],
            "avg_loss": trade_stats["avg_loss"],
            "total_trades": trade_stats["total_trades"],
            "winning_trades": trade_stats["winning_trades"],
            "losing_trades": trade_stats["losing_trades"],
        }

    async def get_snapshots(self, from_ts: str | None = None, to_ts: str | None = None) -> dict:
        """Return equity curve data with benchmark."""
        engine = self._engine
        if engine.account is None:
            return {"snapshots": [], "benchmark": []}

        try:
            pool = await db.get_pool()
        except RuntimeError:
            return {"snapshots": [], "benchmark": []}

        async with pool.acquire() as conn:
            if from_ts and to_ts:
                rows = await conn.fetch(
                    """SELECT total_equity, btc_price, snapshot_at
                       FROM mockex.portfolio_snapshots
                       WHERE account_id = $1 AND snapshot_at >= $2 AND snapshot_at <= $3
                       ORDER BY snapshot_at""",
                    engine.account.id, from_ts, to_ts,
                )
            elif from_ts:
                rows = await conn.fetch(
                    """SELECT total_equity, btc_price, snapshot_at
                       FROM mockex.portfolio_snapshots
                       WHERE account_id = $1 AND snapshot_at >= $2
                       ORDER BY snapshot_at""",
                    engine.account.id, from_ts,
                )
            else:
                rows = await conn.fetch(
                    """SELECT total_equity, btc_price, snapshot_at
                       FROM mockex.portfolio_snapshots
                       WHERE account_id = $1
                       ORDER BY snapshot_at""",
                    engine.account.id,
                )

        if not rows:
            return {"snapshots": [], "benchmark": []}

        initial = float(engine.account.initial_balance)
        first_btc_price = float(rows[0]["btc_price"]) if rows[0]["btc_price"] > 0 else 1
        benchmark_qty = initial / first_btc_price

        snapshots = []
        benchmark = []
        for r in rows:
            ts = r["snapshot_at"].isoformat()
            snapshots.append({
                "timestamp": ts,
                "equity": float(r["total_equity"]),
                "btc_price": float(r["btc_price"]),
            })
            benchmark.append({
                "timestamp": ts,
                "value": round(benchmark_qty * float(r["btc_price"]), 2),
            })

        return {"snapshots": snapshots, "benchmark": benchmark}

    async def get_closed_trades(self) -> list[dict]:
        """Return enriched closed trades with entry/exit prices and duration."""
        engine = self._engine
        if engine.account is None:
            return []

        try:
            pool = await db.get_pool()
        except RuntimeError:
            return []

        async with pool.acquire() as conn:
            # Get sell trades (position closes) with their realized PnL
            rows = await conn.fetch(
                """SELECT t.id, t.side, t.quantity, t.price AS exit_price, t.fee,
                          t.realized_pnl, t.executed_at,
                          o.created_at AS order_created
                   FROM mockex.paper_trades t
                   JOIN mockex.paper_orders o ON t.order_id = o.id
                   WHERE t.account_id = $1
                   ORDER BY t.executed_at DESC
                   LIMIT 200""",
                engine.account.id,
            )

        trades = []
        for r in rows:
            pnl = float(r["realized_pnl"]) if r["realized_pnl"] else None
            # Estimate entry price from PnL: entry = exit - pnl/qty (for sells)
            exit_price = float(r["exit_price"])
            qty = float(r["quantity"])
            fee = float(r["fee"])
            entry_price = None
            if r["side"] == "sell" and pnl is not None and qty > 0:
                # realized_pnl = (exit - entry) * qty - fee
                entry_price = round(exit_price - (pnl + fee) / qty, 2)

            duration = None
            if r["order_created"] and r["executed_at"]:
                delta = r["executed_at"] - r["order_created"]
                duration = int(delta.total_seconds())

            trades.append({
                "id": str(r["id"]),
                "side": r["side"],
                "quantity": round(qty, 8),
                "entry_price": entry_price,
                "exit_price": round(exit_price, 2),
                "fee": round(fee, 8),
                "pnl": round(pnl, 2) if pnl is not None else None,
                "executed_at": r["executed_at"].isoformat(),
                "duration_seconds": duration,
            })
        return trades

    # ── Private helpers ──

    async def _get_trade_stats(self) -> dict:
        """Compute trade-based metrics from paper_trades table."""
        defaults = {
            "realized_pnl": 0.0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "total_trades": 0,
            "winning_trades": 0,
            "losing_trades": 0,
        }

        try:
            pool = await db.get_pool()
        except RuntimeError:
            return defaults

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT realized_pnl FROM mockex.paper_trades
                   WHERE account_id = $1 AND realized_pnl IS NOT NULL AND side = 'sell'""",
                self._engine.account.id,
            )

        if not rows:
            return defaults

        pnls = [float(r["realized_pnl"]) for r in rows]
        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p < 0]
        total = len(pnls)

        gross_profit = sum(wins)
        gross_loss = abs(sum(losses))

        return {
            "realized_pnl": round(sum(pnls), 2),
            "win_rate": round(len(wins) / total * 100, 1) if total > 0 else 0.0,
            "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else (999.99 if gross_profit > 0 else 0.0),
            "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
            "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
            "total_trades": total,
            "winning_trades": len(wins),
            "losing_trades": len(losses),
        }

    async def _get_snapshot_stats(self) -> dict:
        """Compute max drawdown and Sharpe ratio from snapshots."""
        defaults = {"max_drawdown_pct": 0.0, "sharpe_ratio": 0.0}

        try:
            pool = await db.get_pool()
        except RuntimeError:
            return defaults

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT total_equity, snapshot_at
                   FROM mockex.portfolio_snapshots
                   WHERE account_id = $1
                   ORDER BY snapshot_at""",
                self._engine.account.id,
            )

        if len(rows) < 2:
            return defaults

        # Max drawdown
        equities = [float(r["total_equity"]) for r in rows]
        peak = equities[0]
        max_dd = 0.0
        for eq in equities:
            if eq > peak:
                peak = eq
            dd = (eq - peak) / peak * 100 if peak > 0 else 0
            if dd < max_dd:
                max_dd = dd

        # Sharpe ratio from daily returns
        # Group snapshots by date, take last snapshot of each day
        daily_equity = {}
        for r in rows:
            date_key = r["snapshot_at"].date()
            daily_equity[date_key] = float(r["total_equity"])

        dates = sorted(daily_equity.keys())
        if len(dates) < 2:
            return {"max_drawdown_pct": round(max_dd, 2), "sharpe_ratio": 0.0}

        daily_returns = []
        for i in range(1, len(dates)):
            prev = daily_equity[dates[i - 1]]
            curr = daily_equity[dates[i]]
            if prev > 0:
                daily_returns.append(curr / prev - 1)

        if not daily_returns:
            return {"max_drawdown_pct": round(max_dd, 2), "sharpe_ratio": 0.0}

        avg_ret = sum(daily_returns) / len(daily_returns)
        if len(daily_returns) > 1:
            variance = sum((r - avg_ret) ** 2 for r in daily_returns) / (len(daily_returns) - 1)
            std_ret = math.sqrt(variance)
        else:
            std_ret = 0

        sharpe = (avg_ret / std_ret * math.sqrt(365)) if std_ret > 0 else 0.0

        return {
            "max_drawdown_pct": round(max_dd, 2),
            "sharpe_ratio": round(sharpe, 2),
        }
