"""REST API endpoints for AI trading signals."""

from aiohttp import web


async def handle_get_signals(request: web.Request) -> web.Response:
    """GET /api/signals — Active signals (last 30 minutes)."""
    signals = request.app["signals"]
    return web.json_response(signals.get_active_signals())


async def handle_get_signal_history(request: web.Request) -> web.Response:
    """GET /api/signals/history — Signal history with outcomes."""
    signals = request.app["signals"]
    history = await signals.get_signal_history()
    return web.json_response(history)


async def handle_get_analysis(request: web.Request) -> web.Response:
    """GET /api/analysis — Latest Claude analysis."""
    signals = request.app["signals"]
    analysis = signals.get_claude_analysis()
    if analysis:
        return web.json_response(analysis)
    return web.json_response({"status": "unavailable", "message": "No analysis available yet"})
