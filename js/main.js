/**
 * Application entry point.
 * Initializes all modules and starts the dashboard.
 */

import { state, subscribe } from './state.js';
import { loadCandles, MAX_CANDLES } from './api.js';
import { drawChart, scheduleChartDraw, initChartInteraction } from './chart.js';
import { connectProxy, setStreamHandlers, setTradingMessageHandler, getWs, onReconnect } from './websocket.js';
import { onTicker, startTimers } from './ticker.js';
import { onTrade } from './trades.js';
import { onDepth } from './orderbook.js';
import { initTrading, onTradingMessage, setTradingWs } from './trading.js';

/**
 * Handle 1-second kline stream data.
 * Aggregates into 1-minute candles.
 */
function onKline(d) {
  const k = d.k;
  const candle = {
    t: k.t,
    o: parseFloat(k.o),
    h: parseFloat(k.h),
    l: parseFloat(k.l),
    c: parseFloat(k.c),
    v: parseFloat(k.v),
  };
  const minuteT = Math.floor(candle.t / 60000) * 60000;
  const candles = state.candles;

  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    const lastMinute = Math.floor(last.t / 60000) * 60000;
    if (minuteT === lastMinute) {
      last.h = Math.max(last.h, candle.h);
      last.l = Math.min(last.l, candle.l);
      last.c = candle.c;
      last.v = candle.v;
    } else if (minuteT > lastMinute) {
      candles.push({
        t: minuteT,
        o: candle.o,
        h: candle.h,
        l: candle.l,
        c: candle.c,
        v: candle.v,
      });
      if (candles.length > MAX_CANDLES) candles.shift();
    }
  }
  scheduleChartDraw();
}

// ── Register stream handlers ──
setStreamHandlers({
  'btcusdt@trade': onTrade,
  'btcusdt@kline_1s': onKline,
  'btcusdt@ticker': onTicker,
  'btcusdt@depth10': onDepth,
});

// ── Register trading message handler ──
setTradingMessageHandler(onTradingMessage);

// ── Subscribe to state changes that require chart redraws ──
subscribe('candles', () => drawChart());

// ── Initialize ──
async function init() {
  startTimers();
  initChartInteraction();
  await loadCandles();
  connectProxy();

  // Init trading panel after WS connects
  onReconnect((ws) => setTradingWs(ws));
  setTimeout(() => initTrading(getWs()), 500);

  // Redraw chart on window resize
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawChart, 100);
  });
}

init();
