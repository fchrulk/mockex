/**
 * Recent trades feed rendering.
 */

import { fmt } from './utils.js';
import { state, update } from './state.js';
import { scheduleChartDraw } from './chart.js';

let tradeRenderScheduled = false;

export function onTrade(d) {
  const price = parseFloat(d.p);
  const priceEl = document.getElementById('price');

  if (state.lastPrice > 0 && price !== state.lastPrice) {
    priceEl.classList.remove('flash-green', 'flash-red', 'pulse');
    void priceEl.offsetWidth; // force reflow
    priceEl.classList.add(price >= state.lastPrice ? 'flash-green' : 'flash-red', 'pulse');
  }
  update('lastPrice', price);
  priceEl.textContent = '$' + fmt(price);
  document.title = '$' + fmt(price) + ' | BTC/USDT';

  update('lastUpdateTime', Date.now());

  const trades = state.trades;
  trades.unshift({
    price: d.p,
    qty: d.q,
    time: new Date(d.T),
    buyer: d.m === false,
    isNew: true,
  });
  if (trades.length > 50) trades.length = 50;

  if (!tradeRenderScheduled) {
    tradeRenderScheduled = true;
    requestAnimationFrame(() => {
      tradeRenderScheduled = false;
      renderTrades();
    });
  }

  // Update last candle from trade data
  const candles = state.candles;
  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    last.c = price;
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
    scheduleChartDraw();
  }
}

function renderTrades() {
  const el = document.getElementById('trades-list');
  const displayTrades = state.trades.slice(0, 20);
  el.innerHTML = displayTrades
    .map((t) => {
      const cls = t.buyer ? 'buy' : 'sell';
      const newCls = t.isNew ? ' new-trade' : '';
      const time = t.time.toLocaleTimeString('en-US', { hour12: false });
      t.isNew = false;
      return `<div class="trade-row ${cls}${newCls} mono">
      <span class="trade-price">${fmt(parseFloat(t.price))}</span>
      <span class="trade-qty">${parseFloat(t.qty).toFixed(5)}</span>
      <span class="trade-time">${time}</span>
    </div>`;
    })
    .join('');
}
