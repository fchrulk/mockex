"""REST API endpoints for paper trading."""

import json
import logging

from aiohttp import web

log = logging.getLogger("mockex.routes.trading")


async def handle_place_order(request: web.Request) -> web.Response:
    """POST /api/orders — Place a new order."""
    engine = request.app["matching"]
    body = await request.json()
    try:
        result = await engine.place_order(
            side=body["side"],
            order_type=body["order_type"],
            quantity=body["quantity"],
            price=body.get("price"),
            stop_price=body.get("stop_price"),
        )
        return web.json_response(result, status=201)
    except (ValueError, KeyError) as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_cancel_order(request: web.Request) -> web.Response:
    """DELETE /api/orders/:id — Cancel an open order."""
    engine = request.app["matching"]
    order_id = request.match_info["order_id"]
    try:
        result = await engine.cancel_order(order_id)
        return web.json_response(result)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=404)


async def handle_list_orders(request: web.Request) -> web.Response:
    """GET /api/orders — List orders, optionally filtered by status."""
    engine = request.app["matching"]
    status = request.query.get("status")
    orders = await engine.get_orders(status)
    return web.json_response(orders)


async def handle_get_positions(request: web.Request) -> web.Response:
    """GET /api/positions — Get current position."""
    engine = request.app["matching"]
    pos = engine.get_position()
    return web.json_response(pos if pos else {})


async def handle_get_trades(request: web.Request) -> web.Response:
    """GET /api/trades — Get trade history."""
    engine = request.app["matching"]
    trades = await engine.get_trades()
    return web.json_response(trades)


async def handle_get_account(request: web.Request) -> web.Response:
    """GET /api/account — Get account info."""
    engine = request.app["matching"]
    return web.json_response(engine.get_account_info())


async def handle_reset_account(request: web.Request) -> web.Response:
    """POST /api/account/reset — Reset account to initial state."""
    engine = request.app["matching"]
    try:
        result = await engine.reset_account()
        return web.json_response(result)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
