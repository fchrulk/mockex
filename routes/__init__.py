"""Route registration and error middleware for the aiohttp application."""

import json
import logging

from aiohttp import web

from routes import websocket, candles

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
