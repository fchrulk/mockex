"""Candle data REST endpoint with multi-timeframe support."""

from aiohttp import web

VALID_INTERVALS = {"1m", "5m", "15m", "1h", "4h", "1d"}


async def handle_candles(request: web.Request) -> web.Response:
    """Return cached candles as JSON. Accepts ?interval= query param."""
    binance = request.app["binance"]
    interval = request.query.get("interval", "1m")
    if interval not in VALID_INTERVALS:
        return web.json_response({"error": f"Invalid interval: {interval}"}, status=400)
    data = await binance.get_candles(interval=interval)
    if data:
        return web.Response(text=data, content_type="application/json")
    return web.Response(status=502, text="Failed to fetch candles")
