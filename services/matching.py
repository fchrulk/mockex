"""Paper trading matching engine.

Handles order validation, market fill simulation via order book walking,
limit/stop order monitoring on each tick, position management, and balance updates.
"""

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_DOWN
from typing import Any

from aiohttp import web

from services import config, db

log = logging.getLogger("mockex.matching")

D = Decimal
TWO_PLACES = D("0.01")
EIGHT_PLACES = D("0.00000001")


@dataclass
class Account:
    id: int
    name: str
    initial_balance: D
    cash_balance: D
    reserved_balance: D

    @property
    def equity(self) -> D:
        return self.cash_balance + self.reserved_balance


@dataclass
class Order:
    id: str
    account_id: int
    symbol: str
    side: str
    order_type: str
    quantity: D
    price: D | None
    stop_price: D | None
    status: str
    filled_qty: D
    avg_fill_price: D | None
    fee: D
    created_at: Any = None
    updated_at: Any = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "account_id": self.account_id,
            "symbol": self.symbol,
            "side": self.side,
            "order_type": self.order_type,
            "quantity": str(self.quantity),
            "price": str(self.price) if self.price else None,
            "stop_price": str(self.stop_price) if self.stop_price else None,
            "status": self.status,
            "filled_qty": str(self.filled_qty),
            "avg_fill_price": str(self.avg_fill_price) if self.avg_fill_price else None,
            "fee": str(self.fee),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


@dataclass
class Position:
    id: int
    account_id: int
    symbol: str
    side: str
    quantity: D
    entry_price: D

    def to_dict(self, current_price: D | None = None) -> dict:
        d = {
            "id": self.id,
            "symbol": self.symbol,
            "side": self.side,
            "quantity": str(self.quantity),
            "entry_price": str(self.entry_price),
        }
        if current_price is not None:
            unrealized = (current_price - self.entry_price) * self.quantity
            d["unrealized_pnl"] = str(unrealized.quantize(TWO_PLACES))
            d["current_price"] = str(current_price)
        return d


class MatchingEngine:
    """Core paper trading engine."""

    def __init__(self):
        self.account: Account | None = None
        self.open_orders: list[Order] = []
        self.position: Position | None = None
        self.browser_clients: set[web.WebSocketResponse] = set()
        self._order_book: dict = {"bids": [], "asks": []}
        self._last_price: D = D("0")
        self._best_bid: D = D("0")
        self._best_ask: D = D("0")
        self._fee_rate: D = D(str(config.TRADING_FEE_RATE))

    async def init(self):
        """Load account, open orders, and position from DB."""
        try:
            pool = await db.get_pool()
        except RuntimeError:
            log.warning("DB not available — matching engine running without persistence")
            self.account = Account(
                id=0,
                name="Default",
                initial_balance=D(str(config.INITIAL_BALANCE)),
                cash_balance=D(str(config.INITIAL_BALANCE)),
                reserved_balance=D("0"),
            )
            return

        async with pool.acquire() as conn:
            # Ensure default account exists
            row = await conn.fetchrow(
                "SELECT * FROM mockex.paper_accounts ORDER BY id LIMIT 1"
            )
            if row is None:
                row = await conn.fetchrow(
                    """INSERT INTO mockex.paper_accounts (name, initial_balance, cash_balance)
                       VALUES ('Default', $1, $1) RETURNING *""",
                    D(str(config.INITIAL_BALANCE)),
                )
            self.account = Account(
                id=row["id"],
                name=row["name"],
                initial_balance=row["initial_balance"],
                cash_balance=row["cash_balance"],
                reserved_balance=row["reserved_balance"],
            )

            # Load open orders
            rows = await conn.fetch(
                """SELECT * FROM mockex.paper_orders
                   WHERE account_id = $1 AND status IN ('open', 'pending')
                   ORDER BY created_at""",
                self.account.id,
            )
            for r in rows:
                self.open_orders.append(self._row_to_order(r))

            # Load position
            pos_row = await conn.fetchrow(
                """SELECT * FROM mockex.paper_positions
                   WHERE account_id = $1 AND symbol = 'BTCUSDT'""",
                self.account.id,
            )
            if pos_row:
                self.position = Position(
                    id=pos_row["id"],
                    account_id=pos_row["account_id"],
                    symbol=pos_row["symbol"],
                    side=pos_row["side"],
                    quantity=pos_row["quantity"],
                    entry_price=pos_row["entry_price"],
                )

        log.info(
            "Matching engine loaded: balance=%s, open_orders=%d, position=%s",
            self.account.cash_balance,
            len(self.open_orders),
            f"{self.position.quantity} BTC @ {self.position.entry_price}" if self.position else "none",
        )

    def update_market_data(self, order_book: dict | None = None, last_price: float | None = None):
        """Update market data from Binance streams."""
        if order_book is not None:
            self._order_book = order_book
            if order_book.get("asks"):
                self._best_ask = D(str(order_book["asks"][0][0]))
            if order_book.get("bids"):
                self._best_bid = D(str(order_book["bids"][0][0]))
        if last_price is not None:
            self._last_price = D(str(last_price))

    async def on_tick(self):
        """Check open limit/stop orders against current market data."""
        if not self.open_orders:
            return

        filled_orders = []
        for order in list(self.open_orders):
            if order.status != "open":
                continue

            if order.order_type == "limit":
                if order.side == "buy" and self._best_ask > 0 and self._best_ask <= order.price:
                    await self._fill_order(order, order.price)
                    filled_orders.append(order)
                elif order.side == "sell" and self._best_bid > 0 and self._best_bid >= order.price:
                    await self._fill_order(order, order.price)
                    filled_orders.append(order)

            elif order.order_type == "stop":
                triggered = False
                if order.side == "sell" and self._best_bid > 0 and self._best_bid <= order.stop_price:
                    triggered = True
                elif order.side == "buy" and self._best_ask > 0 and self._best_ask >= order.stop_price:
                    triggered = True

                if triggered:
                    fill_price = self._simulate_market_fill(order.side, order.quantity)
                    await self._fill_order(order, fill_price)
                    filled_orders.append(order)

        for order in filled_orders:
            if order in self.open_orders:
                self.open_orders.remove(order)

    async def place_order(self, side: str, order_type: str, quantity: float,
                          price: float | None = None, stop_price: float | None = None) -> dict:
        """Validate and place a new order. Returns order dict or raises ValueError."""
        if self.account is None:
            raise ValueError("Trading engine not initialized")

        qty = D(str(quantity)).quantize(EIGHT_PLACES)
        if qty <= 0:
            raise ValueError("Quantity must be positive")

        px = D(str(price)).quantize(TWO_PLACES) if price else None
        spx = D(str(stop_price)).quantize(TWO_PLACES) if stop_price else None

        if order_type in ("limit", "stop") and not px and not spx:
            raise ValueError(f"Price required for {order_type} orders")

        # Validate balance/position
        if side == "buy":
            est_price = px or spx or self._best_ask or self._last_price
            if est_price <= 0:
                raise ValueError("No market price available")
            est_cost = qty * est_price * (1 + self._fee_rate)
            if est_cost > self.account.cash_balance:
                raise ValueError(
                    f"Insufficient balance: need {est_cost:.2f}, have {self.account.cash_balance:.2f}"
                )
        elif side == "sell":
            if self.position is None or self.position.quantity < qty:
                held = self.position.quantity if self.position else D("0")
                raise ValueError(
                    f"Insufficient position: want to sell {qty}, hold {held}"
                )

        order_id = str(uuid.uuid4())
        order = Order(
            id=order_id,
            account_id=self.account.id,
            symbol="BTCUSDT",
            side=side,
            order_type=order_type,
            quantity=qty,
            price=px,
            stop_price=spx,
            status="pending",
            filled_qty=D("0"),
            avg_fill_price=None,
            fee=D("0"),
        )

        # Market orders fill immediately
        if order_type == "market":
            fill_price = self._simulate_market_fill(side, qty)
            await self._persist_order(order)
            await self._fill_order(order, fill_price)
            return order.to_dict()

        # Limit self-crossing check: if buy limit >= best ask, fill as market
        if order_type == "limit":
            if side == "buy" and px and self._best_ask > 0 and px >= self._best_ask:
                fill_price = self._simulate_market_fill(side, qty)
                await self._persist_order(order)
                await self._fill_order(order, fill_price)
                return order.to_dict()
            if side == "sell" and px and self._best_bid > 0 and px <= self._best_bid:
                fill_price = self._simulate_market_fill(side, qty)
                await self._persist_order(order)
                await self._fill_order(order, fill_price)
                return order.to_dict()

        # Reserve balance for limit/stop buy orders
        if side == "buy":
            reserve_price = px or spx
            reserve_amount = qty * reserve_price * (1 + self._fee_rate)
            self.account.cash_balance -= reserve_amount
            self.account.reserved_balance += reserve_amount
            await self._persist_account()

        order.status = "open"
        await self._persist_order(order)
        self.open_orders.append(order)

        await self._broadcast_order_update(order)
        await self._broadcast_balance()
        return order.to_dict()

    async def cancel_order(self, order_id: str) -> dict:
        """Cancel an open order and release reserved balance."""
        order = next((o for o in self.open_orders if o.id == order_id), None)
        if order is None:
            raise ValueError(f"Order {order_id} not found or not open")

        order.status = "cancelled"
        self.open_orders.remove(order)

        # Release reserved balance for buy orders
        if order.side == "buy" and order.price:
            reserve_price = order.price or order.stop_price
            reserve_amount = order.quantity * reserve_price * (1 + self._fee_rate)
            self.account.cash_balance += reserve_amount
            self.account.reserved_balance -= reserve_amount
            await self._persist_account()

        await self._update_order_status(order)
        await self._broadcast_order_update(order)
        await self._broadcast_balance()
        return order.to_dict()

    async def close_position(self) -> dict:
        """Close entire position via market sell."""
        if self.position is None or self.position.quantity <= 0:
            raise ValueError("No open position to close")
        result = await self.place_order("sell", "market", float(self.position.quantity))
        return result

    async def reset_account(self) -> dict:
        """Reset account: clear all orders, trades, positions; restore initial balance."""
        if self.account is None:
            raise ValueError("Trading engine not initialized")

        self.open_orders.clear()
        self.position = None
        self.account.cash_balance = self.account.initial_balance
        self.account.reserved_balance = D("0")

        try:
            pool = await db.get_pool()
            async with pool.acquire() as conn:
                aid = self.account.id
                await conn.execute("DELETE FROM mockex.paper_trades WHERE account_id = $1", aid)
                await conn.execute("DELETE FROM mockex.paper_orders WHERE account_id = $1", aid)
                await conn.execute("DELETE FROM mockex.paper_positions WHERE account_id = $1", aid)
                await conn.execute(
                    """UPDATE mockex.paper_accounts
                       SET cash_balance = initial_balance,
                           reserved_balance = 0,
                           reset_at = NOW()
                       WHERE id = $1""",
                    aid,
                )
        except RuntimeError:
            pass

        await self._broadcast_balance()
        await self._broadcast_position()
        return {"status": "reset", "cash_balance": str(self.account.cash_balance)}

    def get_account_info(self) -> dict:
        """Return current account balances."""
        if self.account is None:
            return {}
        pos_value = D("0")
        if self.position and self._last_price > 0:
            pos_value = self.position.quantity * self._last_price
        return {
            "cash": str(self.account.cash_balance),
            "reserved": str(self.account.reserved_balance),
            "equity": str(self.account.cash_balance + self.account.reserved_balance + pos_value),
            "position_value": str(pos_value),
        }

    def get_position(self) -> dict | None:
        """Return current position with live PnL."""
        if self.position is None:
            return None
        return self.position.to_dict(self._last_price if self._last_price > 0 else None)

    async def get_orders(self, status: str | None = None) -> list[dict]:
        """Return orders filtered by status."""
        try:
            pool = await db.get_pool()
            async with pool.acquire() as conn:
                if status:
                    rows = await conn.fetch(
                        """SELECT * FROM mockex.paper_orders
                           WHERE account_id = $1 AND status = $2
                           ORDER BY created_at DESC""",
                        self.account.id, status,
                    )
                else:
                    rows = await conn.fetch(
                        """SELECT * FROM mockex.paper_orders
                           WHERE account_id = $1
                           ORDER BY created_at DESC LIMIT 100""",
                        self.account.id,
                    )
                return [self._row_to_order(r).to_dict() for r in rows]
        except RuntimeError:
            # No DB — return in-memory open orders
            orders = self.open_orders if status == "open" else []
            return [o.to_dict() for o in orders]

    async def get_trades(self) -> list[dict]:
        """Return executed trade history."""
        try:
            pool = await db.get_pool()
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT * FROM mockex.paper_trades
                       WHERE account_id = $1
                       ORDER BY executed_at DESC LIMIT 100""",
                    self.account.id,
                )
                return [
                    {
                        "id": str(r["id"]),
                        "order_id": str(r["order_id"]),
                        "symbol": r["symbol"],
                        "side": r["side"],
                        "quantity": str(r["quantity"]),
                        "price": str(r["price"]),
                        "fee": str(r["fee"]),
                        "realized_pnl": str(r["realized_pnl"]) if r["realized_pnl"] else None,
                        "executed_at": r["executed_at"].isoformat(),
                    }
                    for r in rows
                ]
        except RuntimeError:
            return []

    # ── Private helpers ──

    def _simulate_market_fill(self, side: str, quantity: D) -> D:
        """Walk the order book to get a realistic fill price."""
        levels = self._order_book.get("asks" if side == "buy" else "bids", [])
        if not levels:
            return self._last_price if self._last_price > 0 else D("0")

        remaining = quantity
        total_cost = D("0")

        for level in levels:
            level_price = D(str(level[0]))
            level_qty = D(str(level[1]))
            fill_qty = min(remaining, level_qty)
            total_cost += fill_qty * level_price
            remaining -= fill_qty
            if remaining <= 0:
                break

        if remaining > 0:
            worst_price = D(str(levels[-1][0]))
            slippage = worst_price * D("0.001")
            total_cost += remaining * (worst_price + slippage)

        return (total_cost / quantity).quantize(TWO_PLACES)

    async def _fill_order(self, order: Order, fill_price: D):
        """Execute an order fill: update order, position, balance, persist, broadcast."""
        fee = (order.quantity * fill_price * self._fee_rate).quantize(EIGHT_PLACES)
        order.status = "filled"
        order.filled_qty = order.quantity
        order.avg_fill_price = fill_price
        order.fee = fee

        realized_pnl = None

        if order.side == "buy":
            # Release reserved (for limit/stop) or deduct cash (for market)
            cost = order.quantity * fill_price + fee
            if order.order_type in ("limit", "stop"):
                reserve_price = order.price or order.stop_price
                reserved = order.quantity * reserve_price * (1 + self._fee_rate)
                self.account.reserved_balance -= reserved
                # Actual cost might differ from reserved amount
                diff = reserved - cost
                self.account.cash_balance += diff
            else:
                self.account.cash_balance -= cost

            # Update position
            if self.position is None:
                self.position = Position(
                    id=0,
                    account_id=self.account.id,
                    symbol="BTCUSDT",
                    side="long",
                    quantity=order.quantity,
                    entry_price=fill_price,
                )
            else:
                # VWAP entry price
                total_qty = self.position.quantity + order.quantity
                total_cost = (
                    self.position.entry_price * self.position.quantity
                    + fill_price * order.quantity
                )
                self.position.entry_price = (total_cost / total_qty).quantize(TWO_PLACES)
                self.position.quantity = total_qty

        elif order.side == "sell":
            proceeds = order.quantity * fill_price - fee
            self.account.cash_balance += proceeds

            if self.position:
                realized_pnl = (
                    (fill_price - self.position.entry_price) * order.quantity - fee
                ).quantize(TWO_PLACES)
                self.position.quantity -= order.quantity
                if self.position.quantity <= 0:
                    await self._delete_position()
                    self.position = None
                else:
                    await self._persist_position()

        await self._persist_account()
        await self._update_order_status(order)
        if self.position:
            await self._persist_position()
        await self._persist_trade(order, fill_price, fee, realized_pnl)

        # Broadcast updates
        await self._broadcast_order_update(order)
        await self._broadcast_trade(order, fill_price, fee, realized_pnl)
        await self._broadcast_balance()
        await self._broadcast_position()

    async def _broadcast(self, message: dict):
        """Send JSON message to all registered trading clients."""
        text = json.dumps(message)
        dead = set()
        for client in self.browser_clients:
            try:
                await client.send_str(text)
            except Exception:
                dead.add(client)
        self.browser_clients -= dead

    async def _broadcast_order_update(self, order: Order):
        await self._broadcast({"type": "order_update", "data": order.to_dict()})

    async def _broadcast_trade(self, order: Order, price: D, fee: D, realized_pnl: D | None):
        await self._broadcast({
            "type": "trade_executed",
            "data": {
                "order_id": order.id,
                "side": order.side,
                "quantity": str(order.quantity),
                "price": str(price),
                "fee": str(fee),
                "realized_pnl": str(realized_pnl) if realized_pnl else None,
            },
        })

    async def _broadcast_balance(self):
        await self._broadcast({"type": "balance_update", "data": self.get_account_info()})

    async def _broadcast_position(self):
        pos = self.get_position()
        await self._broadcast({"type": "position_update", "data": pos})

    # ── DB persistence ──

    async def _persist_account(self):
        try:
            pool = await db.get_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    """UPDATE mockex.paper_accounts
                       SET cash_balance = $1, reserved_balance = $2
                       WHERE id = $3""",
                    self.account.cash_balance,
                    self.account.reserved_balance,
                    self.account.id,
                )
        except RuntimeError:
            pass

    async def _persist_order(self, order: Order):
        try:
            pool = await db.get_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO mockex.paper_orders
                       (id, account_id, symbol, side, order_type, quantity, price, stop_price, status)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                    uuid.UUID(order.id),
                    order.account_id,
                    order.symbol,
                    order.side,
                    order.order_type,
                    order.quantity,
                    order.price,
                    order.stop_price,
                    order.status,
                )
        except RuntimeError:
            pass

    async def _update_order_status(self, order: Order):
        try:
            pool = await db.get_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    """UPDATE mockex.paper_orders
                       SET status = $1, filled_qty = $2, avg_fill_price = $3,
                           fee = $4, updated_at = NOW()
                       WHERE id = $5""",
                    order.status,
                    order.filled_qty,
                    order.avg_fill_price,
                    order.fee,
                    uuid.UUID(order.id),
                )
        except RuntimeError:
            pass

    async def _persist_position(self):
        if self.position is None:
            return
        try:
            pool = await db.get_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO mockex.paper_positions (account_id, symbol, side, quantity, entry_price)
                       VALUES ($1, 'BTCUSDT', 'long', $2, $3)
                       ON CONFLICT (account_id, symbol)
                       DO UPDATE SET quantity = $2, entry_price = $3, updated_at = NOW()""",
                    self.account.id,
                    self.position.quantity,
                    self.position.entry_price,
                )
                if self.position.id == 0:
                    row = await conn.fetchrow(
                        "SELECT id FROM mockex.paper_positions WHERE account_id = $1 AND symbol = 'BTCUSDT'",
                        self.account.id,
                    )
                    if row:
                        self.position.id = row["id"]
        except RuntimeError:
            pass

    async def _delete_position(self):
        try:
            pool = await db.get_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    "DELETE FROM mockex.paper_positions WHERE account_id = $1 AND symbol = 'BTCUSDT'",
                    self.account.id,
                )
        except RuntimeError:
            pass

    async def _persist_trade(self, order: Order, price: D, fee: D, realized_pnl: D | None):
        try:
            pool = await db.get_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO mockex.paper_trades
                       (account_id, order_id, symbol, side, quantity, price, fee, realized_pnl)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                    self.account.id,
                    uuid.UUID(order.id),
                    order.symbol,
                    order.side,
                    order.quantity,
                    price,
                    fee,
                    realized_pnl,
                )
        except RuntimeError:
            pass

    @staticmethod
    def _row_to_order(row) -> Order:
        return Order(
            id=str(row["id"]),
            account_id=row["account_id"],
            symbol=row["symbol"],
            side=row["side"],
            order_type=row["order_type"],
            quantity=row["quantity"],
            price=row["price"],
            stop_price=row["stop_price"],
            status=row["status"],
            filled_qty=row["filled_qty"],
            avg_fill_price=row["avg_fill_price"],
            fee=row["fee"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
