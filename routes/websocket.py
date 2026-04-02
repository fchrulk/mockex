"""WebSocket handler for browser clients."""

from aiohttp import web


async def handle_ws(request: web.Request) -> web.WebSocketResponse:
    """Accept a browser WebSocket connection and relay Binance data."""
    binance = request.app["binance"]
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    binance.add_client(ws)
    await binance.send_cached_to(ws)

    try:
        async for msg in ws:
            # Future: handle client messages (order placement, etc.)
            pass
    finally:
        binance.remove_client(ws)

    return ws
