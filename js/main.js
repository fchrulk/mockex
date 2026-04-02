/**
 * Application entry point.
 * Initializes all modules and starts the dashboard.
 */

import { state, subscribe, update } from './state.js';
import { loadCandles, MAX_CANDLES } from './api.js';
import { drawChart, scheduleChartDraw, initChartInteraction, getTimeframeMs, setTimeframe } from './chart.js';
import { connectProxy, setStreamHandlers, setTradingMessageHandler, getWs, onReconnect } from './websocket.js';
import { onTicker, startTimers } from './ticker.js';
import { onTrade } from './trades.js';
import { onDepth } from './orderbook.js';
import { initTrading, onTradingMessage, setTradingWs } from './trading.js';
import { initPortfolio } from './portfolio.js';
import { initIndicatorPanel } from './indicator-settings.js';

/**
 * Handle 1-second kline stream data.
 * Aggregates into the active timeframe's current candle.
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

  const tfMs = getTimeframeMs();
  const bucketT = Math.floor(candle.t / tfMs) * tfMs;
  const candles = state.candles;

  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    const lastBucket = Math.floor(last.t / tfMs) * tfMs;
    if (bucketT === lastBucket) {
      last.h = Math.max(last.h, candle.h);
      last.l = Math.min(last.l, candle.l);
      last.c = candle.c;
      last.v += candle.v;
    } else if (bucketT > lastBucket) {
      candles.push({
        t: bucketT,
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

// ── Timeframe buttons ──
function initTimeframeButtons() {
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tf = btn.dataset.tf;
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setTimeframe(tf);
      await loadCandles(tf);
      drawChart();
    });
  });
}

// ── Initialize ──
async function init() {
  startTimers();
  initChartInteraction();
  initTimeframeButtons();
  initIndicatorPanel();
  await loadCandles('1m');
  connectProxy();

  // Init trading panel after WS connects
  onReconnect((ws) => setTradingWs(ws));
  setTimeout(() => initTrading(getWs()), 500);

  // Init portfolio view
  initPortfolio();

  // Redraw chart on window resize
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawChart, 100);
  });
}

init();
