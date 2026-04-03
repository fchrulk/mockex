# TraderBot Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the TraderBot project with config, data models, exchange adapter interface, and a working mockex adapter that can connect to mockex's API.

**Architecture:** Standalone Python async app at `apps/traderbot/`. Config loaded from `.env`. Abstract `BaseExchange` interface with a `MockexAdapter` implementation that talks to mockex via HTTP REST + WebSocket. Event bus for internal pub/sub.

**Tech Stack:** Python 3.12+, aiohttp (HTTP client), websockets (WS client), python-dotenv, pytest + pytest-asyncio (testing)

---

### Task 1: Project Scaffold

**Files:**
- Create: `apps/traderbot/main.py`
- Create: `apps/traderbot/config.py`
- Create: `apps/traderbot/.env.example`
- Create: `apps/traderbot/requirements.txt`
- Create: `apps/traderbot/.gitignore`
- Create: `apps/traderbot/core/__init__.py`
- Create: `apps/traderbot/exchange/__init__.py`
- Create: `apps/traderbot/strategy/__init__.py`
- Create: `apps/traderbot/risk/__init__.py`
- Create: `apps/traderbot/brain/__init__.py`
- Create: `apps/traderbot/notify/__init__.py`
- Create: `apps/traderbot/utils/__init__.py`
- Create: `apps/traderbot/tests/__init__.py`

- [ ] **Step 1: Create requirements.txt**

```
aiohttp>=3.9
websockets>=12.0
anthropic>=0.40
python-telegram-bot>=21.0
python-dotenv>=1.0
pytest>=8.0
pytest-asyncio>=0.23
```

- [ ] **Step 2: Create .gitignore**

```
.env
__pycache__/
*.pyc
.pytest_cache/
```

- [ ] **Step 3: Create .env.example**

```env
# Exchange
EXCHANGE=mockex
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

- [ ] **Step 4: Create config.py**

```python
"""Application configuration loaded from .env with defaults."""

import os
from pathlib import Path

from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(_env_path)


def _get(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _int(key: str, default: int = 0) -> int:
    return int(_get(key, str(default)))


def _float(key: str, default: float = 0.0) -> float:
    return float(_get(key, str(default)))


def _bool(key: str, default: bool = False) -> bool:
    return _get(key, str(default)).lower() in ("true", "1", "yes")


# Exchange
EXCHANGE = _get("EXCHANGE", "mockex")
MOCKEX_URL = _get("MOCKEX_URL", "http://localhost:3000")
BINANCE_API_KEY = _get("BINANCE_API_KEY")
BINANCE_API_SECRET = _get("BINANCE_API_SECRET")

# Strategy
STRATEGIES = [s.strip() for s in _get("STRATEGIES", "ema_crossover").split(",") if s.strip()]
SYMBOL = _get("SYMBOL", "BTCUSDT")

# Risk Management
MAX_POSITION_PCT = _float("MAX_POSITION_PCT", 10.0)
MAX_DAILY_LOSS_PCT = _float("MAX_DAILY_LOSS_PCT", 5.0)
MAX_DRAWDOWN_PCT = _float("MAX_DRAWDOWN_PCT", 15.0)
MAX_OPEN_TRADES = _int("MAX_OPEN_TRADES", 3)
TRADE_COOLDOWN_SECONDS = _int("TRADE_COOLDOWN_SECONDS", 300)
DEFAULT_STOP_LOSS_PCT = _float("DEFAULT_STOP_LOSS_PCT", 3.0)

# Claude AI
CLAUDE_API_KEY = _get("CLAUDE_API_KEY")
CLAUDE_MODEL = _get("CLAUDE_MODEL", "haiku")
CLAUDE_MIN_INTERVAL_SECONDS = _int("CLAUDE_MIN_INTERVAL_SECONDS", 120)
CLAUDE_FALLBACK = _get("CLAUDE_FALLBACK", "block")

# Telegram
TELEGRAM_BOT_TOKEN = _get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = _get("TELEGRAM_CHAT_ID")

# Autonomy
AUTONOMY_MODE = _get("AUTONOMY_MODE", "semi")

# Agent
CANCEL_ON_SHUTDOWN = _bool("CANCEL_ON_SHUTDOWN", True)
LOG_LEVEL = _get("LOG_LEVEL", "INFO")
```

- [ ] **Step 5: Create empty __init__.py files for all packages**

Create empty files at:
- `apps/traderbot/core/__init__.py`
- `apps/traderbot/exchange/__init__.py`
- `apps/traderbot/strategy/__init__.py`
- `apps/traderbot/risk/__init__.py`
- `apps/traderbot/brain/__init__.py`
- `apps/traderbot/notify/__init__.py`
- `apps/traderbot/utils/__init__.py`
- `apps/traderbot/tests/__init__.py`

- [ ] **Step 6: Create main.py (minimal entry point)**

```python
#!/usr/bin/env python3
"""TraderBot — AI trading agent for BTC/USDT."""

import logging

import config

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("traderbot")


def main():
    log.info("TraderBot starting (exchange=%s)", config.EXCHANGE)
    log.info("TraderBot ready — agent loop not yet implemented")


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Verify the scaffold runs**

Run: `cd /home/fchrulk/apps/traderbot && python main.py`
Expected: Log output "TraderBot starting (exchange=mockex)" and "TraderBot ready"

- [ ] **Step 8: Commit**

```bash
cd /home/fchrulk/apps
git add traderbot/
git commit -m "feat(traderbot): scaffold project with config and package structure"
```

---

### Task 2: Data Models

**Files:**
- Create: `apps/traderbot/core/models.py`
- Create: `apps/traderbot/tests/test_models.py`

- [ ] **Step 1: Write tests for data models**

```python
"""Tests for core data models."""

import pytest
from core.models import Candle, Signal, Order, Trade, Position, Balance


def test_candle_creation():
    c = Candle(
        timestamp=1700000000000,
        open=95000.0, high=95500.0, low=94800.0, close=95200.0,
        volume=12.5, interval="5m",
    )
    assert c.timestamp == 1700000000000
    assert c.close == 95200.0
    assert c.interval == "5m"


def test_signal_creation():
    s = Signal(
        direction="buy", strength=0.75,
        reason="EMA9 crossed above EMA21",
        strategy_name="ema_crossover",
    )
    assert s.direction == "buy"
    assert s.strength == 0.75
    assert s.stop_loss is None
    assert s.take_profit is None


def test_signal_validation_invalid_direction():
    with pytest.raises(ValueError, match="direction must be"):
        Signal(
            direction="long", strength=0.5,
            reason="test", strategy_name="test",
        )


def test_signal_validation_strength_range():
    with pytest.raises(ValueError, match="strength must be"):
        Signal(
            direction="buy", strength=1.5,
            reason="test", strategy_name="test",
        )


def test_order_creation():
    o = Order(
        id="abc-123", symbol="BTCUSDT", side="buy",
        order_type="market", quantity=0.005,
        status="open",
    )
    assert o.id == "abc-123"
    assert o.price is None
    assert o.filled_qty == 0.0


def test_trade_creation():
    t = Trade(
        id="t-1", order_id="abc-123", symbol="BTCUSDT",
        side="buy", quantity=0.005, price=95200.0, fee=4.76,
    )
    assert t.fee == 4.76
    assert t.realized_pnl == 0.0


def test_position_unrealized_pnl():
    p = Position(
        symbol="BTCUSDT", side="buy",
        quantity=0.01, entry_price=95000.0,
    )
    assert p.unrealized_pnl(95500.0) == pytest.approx(5.0)
    assert p.unrealized_pnl(94500.0) == pytest.approx(-5.0)


def test_balance_equity():
    b = Balance(cash=50000.0, reserved=5000.0, position_value=45000.0)
    assert b.equity == pytest.approx(100000.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.models'`

- [ ] **Step 3: Implement data models**

```python
"""Core data models for TraderBot."""

from dataclasses import dataclass, field


@dataclass
class Candle:
    """OHLCV candle."""
    timestamp: int  # milliseconds
    open: float
    high: float
    low: float
    close: float
    volume: float
    interval: str  # e.g., "1m", "5m", "15m"


@dataclass
class Signal:
    """Trading signal produced by a strategy."""
    direction: str  # "buy" | "sell" | "hold"
    strength: float  # 0.0 to 1.0
    reason: str
    strategy_name: str
    suggested_quantity: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None

    def __post_init__(self):
        if self.direction not in ("buy", "sell", "hold"):
            raise ValueError(f"direction must be 'buy', 'sell', or 'hold', got '{self.direction}'")
        if not 0.0 <= self.strength <= 1.0:
            raise ValueError(f"strength must be between 0.0 and 1.0, got {self.strength}")


@dataclass
class Order:
    """Order placed on an exchange."""
    id: str
    symbol: str
    side: str  # "buy" | "sell"
    order_type: str  # "market" | "limit" | "stop"
    quantity: float
    status: str  # "open" | "filled" | "cancelled" | "pending"
    price: float | None = None
    stop_price: float | None = None
    filled_qty: float = 0.0
    avg_fill_price: float | None = None
    fee: float = 0.0
    created_at: str | None = None
    updated_at: str | None = None


@dataclass
class Trade:
    """Executed trade (fill)."""
    id: str
    order_id: str
    symbol: str
    side: str
    quantity: float
    price: float
    fee: float
    realized_pnl: float = 0.0
    executed_at: str | None = None


@dataclass
class Position:
    """Open position."""
    symbol: str
    side: str  # "buy" (long)
    quantity: float
    entry_price: float

    def unrealized_pnl(self, current_price: float) -> float:
        """Calculate unrealized PnL at the given market price."""
        return (current_price - self.entry_price) * self.quantity


@dataclass
class Balance:
    """Account balance."""
    cash: float
    reserved: float
    position_value: float

    @property
    def equity(self) -> float:
        return self.cash + self.reserved + self.position_value
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_models.py -v`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
cd /home/fchrulk/apps
git add traderbot/core/models.py traderbot/tests/test_models.py
git commit -m "feat(traderbot): add core data models (Candle, Signal, Order, Trade, Position, Balance)"
```

---

### Task 3: Event Bus

**Files:**
- Create: `apps/traderbot/core/events.py`
- Create: `apps/traderbot/tests/test_events.py`

- [ ] **Step 1: Write tests for event bus**

```python
"""Tests for internal event bus."""

import pytest
from core.events import EventBus


def test_subscribe_and_emit():
    bus = EventBus()
    received = []
    bus.on("test_event", lambda data: received.append(data))
    bus.emit("test_event", {"key": "value"})
    assert received == [{"key": "value"}]


def test_multiple_subscribers():
    bus = EventBus()
    a, b = [], []
    bus.on("evt", lambda d: a.append(d))
    bus.on("evt", lambda d: b.append(d))
    bus.emit("evt", 42)
    assert a == [42]
    assert b == [42]


def test_emit_unknown_event_no_error():
    bus = EventBus()
    bus.emit("nonexistent", {})  # should not raise


def test_off_removes_handler():
    bus = EventBus()
    received = []
    handler = lambda d: received.append(d)
    bus.on("evt", handler)
    bus.off("evt", handler)
    bus.emit("evt", "ignored")
    assert received == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_events.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.events'`

- [ ] **Step 3: Implement event bus**

```python
"""Internal event bus for pub/sub communication between components."""

import logging
from collections import defaultdict
from typing import Any, Callable

log = logging.getLogger("traderbot.events")


class EventBus:
    """Simple synchronous pub/sub event bus."""

    def __init__(self):
        self._handlers: dict[str, list[Callable]] = defaultdict(list)

    def on(self, event: str, handler: Callable) -> None:
        """Subscribe a handler to an event."""
        self._handlers[event].append(handler)

    def off(self, event: str, handler: Callable) -> None:
        """Unsubscribe a handler from an event."""
        try:
            self._handlers[event].remove(handler)
        except ValueError:
            pass

    def emit(self, event: str, data: Any = None) -> None:
        """Emit an event to all subscribed handlers."""
        for handler in self._handlers.get(event, []):
            try:
                handler(data)
            except Exception:
                log.exception("Error in handler for event '%s'", event)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_events.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /home/fchrulk/apps
git add traderbot/core/events.py traderbot/tests/test_events.py
git commit -m "feat(traderbot): add internal event bus for pub/sub communication"
```

---

### Task 4: Exchange Base Interface

**Files:**
- Create: `apps/traderbot/exchange/base.py`
- Create: `apps/traderbot/tests/test_exchange_base.py`

- [ ] **Step 1: Write tests for base exchange**

```python
"""Tests for base exchange interface."""

import pytest
from exchange.base import BaseExchange


def test_cannot_instantiate_base_exchange():
    """BaseExchange is abstract — cannot be instantiated directly."""
    with pytest.raises(TypeError):
        BaseExchange()


def test_subclass_must_implement_all_methods():
    """A subclass that doesn't implement all methods cannot be instantiated."""
    class IncompleteExchange(BaseExchange):
        async def connect(self): ...

    with pytest.raises(TypeError):
        IncompleteExchange()


def test_subclass_with_all_methods_can_instantiate():
    """A subclass implementing all methods can be instantiated."""
    class FakeExchange(BaseExchange):
        async def connect(self): pass
        async def disconnect(self): pass
        async def place_order(self, side, order_type, quantity, price=None, stop_price=None): pass
        async def cancel_order(self, order_id): pass
        async def get_balance(self): pass
        async def get_position(self): pass
        async def get_open_orders(self): pass
        async def get_trades(self): pass
        async def subscribe_market_data(self, callback): pass

    ex = FakeExchange()
    assert ex is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_exchange_base.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'exchange.base'`

- [ ] **Step 3: Implement base exchange interface**

```python
"""Abstract base class for exchange adapters."""

from abc import ABC, abstractmethod
from typing import Any, Callable

from core.models import Balance, Order, Position, Trade


class BaseExchange(ABC):
    """Interface that all exchange adapters must implement."""

    def __init__(self):
        self.on_order_update: Callable[[Order], None] | None = None
        self.on_balance_update: Callable[[Balance], None] | None = None
        self.on_trade_executed: Callable[[Trade], None] | None = None

    @abstractmethod
    async def connect(self) -> None:
        """Establish connection to the exchange (WebSocket + REST)."""

    @abstractmethod
    async def disconnect(self) -> None:
        """Close all connections and clean up."""

    @abstractmethod
    async def place_order(
        self, side: str, order_type: str, quantity: float,
        price: float | None = None, stop_price: float | None = None,
    ) -> Order:
        """Place an order on the exchange."""

    @abstractmethod
    async def cancel_order(self, order_id: str) -> Order:
        """Cancel an open order."""

    @abstractmethod
    async def get_balance(self) -> Balance:
        """Get current account balance."""

    @abstractmethod
    async def get_position(self) -> Position | None:
        """Get current open position, or None if flat."""

    @abstractmethod
    async def get_open_orders(self) -> list[Order]:
        """Get all open orders."""

    @abstractmethod
    async def get_trades(self) -> list[Trade]:
        """Get recent trade history."""

    @abstractmethod
    async def subscribe_market_data(self, callback: Callable) -> None:
        """Subscribe to market data stream. Callback receives raw stream messages."""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_exchange_base.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
cd /home/fchrulk/apps
git add traderbot/exchange/base.py traderbot/tests/test_exchange_base.py
git commit -m "feat(traderbot): add abstract BaseExchange interface"
```

---

### Task 5: Mockex Adapter — REST Methods

**Files:**
- Create: `apps/traderbot/exchange/mockex.py`
- Create: `apps/traderbot/tests/test_mockex_adapter.py`

- [ ] **Step 1: Write tests for mockex REST methods**

These tests mock the HTTP calls to avoid needing a running mockex server.

```python
"""Tests for MockexAdapter REST methods."""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch, MagicMock
import json

from exchange.mockex import MockexAdapter
from core.models import Order, Balance, Position, Trade


@pytest_asyncio.fixture
async def adapter():
    a = MockexAdapter(base_url="http://localhost:3000")
    return a


def _mock_response(data, status=200):
    """Create a mock aiohttp response."""
    resp = AsyncMock()
    resp.status = status
    resp.json = AsyncMock(return_value=data)
    resp.text = AsyncMock(return_value=json.dumps(data))
    resp.__aenter__ = AsyncMock(return_value=resp)
    resp.__aexit__ = AsyncMock(return_value=False)
    return resp


def _mock_session(response):
    """Create a mock aiohttp ClientSession."""
    session = MagicMock()
    session.get = MagicMock(return_value=response)
    session.post = MagicMock(return_value=response)
    session.delete = MagicMock(return_value=response)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


@pytest.mark.asyncio
async def test_get_balance(adapter):
    data = {"cash": "50000.00", "reserved": "5000.00", "equity": "100000.00", "position_value": "45000.00"}
    resp = _mock_response(data)
    session = _mock_session(resp)

    with patch("aiohttp.ClientSession", return_value=session):
        balance = await adapter.get_balance()

    assert isinstance(balance, Balance)
    assert balance.cash == 50000.0
    assert balance.reserved == 5000.0
    assert balance.position_value == 45000.0


@pytest.mark.asyncio
async def test_get_position_exists(adapter):
    data = {
        "symbol": "BTCUSDT", "side": "buy",
        "quantity": "0.01", "entry_price": "95000.00",
        "unrealized_pnl": "5.00", "current_price": "95500.00",
    }
    resp = _mock_response(data)
    session = _mock_session(resp)

    with patch("aiohttp.ClientSession", return_value=session):
        pos = await adapter.get_position()

    assert isinstance(pos, Position)
    assert pos.quantity == 0.01
    assert pos.entry_price == 95000.0


@pytest.mark.asyncio
async def test_get_position_none(adapter):
    resp = _mock_response({})
    session = _mock_session(resp)

    with patch("aiohttp.ClientSession", return_value=session):
        pos = await adapter.get_position()

    assert pos is None


@pytest.mark.asyncio
async def test_place_order(adapter):
    data = {
        "id": "abc-123", "symbol": "BTCUSDT", "side": "buy",
        "order_type": "market", "quantity": "0.005", "status": "filled",
        "filled_qty": "0.005", "avg_fill_price": "95200.00", "fee": "4.76",
        "price": None, "stop_price": None,
        "created_at": "2026-04-03T00:00:00", "updated_at": "2026-04-03T00:00:00",
    }
    resp = _mock_response(data, status=201)
    session = _mock_session(resp)

    with patch("aiohttp.ClientSession", return_value=session):
        order = await adapter.place_order("buy", "market", 0.005)

    assert isinstance(order, Order)
    assert order.id == "abc-123"
    assert order.status == "filled"


@pytest.mark.asyncio
async def test_cancel_order(adapter):
    data = {
        "id": "abc-123", "symbol": "BTCUSDT", "side": "buy",
        "order_type": "limit", "quantity": "0.005", "status": "cancelled",
        "filled_qty": "0", "avg_fill_price": None, "fee": "0",
        "price": "94000.00", "stop_price": None,
        "created_at": "2026-04-03T00:00:00", "updated_at": "2026-04-03T00:00:01",
    }
    resp = _mock_response(data)
    session = _mock_session(resp)

    with patch("aiohttp.ClientSession", return_value=session):
        order = await adapter.cancel_order("abc-123")

    assert isinstance(order, Order)
    assert order.status == "cancelled"


@pytest.mark.asyncio
async def test_get_open_orders(adapter):
    data = [
        {
            "id": "o-1", "symbol": "BTCUSDT", "side": "buy",
            "order_type": "limit", "quantity": "0.01", "status": "open",
            "filled_qty": "0", "avg_fill_price": None, "fee": "0",
            "price": "94000.00", "stop_price": None,
            "created_at": "2026-04-03T00:00:00", "updated_at": None,
        },
    ]
    resp = _mock_response(data)
    session = _mock_session(resp)

    with patch("aiohttp.ClientSession", return_value=session):
        orders = await adapter.get_open_orders()

    assert len(orders) == 1
    assert isinstance(orders[0], Order)
    assert orders[0].status == "open"


@pytest.mark.asyncio
async def test_get_trades(adapter):
    data = [
        {
            "id": "t-1", "order_id": "o-1", "symbol": "BTCUSDT",
            "side": "buy", "quantity": "0.005", "price": "95200.00",
            "fee": "4.76", "realized_pnl": "0", "executed_at": "2026-04-03T00:00:00",
        },
    ]
    resp = _mock_response(data)
    session = _mock_session(resp)

    with patch("aiohttp.ClientSession", return_value=session):
        trades = await adapter.get_trades()

    assert len(trades) == 1
    assert isinstance(trades[0], Trade)
    assert trades[0].price == 95200.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_mockex_adapter.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'exchange.mockex'`

- [ ] **Step 3: Implement MockexAdapter REST methods**

```python
"""Mockex exchange adapter — connects to mockex via REST + WebSocket."""

import logging
from typing import Callable

import aiohttp

from exchange.base import BaseExchange
from core.models import Balance, Order, Position, Trade

log = logging.getLogger("traderbot.exchange.mockex")


class MockexAdapter(BaseExchange):
    """Exchange adapter for mockex paper trading server."""

    def __init__(self, base_url: str = "http://localhost:3000"):
        super().__init__()
        self._base_url = base_url.rstrip("/")
        self._ws = None
        self._ws_task = None

    async def connect(self) -> None:
        log.info("Connecting to mockex at %s", self._base_url)

    async def disconnect(self) -> None:
        log.info("Disconnected from mockex")

    async def place_order(
        self, side: str, order_type: str, quantity: float,
        price: float | None = None, stop_price: float | None = None,
    ) -> Order:
        body = {"side": side, "order_type": order_type, "quantity": quantity}
        if price is not None:
            body["price"] = price
        if stop_price is not None:
            body["stop_price"] = stop_price

        async with aiohttp.ClientSession() as session:
            async with session.post(f"{self._base_url}/api/orders", json=body) as resp:
                data = await resp.json()
                if resp.status >= 400:
                    raise ValueError(data.get("error", "Order failed"))
                return self._parse_order(data)

    async def cancel_order(self, order_id: str) -> Order:
        async with aiohttp.ClientSession() as session:
            async with session.delete(f"{self._base_url}/api/orders/{order_id}") as resp:
                data = await resp.json()
                if resp.status >= 400:
                    raise ValueError(data.get("error", "Cancel failed"))
                return self._parse_order(data)

    async def get_balance(self) -> Balance:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self._base_url}/api/account") as resp:
                data = await resp.json()
                return Balance(
                    cash=float(data.get("cash", 0)),
                    reserved=float(data.get("reserved", 0)),
                    position_value=float(data.get("position_value", 0)),
                )

    async def get_position(self) -> Position | None:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self._base_url}/api/positions") as resp:
                data = await resp.json()
                if not data or not data.get("symbol"):
                    return None
                return Position(
                    symbol=data["symbol"],
                    side=data["side"],
                    quantity=float(data["quantity"]),
                    entry_price=float(data["entry_price"]),
                )

    async def get_open_orders(self) -> list[Order]:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self._base_url}/api/orders", params={"status": "open"}) as resp:
                data = await resp.json()
                return [self._parse_order(o) for o in data]

    async def get_trades(self) -> list[Trade]:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self._base_url}/api/trades") as resp:
                data = await resp.json()
                return [self._parse_trade(t) for t in data]

    async def subscribe_market_data(self, callback: Callable) -> None:
        raise NotImplementedError("WebSocket subscription implemented in Task 6")

    @staticmethod
    def _parse_order(data: dict) -> Order:
        return Order(
            id=data["id"],
            symbol=data.get("symbol", "BTCUSDT"),
            side=data["side"],
            order_type=data["order_type"],
            quantity=float(data["quantity"]),
            status=data["status"],
            price=float(data["price"]) if data.get("price") else None,
            stop_price=float(data["stop_price"]) if data.get("stop_price") else None,
            filled_qty=float(data.get("filled_qty", 0)),
            avg_fill_price=float(data["avg_fill_price"]) if data.get("avg_fill_price") else None,
            fee=float(data.get("fee", 0)),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )

    @staticmethod
    def _parse_trade(data: dict) -> Trade:
        return Trade(
            id=data["id"],
            order_id=data.get("order_id", ""),
            symbol=data.get("symbol", "BTCUSDT"),
            side=data["side"],
            quantity=float(data["quantity"]),
            price=float(data["price"]),
            fee=float(data.get("fee", 0)),
            realized_pnl=float(data.get("realized_pnl", 0)),
            executed_at=data.get("executed_at"),
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_mockex_adapter.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
cd /home/fchrulk/apps
git add traderbot/exchange/mockex.py traderbot/tests/test_mockex_adapter.py
git commit -m "feat(traderbot): implement MockexAdapter REST methods (orders, balance, position, trades)"
```

---

### Task 6: Mockex Adapter — WebSocket Subscription

**Files:**
- Modify: `apps/traderbot/exchange/mockex.py`
- Create: `apps/traderbot/tests/test_mockex_ws.py`

- [ ] **Step 1: Write tests for WebSocket subscription**

```python
"""Tests for MockexAdapter WebSocket methods."""

import pytest
import pytest_asyncio
import asyncio
import json
from unittest.mock import AsyncMock, patch, MagicMock

from exchange.mockex import MockexAdapter


@pytest.mark.asyncio
async def test_subscribe_market_data_calls_callback():
    adapter = MockexAdapter(base_url="http://localhost:3000")
    received = []

    # Simulate a WS that yields two messages then closes
    mock_ws = AsyncMock()
    messages = [
        json.dumps({"stream": "btcusdt@trade", "data": {"p": "95200.00"}}),
        json.dumps({"stream": "btcusdt@kline_1s", "data": {"k": {"t": 1, "o": "95000", "h": "95500", "l": "94800", "c": "95200", "v": "1.5", "x": True}}}),
    ]

    async def fake_recv():
        if messages:
            return messages.pop(0)
        raise asyncio.CancelledError()

    mock_ws.recv = fake_recv
    mock_ws.close = AsyncMock()
    mock_ws.__aenter__ = AsyncMock(return_value=mock_ws)
    mock_ws.__aexit__ = AsyncMock(return_value=False)

    async def callback(msg):
        received.append(msg)

    with patch("websockets.connect", return_value=mock_ws):
        task = asyncio.create_task(adapter.subscribe_market_data(callback))
        await asyncio.sleep(0.1)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    assert len(received) == 2
    assert received[0]["stream"] == "btcusdt@trade"
    assert received[1]["stream"] == "btcusdt@kline_1s"


@pytest.mark.asyncio
async def test_ws_handles_trading_messages():
    adapter = MockexAdapter(base_url="http://localhost:3000")

    # Mock a trading message (order_update)
    order_data = {
        "type": "order_update",
        "data": {"id": "o-1", "status": "filled", "symbol": "BTCUSDT",
                 "side": "buy", "order_type": "market", "quantity": "0.005",
                 "filled_qty": "0.005", "avg_fill_price": "95200.00", "fee": "4.76"},
    }

    orders_received = []
    adapter.on_order_update = lambda o: orders_received.append(o)

    mock_ws = AsyncMock()
    messages = [json.dumps(order_data)]

    async def fake_recv():
        if messages:
            return messages.pop(0)
        raise asyncio.CancelledError()

    mock_ws.recv = fake_recv
    mock_ws.close = AsyncMock()
    mock_ws.__aenter__ = AsyncMock(return_value=mock_ws)
    mock_ws.__aexit__ = AsyncMock(return_value=False)

    with patch("websockets.connect", return_value=mock_ws):
        task = asyncio.create_task(adapter.subscribe_market_data(lambda msg: None))
        await asyncio.sleep(0.1)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    assert len(orders_received) == 1
    assert orders_received[0].id == "o-1"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_mockex_ws.py -v`
Expected: FAIL — `subscribe_market_data` raises `NotImplementedError`

- [ ] **Step 3: Implement WebSocket subscription in MockexAdapter**

Replace the `subscribe_market_data` method and add `connect`/`disconnect` logic in `exchange/mockex.py`. Add these imports at the top:

```python
import asyncio
import json
import websockets
```

Replace the `connect`, `disconnect`, and `subscribe_market_data` methods:

```python
    async def connect(self) -> None:
        log.info("Connecting to mockex at %s", self._base_url)
        # Connection is established lazily when subscribe_market_data is called

    async def disconnect(self) -> None:
        if self._ws_task:
            self._ws_task.cancel()
            try:
                await self._ws_task
            except asyncio.CancelledError:
                pass
            self._ws_task = None
        if self._ws:
            await self._ws.close()
            self._ws = None
        log.info("Disconnected from mockex")

    async def subscribe_market_data(self, callback: Callable) -> None:
        """Connect to mockex WebSocket and stream market data + trading events."""
        ws_url = self._base_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
        while True:
            try:
                log.info("Connecting to mockex WebSocket at %s", ws_url)
                async with websockets.connect(ws_url) as ws:
                    self._ws = ws
                    log.info("Connected to mockex WebSocket")
                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        # Market data streams have a "stream" key
                        if "stream" in msg:
                            await callback(msg)
                        # Trading messages have a "type" key
                        elif "type" in msg:
                            self._handle_trading_message(msg)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("Mockex WS error: %s — reconnecting in 3s", e)
            await asyncio.sleep(3)

    def _handle_trading_message(self, msg: dict) -> None:
        """Route trading messages to registered callbacks."""
        msg_type = msg.get("type")
        data = msg.get("data", {})

        if msg_type == "order_update" and self.on_order_update:
            self.on_order_update(self._parse_order(data))
        elif msg_type == "trade_executed" and self.on_trade_executed:
            self.on_trade_executed(self._parse_trade(data))
        elif msg_type == "balance_update" and self.on_balance_update:
            self.on_balance_update(Balance(
                cash=float(data.get("cash", 0)),
                reserved=float(data.get("reserved", 0)),
                position_value=float(data.get("position_value", 0)),
            ))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_mockex_ws.py -v`
Expected: 2 passed

- [ ] **Step 5: Run all tests**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/ -v`
Expected: All 17 tests passed

- [ ] **Step 6: Commit**

```bash
cd /home/fchrulk/apps
git add traderbot/exchange/mockex.py traderbot/tests/test_mockex_ws.py
git commit -m "feat(traderbot): add MockexAdapter WebSocket subscription with reconnect and trading message routing"
```

---

### Task 7: Exchange Factory

**Files:**
- Create: `apps/traderbot/exchange/factory.py`
- Create: `apps/traderbot/tests/test_exchange_factory.py`

- [ ] **Step 1: Write tests for exchange factory**

```python
"""Tests for exchange factory."""

import pytest
from exchange.factory import create_exchange
from exchange.mockex import MockexAdapter


def test_create_mockex_exchange():
    ex = create_exchange("mockex", mockex_url="http://localhost:3000")
    assert isinstance(ex, MockexAdapter)


def test_create_unknown_exchange():
    with pytest.raises(ValueError, match="Unknown exchange"):
        create_exchange("unknown_exchange")


def test_create_binance_not_yet_implemented():
    with pytest.raises(NotImplementedError, match="Binance adapter"):
        create_exchange("binance", binance_api_key="key", binance_api_secret="secret")


def test_create_binance_testnet_not_yet_implemented():
    with pytest.raises(NotImplementedError, match="Binance adapter"):
        create_exchange("binance_testnet", binance_api_key="key", binance_api_secret="secret")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_exchange_factory.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'exchange.factory'`

- [ ] **Step 3: Implement exchange factory**

```python
"""Factory for creating exchange adapters based on config."""

from exchange.base import BaseExchange
from exchange.mockex import MockexAdapter


def create_exchange(exchange_type: str, **kwargs) -> BaseExchange:
    """Create an exchange adapter based on type string.

    Args:
        exchange_type: One of 'mockex', 'binance_testnet', 'binance'.
        **kwargs: Adapter-specific config (mockex_url, binance_api_key, etc.)
    """
    if exchange_type == "mockex":
        return MockexAdapter(base_url=kwargs.get("mockex_url", "http://localhost:3000"))
    elif exchange_type in ("binance", "binance_testnet"):
        raise NotImplementedError("Binance adapter not yet implemented (Phase 5)")
    else:
        raise ValueError(f"Unknown exchange: {exchange_type}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_exchange_factory.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /home/fchrulk/apps
git add traderbot/exchange/factory.py traderbot/tests/test_exchange_factory.py
git commit -m "feat(traderbot): add exchange factory for adapter creation"
```

---

### Task 8: Wire Up Main Entry Point

**Files:**
- Modify: `apps/traderbot/main.py`
- Create: `apps/traderbot/tests/test_main.py`

- [ ] **Step 1: Write test for main startup**

```python
"""Tests for main entry point."""

import pytest
from unittest.mock import patch, AsyncMock

from exchange.factory import create_exchange
from exchange.mockex import MockexAdapter


def test_create_exchange_from_config():
    """Verify that config creates the right exchange adapter."""
    with patch("config.EXCHANGE", "mockex"), \
         patch("config.MOCKEX_URL", "http://localhost:3000"):
        import config
        ex = create_exchange(config.EXCHANGE, mockex_url=config.MOCKEX_URL)
        assert isinstance(ex, MockexAdapter)
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/test_main.py -v`
Expected: PASS

- [ ] **Step 3: Update main.py with async agent startup**

```python
#!/usr/bin/env python3
"""TraderBot — AI trading agent for BTC/USDT."""

import asyncio
import logging
import signal

import config
from exchange.factory import create_exchange

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("traderbot")


async def run():
    """Main async entry point."""
    log.info("TraderBot starting (exchange=%s)", config.EXCHANGE)

    # Create exchange adapter
    exchange = create_exchange(
        config.EXCHANGE,
        mockex_url=config.MOCKEX_URL,
        binance_api_key=config.BINANCE_API_KEY,
        binance_api_secret=config.BINANCE_API_SECRET,
    )

    # Connect to exchange
    await exchange.connect()
    log.info("Connected to %s", config.EXCHANGE)

    # Fetch initial state
    balance = await exchange.get_balance()
    log.info("Account balance: cash=%.2f, equity=%.2f", balance.cash, balance.equity)

    position = await exchange.get_position()
    if position:
        log.info("Open position: %s %s %.8f @ %.2f",
                 position.side, position.symbol, position.quantity, position.entry_price)
    else:
        log.info("No open position")

    log.info("TraderBot ready — strategy engine not yet implemented (Phase 2)")

    # Keep running until interrupted
    stop_event = asyncio.Event()
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop_event.set)

    await stop_event.wait()
    log.info("Shutting down...")
    await exchange.disconnect()
    log.info("TraderBot stopped")


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Verify it runs (requires mockex to be running)**

Run: `cd /home/fchrulk/apps/traderbot && timeout 5 python main.py || true`
Expected: Log output showing "TraderBot starting (exchange=mockex)", "Connected to mockex", balance info, then "ready"
(It will timeout after 5s or error if mockex isn't running — both are OK)

- [ ] **Step 5: Commit**

```bash
cd /home/fchrulk/apps
git add traderbot/main.py traderbot/tests/test_main.py
git commit -m "feat(traderbot): wire up main entry point with exchange connection and graceful shutdown"
```

---

### Task 9: Run Full Test Suite and Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the complete test suite**

Run: `cd /home/fchrulk/apps/traderbot && python -m pytest tests/ -v --tb=short`
Expected: All 22 tests pass

- [ ] **Step 2: Verify project structure**

Run: `find /home/fchrulk/apps/traderbot -type f -name "*.py" | sort`
Expected output:
```
/home/fchrulk/apps/traderbot/brain/__init__.py
/home/fchrulk/apps/traderbot/config.py
/home/fchrulk/apps/traderbot/core/__init__.py
/home/fchrulk/apps/traderbot/core/events.py
/home/fchrulk/apps/traderbot/core/models.py
/home/fchrulk/apps/traderbot/exchange/__init__.py
/home/fchrulk/apps/traderbot/exchange/base.py
/home/fchrulk/apps/traderbot/exchange/factory.py
/home/fchrulk/apps/traderbot/exchange/mockex.py
/home/fchrulk/apps/traderbot/main.py
/home/fchrulk/apps/traderbot/notify/__init__.py
/home/fchrulk/apps/traderbot/risk/__init__.py
/home/fchrulk/apps/traderbot/strategy/__init__.py
/home/fchrulk/apps/traderbot/tests/__init__.py
/home/fchrulk/apps/traderbot/tests/test_events.py
/home/fchrulk/apps/traderbot/tests/test_exchange_base.py
/home/fchrulk/apps/traderbot/tests/test_exchange_factory.py
/home/fchrulk/apps/traderbot/tests/test_main.py
/home/fchrulk/apps/traderbot/tests/test_mockex_adapter.py
/home/fchrulk/apps/traderbot/tests/test_mockex_ws.py
/home/fchrulk/apps/traderbot/tests/test_models.py
/home/fchrulk/apps/traderbot/utils/__init__.py
```

- [ ] **Step 3: Final commit if any cleanup was needed**

```bash
cd /home/fchrulk/apps
git add traderbot/
git status
# Only commit if there are changes
```

---

## Summary

Phase 1 creates 9 tasks that deliver:

| Task | What it builds | Tests |
|---|---|---|
| 1 | Project scaffold, config, .env, packages | Manual run |
| 2 | Data models (Candle, Signal, Order, Trade, Position, Balance) | 8 tests |
| 3 | Event bus (pub/sub) | 4 tests |
| 4 | Abstract BaseExchange interface | 3 tests |
| 5 | MockexAdapter REST methods | 7 tests |
| 6 | MockexAdapter WebSocket subscription | 2 tests |
| 7 | Exchange factory | 4 tests |
| 8 | Main entry point with async loop | 1 test |
| 9 | Full verification | All 22 tests |

After Phase 1, the agent can:
- Start up, connect to mockex, fetch balance/position/orders
- Stream market data via WebSocket
- Place and cancel orders via REST
- Receive trading updates (order fills, balance changes) via WebSocket
- Shut down gracefully

**Next:** Phase 2 (Strategy Framework) builds on this foundation to add candle aggregation, the strategy interface, and the EMA crossover strategy.
