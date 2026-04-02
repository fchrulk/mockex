"""WebSocket handler for browser clients."""

import json
import logging

from aiohttp import web

log = logging.getLogger("mockex.routes.ws")


async def handle_ws(request: web.Request) -> web.WebSocketResponse:
    """Accept a browser WebSocket connection and relay Binance data + trading messages."""
    binance = request.app["binance"]
    engine = request.app.get("matching")
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    binance.add_client(ws)
    if engine:
        engine.browser_clients.add(ws)
    await binance.send_cached_to(ws)

    # Send initial trading state
    if engine:
        try:
            import json as _json
            await ws.send_str(_json.dumps({"type": "balance_update", "data": engine.get_account_info()}))
            pos = engine.get_position()
            if pos:
                await ws.send_str(_json.dumps({"type": "position_update", "data": pos}))
        except Exception:
            pass

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                await _handle_client_message(ws, engine, msg.data)
    finally:
        binance.remove_client(ws)
        if engine:
            engine.browser_clients.discard(ws)

    return ws


async def _handle_client_message(ws: web.WebSocketResponse, engine, raw: str):
    """Process incoming client messages (order placement, cancellation)."""
    if engine is None:
        await ws.send_str(json.dumps({"type": "error", "data": {"message": "Trading engine not available"}}))
        return

    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return

    msg_type = msg.get("type")
    data = msg.get("data", {})

    if msg_type == "place_order":
        try:
            result = await engine.place_order(
                side=data["side"],
                order_type=data["order_type"],
                quantity=data["quantity"],
                price=data.get("price"),
                stop_price=data.get("stop_price"),
            )
        except (ValueError, KeyError) as e:
            await ws.send_str(json.dumps({"type": "error", "data": {"message": str(e)}}))

    elif msg_type == "cancel_order":
        try:
            await engine.cancel_order(data["order_id"])
        except (ValueError, KeyError) as e:
            await ws.send_str(json.dumps({"type": "error", "data": {"message": str(e)}}))

    elif msg_type == "close_position":
        try:
            await engine.close_position()
        except ValueError as e:
            await ws.send_str(json.dumps({"type": "error", "data": {"message": str(e)}}))

    elif msg_type == "reset_account":
        try:
            await engine.reset_account()
        except ValueError as e:
            await ws.send_str(json.dumps({"type": "error", "data": {"message": str(e)}}))
