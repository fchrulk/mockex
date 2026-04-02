"""Binance WebSocket relay and candle cache service."""

import asyncio
import json
import logging
import time

import aiohttp
from aiohttp import web
import websockets

from services import config

log = logging.getLogger("mockex.binance")


class BinanceService:
    """Maintains a persistent Binance WS connection and fans out to browser clients."""

    def __init__(self, matching_engine=None):
        self.browser_clients: set[web.WebSocketResponse] = set()
        self.latest_messages: dict[str, str] = {}
        self._candle_cache: dict[str, tuple[str, float]] = {}  # interval -> (json_str, timestamp)
        self._relay_task: asyncio.Task | None = None
        self._matching_engine = matching_engine

    async def start(self):
        """Start the Binance relay background task."""
        self._relay_task = asyncio.create_task(self._relay_loop())
        log.info("Binance relay started")

    async def stop(self):
        """Cancel the relay task and close all browser clients."""
        if self._relay_task:
            self._relay_task.cancel()
            try:
                await self._relay_task
            except asyncio.CancelledError:
                pass
        for client in list(self.browser_clients):
            await client.close()
        self.browser_clients.clear()
        log.info("Binance relay stopped")

    async def _relay_loop(self):
        """Maintain a persistent connection to Binance and fan-out to browsers."""
        while True:
            try:
                log.info("Connecting to Binance WebSocket...")
                async with websockets.connect(
                    config.BINANCE_WS_URL, ping_interval=20, ping_timeout=10
                ) as ws:
                    log.info("Connected to Binance WebSocket")
                    async for raw in ws:
                        data = json.loads(raw)
                        stream = data.get("stream", "")
                        payload = data.get("data", data)
                        tagged = json.dumps({"stream": stream, "data": payload})
                        self.latest_messages[stream] = tagged
                        await self._broadcast(tagged)

                        # Feed matching engine
                        if self._matching_engine:
                            await self._feed_matching(stream, payload)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("Binance WS error: %s — reconnecting in 3s", e)
            await asyncio.sleep(3)

    async def _broadcast(self, message: str):
        """Send a message to all connected browser clients."""
        dead = set()
        for client in self.browser_clients:
            try:
                await client.send_str(message)
            except Exception:
                dead.add(client)
        self.browser_clients -= dead

    def add_client(self, ws: web.WebSocketResponse):
        """Register a new browser client."""
        self.browser_clients.add(ws)
        log.info("Browser client connected (%d total)", len(self.browser_clients))

    def remove_client(self, ws: web.WebSocketResponse):
        """Unregister a browser client."""
        self.browser_clients.discard(ws)
        log.info("Browser client disconnected (%d remaining)", len(self.browser_clients))

    async def send_cached_to(self, ws: web.WebSocketResponse):
        """Send latest cached messages to a newly connected client."""
        for msg in self.latest_messages.values():
            try:
                await ws.send_str(msg)
            except Exception:
                break

    async def get_candles(self, interval: str = "1m") -> str | None:
        """Return cached candles for the given interval, refreshing if stale (>30s)."""
        cached = self._candle_cache.get(interval)
        if cached is None or (time.time() - cached[1]) > 30:
            await self._fetch_candles(interval)
        cached = self._candle_cache.get(interval)
        return cached[0] if cached else None

    async def _feed_matching(self, stream: str, data: dict):
        """Feed market data to the matching engine and check open orders."""
        engine = self._matching_engine
        symbol = config.BINANCE_SYMBOL

        if stream == f"{symbol}@depth10":
            bids = [[float(p), float(q)] for p, q in data.get("bids", [])]
            asks = [[float(p), float(q)] for p, q in data.get("asks", [])]
            engine.update_market_data(order_book={"bids": bids, "asks": asks})
            await engine.on_tick()
        elif stream == f"{symbol}@trade":
            price = float(data.get("p", 0))
            if price > 0:
                engine.update_market_data(last_price=price)

    async def _fetch_candles(self, interval: str = "1m"):
        """Fetch candles from Binance REST API for the given interval."""
        symbol = config.BINANCE_SYMBOL.upper()
        url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit=130"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    text = await resp.text()
                    self._candle_cache[interval] = (text, time.time())
                    log.info("Fetched %s candles (%d bytes)", interval, len(text))
        except Exception as e:
            log.warning("Failed to fetch %s candles: %s", interval, e)
