/**
 * Order book rendering.
 */

import { fmt } from './utils.js';
import { update } from './state.js';

let depthRenderScheduled = false;
let pendingDepth = null;

export function onDepth(d) {
  if (depthRenderScheduled) {
    pendingDepth = d;
    return;
  }
  depthRenderScheduled = true;
  pendingDepth = null;
  requestAnimationFrame(() => {
    depthRenderScheduled = false;
    renderDepth(pendingDepth || d);
  });
  renderDepth(d);
}

function renderDepth(d) {
  const asks = d.asks.slice(0, 10).reverse();
  const bids = d.bids.slice(0, 10);
  const maxQty = Math.max(
    ...asks.map((a) => parseFloat(a[1])),
    ...bids.map((b) => parseFloat(b[1]))
  );

  document.getElementById('asks').innerHTML = asks
    .map((a) => {
      const pct = ((parseFloat(a[1]) / maxQty) * 100).toFixed(0);
      return `<div class="ob-row ask mono"><div class="ob-bg" style="width:${pct}%"></div><span class="ob-price" style="color:var(--red)">${fmt(parseFloat(a[0]))}</span><span class="ob-qty">${parseFloat(a[1]).toFixed(5)}</span></div>`;
    })
    .join('');

  document.getElementById('bids').innerHTML = bids
    .map((b) => {
      const pct = ((parseFloat(b[1]) / maxQty) * 100).toFixed(0);
      return `<div class="ob-row bid mono"><div class="ob-bg" style="width:${pct}%"></div><span class="ob-price" style="color:var(--green)">${fmt(parseFloat(b[0]))}</span><span class="ob-qty">${parseFloat(b[1]).toFixed(5)}</span></div>`;
    })
    .join('');

  if (d.asks.length && d.bids.length) {
    const bestAsk = parseFloat(d.asks[0][0]);
    const bestBid = parseFloat(d.bids[0][0]);
    const spread = bestAsk - bestBid;
    const spreadPct = ((spread / bestAsk) * 100).toFixed(4);
    document.getElementById('ob-spread').textContent = `Spread: $${fmt(spread)} (${spreadPct}%)`;
    document.getElementById('s-spread').textContent = '$' + fmt(spread);
  }

  update('lastUpdateTime', Date.now());
}
