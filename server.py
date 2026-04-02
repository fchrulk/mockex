#!/usr/bin/env python3
"""Mockex — BTC/USDT real-time trading dashboard server.

Entry point that wires up routes, services, and static file serving.
"""

import logging
from pathlib import Path

from aiohttp import web

from services import config
from services.binance import BinanceService
from services.matching import MatchingEngine
from services import db
from routes import setup_routes

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("mockex")

STATIC_DIR = Path(__file__).parent


async def on_startup(app: web.Application):
    """Initialize services on server start."""
    # Database
    try:
        await db.init_pool()
    except Exception as e:
        log.warning("Database unavailable: %s — running without DB", e)

    # Matching engine
    matching = MatchingEngine()
    await matching.init()
    app["matching"] = matching

    # Binance relay
    binance = BinanceService(matching_engine=matching)
    app["binance"] = binance
    await binance.start()


async def on_cleanup(app: web.Application):
    """Shut down services gracefully."""
    binance = app.get("binance")
    if binance:
        await binance.stop()
    await db.close_pool()


def main():
    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    setup_routes(app)

    # Static files and index — must be last (catch-all)
    app.router.add_get("/", lambda r: web.FileResponse(STATIC_DIR / "index.html"))
    app.router.add_static("/", STATIC_DIR, show_index=False)

    log.info("Starting Mockex on port %d", config.PORT)
    web.run_app(
        app,
        host="0.0.0.0",
        port=config.PORT,
        print=lambda _: log.info("Server ready on http://localhost:%d", config.PORT),
    )


if __name__ == "__main__":
    main()
