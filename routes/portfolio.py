"""REST API endpoints for portfolio analytics."""

from aiohttp import web


async def handle_get_portfolio(request: web.Request) -> web.Response:
    """GET /api/portfolio — Current portfolio metrics."""
    portfolio = request.app["portfolio"]
    metrics = await portfolio.get_metrics()
    return web.json_response(metrics)


async def handle_get_snapshots(request: web.Request) -> web.Response:
    """GET /api/portfolio/snapshots — Equity curve data with benchmark."""
    portfolio = request.app["portfolio"]
    from_ts = request.query.get("from")
    to_ts = request.query.get("to")
    data = await portfolio.get_snapshots(from_ts, to_ts)
    return web.json_response(data)


async def handle_get_portfolio_trades(request: web.Request) -> web.Response:
    """GET /api/portfolio/trades — Closed trades with PnL and duration."""
    portfolio = request.app["portfolio"]
    trades = await portfolio.get_closed_trades()
    return web.json_response(trades)
