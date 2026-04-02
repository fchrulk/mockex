/**
 * Price display, 24h stats, header status updates.
 */

import { fmt, fmtK, setColor } from './utils.js';
import { state, update } from './state.js';

export function onTicker(d) {
  const change = parseFloat(d.p);
  const pct = parseFloat(d.P);
  const changeEl = document.getElementById('s-change');
  const pctEl = document.getElementById('s-pct');
  changeEl.textContent = (change >= 0 ? '+' : '') + fmt(change);
  pctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  setColor(changeEl, change);
  setColor(pctEl, pct);
  document.getElementById('s-high').textContent = fmt(parseFloat(d.h));
  document.getElementById('s-low').textContent = fmt(parseFloat(d.l));
  document.getElementById('s-vol').textContent = fmtK(d.q) + ' USDT';
  update('lastUpdateTime', Date.now());
}

/** Start the periodic UI timers (last-update display, footer clock). */
export function startTimers() {
  // "Last update" display
  setInterval(() => {
    if (!state.lastUpdateTime) return;
    const el = document.getElementById('last-update');
    const ago = Math.floor((Date.now() - state.lastUpdateTime) / 1000);
    if (ago < 2) {
      el.textContent = 'Just now';
      document.getElementById('live-badge').style.display = 'flex';
    } else if (ago < 60) {
      el.textContent = `Updated ${ago}s ago`;
    } else {
      el.textContent = `Updated ${Math.floor(ago / 60)}m ago`;
    }
    if (ago > 5) document.getElementById('live-badge').style.display = 'none';
  }, 1000);

  // Footer clock
  setInterval(() => {
    const now = new Date();
    const tz = now.getTimezoneOffset();
    document.getElementById('footer-time').textContent =
      now.toLocaleTimeString('en-US', { hour12: false }) +
      ' UTC' +
      (tz > 0 ? '-' : '+') +
      Math.abs(tz / 60);
  }, 1000);
}
