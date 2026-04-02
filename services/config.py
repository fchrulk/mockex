"""Application configuration loaded from .env with defaults."""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)


def _get(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _int(key: str, default: int = 0) -> int:
    return int(_get(key, str(default)))


# Server
PORT = _int("PORT", 3000)
LOG_LEVEL = _get("LOG_LEVEL", "INFO")

# Database
DB_HOST = _get("DB_HOST", "127.0.0.1")
DB_PORT = _int("DB_PORT", 5432)
DB_NAME = _get("DB_NAME", "financial")
DB_USER = _get("DB_USER", "fchrulk")
DB_PASSWORD = _get("DB_PASSWORD", "")
DB_SCHEMA = _get("DB_SCHEMA", "mockex")

# Binance
BINANCE_SYMBOL = _get("BINANCE_SYMBOL", "btcusdt")
BINANCE_WS_URL = (
    f"wss://stream.binance.com:9443/stream?streams="
    f"{BINANCE_SYMBOL}@trade/{BINANCE_SYMBOL}@kline_1s/"
    f"{BINANCE_SYMBOL}@ticker/{BINANCE_SYMBOL}@depth10"
)
BINANCE_CANDLES_URL = (
    f"https://api.binance.com/api/v3/klines"
    f"?symbol={BINANCE_SYMBOL.upper()}&interval=1m&limit=100"
)
