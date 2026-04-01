#!/usr/bin/env python3
"""BTC Dashboard WebSocket proxy server.

Connects to Binance WebSocket streams server-side and relays data to
browser clients over a local WebSocket. Also serves static files and
proxies the initial candles REST endpoint.
"""

import asyncio
import json
import logging
import signal
import time
from pathlib import Path

import aiohttp
from aiohttp import web
import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("btc-proxy")

PORT = 3000
STATIC_DIR = Path(__file__).parent

BINANCE_WS_STREAMS = [
    "btcusdt@trade",
    "btcusdt@kline_1s",
    "btcusdt@ticker",
    "btcusdt@depth10",
]
BINANCE_WS_URL = "wss://stream.binance.com:9443/stream?streams=" + "/".join(BINANCE_WS_STREAMS)
BINANCE_CANDLES_URL = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=100"

# ── State ──
browser_clients: set[web.WebSocketResponse] = set()
latest_messages: dict[str, str] = {}  # stream -> last message (for new client catch-up)
cached_candles: str | None = None
cached_candles_ts: float = 0


# ── Binance upstream connection ──
async def binance_relay():
    """Maintain a persistent connection to Binance and fan-out to browsers."""
    while True:
        try:
            log.info("Connecting to Binance WebSocket...")
            async with websockets.connect(BINANCE_WS_URL, ping_interval=20, ping_timeout=10) as ws:
                log.info("Connected to Binance WebSocket")
                async for raw in ws:
                    data = json.loads(raw)
                    stream = data.get("stream", "")
                    # Tag the message with stream name for the browser
                    tagged = json.dumps({"stream": stream, "data": data.get("data", data)})
                    latest_messages[stream] = tagged
                    # Fan-out
                    dead = set()
                    for client in browser_clients:
                        try:
                            await client.send_str(tagged)
                        except Exception:
                            dead.add(client)
                    browser_clients -= dead
        except Exception as e:
            log.warning("Binance WS error: %s — reconnecting in 3s", e)
        await asyncio.sleep(3)


# ── Candles cache ──
async def fetch_candles():
    global cached_candles, cached_candles_ts
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(BINANCE_CANDLES_URL) as resp:
                cached_candles = await resp.text()
                cached_candles_ts = time.time()
                log.info("Fetched initial candles (%d bytes)", len(cached_candles))
    except Exception as e:
        log.warning("Failed to fetch candles: %s", e)


# ── HTTP handlers ──
async def handle_ws(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    browser_clients.add(ws)
    log.info("Browser client connected (%d total)", len(browser_clients))

    # Send latest cached messages so the client gets immediate data
    for msg in latest_messages.values():
        try:
            await ws.send_str(msg)
        except Exception:
            break

    try:
        async for msg in ws:
            pass  # Browser doesn't send anything meaningful
    finally:
        browser_clients.discard(ws)
        log.info("Browser client disconnected (%d remaining)", len(browser_clients))
    return ws


async def handle_candles(request):
    global cached_candles, cached_candles_ts
    # Refresh if stale (> 30s)
    if cached_candles is None or (time.time() - cached_candles_ts) > 30:
        await fetch_candles()
    if cached_candles:
        return web.Response(text=cached_candles, content_type="application/json")
    return web.Response(status=502, text="Failed to fetch candles")


async def handle_index(request):
    return web.FileResponse(STATIC_DIR / "index.html")


# ── App setup ──
async def on_startup(app):
    await fetch_candles()
    app["binance_task"] = asyncio.create_task(binance_relay())


async def on_cleanup(app):
    app["binance_task"].cancel()
    for client in browser_clients:
        await client.close()


def main():
    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    app.router.add_get("/ws", handle_ws)
    app.router.add_get("/api/candles", handle_candles)
    app.router.add_get("/", handle_index)
    app.router.add_static("/", STATIC_DIR, show_index=False)

    log.info("Starting server on port %d", PORT)
    web.run_app(app, host="0.0.0.0", port=PORT, print=lambda _: log.info("Server ready on http://localhost:%d", PORT))


if __name__ == "__main__":
    main()
