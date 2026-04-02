"""Route registration and error middleware for the aiohttp application."""

import json
import logging

from aiohttp import web

from routes import websocket, candles, trading, portfolio, signals

log = logging.getLogger("mockex.routes")


@web.middleware
async def error_middleware(request, handler):
    """Catch unhandled exceptions and return JSON error responses."""
    try:
        return await handler(request)
    except web.HTTPException:
        raise  # Let aiohttp handle HTTP exceptions normally
    except Exception as e:
        log.exception("Unhandled error on %s %s", request.method, request.path)
        return web.json_response(
            {"error": str(e)}, status=500, content_type="application/json"
        )


def setup_routes(app: web.Application):
    """Register all route handlers and middleware on the app."""
    app.middlewares.append(error_middleware)
    app.router.add_get("/ws", websocket.handle_ws)
    app.router.add_get("/api/candles", candles.handle_candles)

    # Trading endpoints
    app.router.add_post("/api/orders", trading.handle_place_order)
    app.router.add_delete("/api/orders/{order_id}", trading.handle_cancel_order)
    app.router.add_get("/api/orders", trading.handle_list_orders)
    app.router.add_get("/api/positions", trading.handle_get_positions)
    app.router.add_get("/api/trades", trading.handle_get_trades)
    app.router.add_get("/api/account", trading.handle_get_account)
    app.router.add_post("/api/account/reset", trading.handle_reset_account)

    # Portfolio endpoints
    app.router.add_get("/api/portfolio", portfolio.handle_get_portfolio)
    app.router.add_get("/api/portfolio/snapshots", portfolio.handle_get_snapshots)
    app.router.add_get("/api/portfolio/trades", portfolio.handle_get_portfolio_trades)

    # Signal endpoints
    app.router.add_get("/api/signals", signals.handle_get_signals)
    app.router.add_get("/api/signals/history", signals.handle_get_signal_history)
    app.router.add_get("/api/analysis", signals.handle_get_analysis)
