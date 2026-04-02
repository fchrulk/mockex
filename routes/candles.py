"""Candle data REST endpoint."""

from aiohttp import web


async def handle_candles(request: web.Request) -> web.Response:
    """Return cached 1-minute candles as JSON."""
    binance = request.app["binance"]
    data = await binance.get_candles()
    if data:
        return web.Response(text=data, content_type="application/json")
    return web.Response(status=502, text="Failed to fetch candles")
