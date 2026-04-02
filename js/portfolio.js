/**
 * Portfolio dashboard: metrics cards, equity curve, PnL-by-trade chart, trade log.
 * Toggles between trading view and portfolio view (SPA).
 */

import { fmt } from './utils.js';

let _visible = false;
let _metrics = {};
let _snapshots = { snapshots: [], benchmark: [] };
let _trades = [];
let _sortCol = 'executed_at';
let _sortAsc = false;
let _timeRange = 'ALL';

// ── View Toggle ──

export function initPortfolio() {
  document.getElementById('nav-trading')?.addEventListener('click', () => _setView('trading'));
  document.getElementById('nav-portfolio')?.addEventListener('click', () => _setView('portfolio'));

  // Time range buttons
  document.getElementById('portfolio-view')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('time-range-btn')) {
      _timeRange = e.target.dataset.range;
      document.querySelectorAll('.time-range-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      _fetchSnapshots().then(() => _drawEquityCurve());
    }
  });
}

function _setView(view) {
  const tradingEls = document.querySelectorAll('.grid, .wallet-bar, .trading-panel');
  const portfolioEl = document.getElementById('portfolio-view');
  const navTrading = document.getElementById('nav-trading');
  const navPortfolio = document.getElementById('nav-portfolio');

  if (view === 'portfolio') {
    tradingEls.forEach(el => el.style.display = 'none');
    portfolioEl.style.display = 'block';
    navTrading.classList.remove('active');
    navPortfolio.classList.add('active');
    _visible = true;
    _refreshAll();
  } else {
    tradingEls.forEach(el => el.style.display = '');
    portfolioEl.style.display = 'none';
    navTrading.classList.add('active');
    navPortfolio.classList.remove('active');
    _visible = false;
  }
}

async function _refreshAll() {
  await Promise.all([_fetchMetrics(), _fetchSnapshots(), _fetchTrades()]);
  _renderMetrics();
  _drawEquityCurve();
  _drawPnlChart();
  _renderTradeLog();
}

// ── Data Fetching ──

async function _fetchMetrics() {
  try {
    const resp = await fetch('/api/portfolio');
    _metrics = await resp.json();
  } catch (e) {
    console.error('Failed to load portfolio metrics:', e);
  }
}

async function _fetchSnapshots() {
  try {
    let url = '/api/portfolio/snapshots';
    if (_timeRange !== 'ALL') {
      const now = new Date();
      const from = new Date(now);
      if (_timeRange === '1D') from.setDate(from.getDate() - 1);
      else if (_timeRange === '1W') from.setDate(from.getDate() - 7);
      else if (_timeRange === '1M') from.setMonth(from.getMonth() - 1);
      url += `?from=${from.toISOString()}`;
    }
    const resp = await fetch(url);
    _snapshots = await resp.json();
  } catch (e) {
    console.error('Failed to load snapshots:', e);
  }
}

async function _fetchTrades() {
  try {
    const resp = await fetch('/api/portfolio/trades');
    _trades = await resp.json();
  } catch (e) {
    console.error('Failed to load portfolio trades:', e);
  }
}

// ── Metrics Cards ──

function _renderMetrics() {
  const m = _metrics;
  _setText('pm-equity', '$' + fmt(m.total_equity || 0));
  _setText('pm-pnl', (m.total_pnl >= 0 ? '+$' : '-$') + fmt(Math.abs(m.total_pnl || 0)));
  _setText('pm-roi', (m.roi_pct >= 0 ? '+' : '') + fmt(m.roi_pct || 0, 2) + '%');
  _setColor('pm-pnl', m.total_pnl);
  _setColor('pm-roi', m.roi_pct);

  _setText('pm-winrate', fmt(m.win_rate || 0, 1) + '%');
  _setText('pm-wincount', `${m.winning_trades || 0}/${m.total_trades || 0}`);

  _setText('pm-sharpe', fmt(m.sharpe_ratio || 0, 2));
  const sharpeEl = document.getElementById('pm-sharpe');
  if (sharpeEl) {
    const s = m.sharpe_ratio || 0;
    sharpeEl.style.color = s > 1 ? 'var(--green)' : s >= 0.5 ? 'var(--yellow)' : 'var(--red)';
  }

  _setText('pm-drawdown', fmt(m.max_drawdown_pct || 0, 2) + '%');
  _setText('pm-profitfactor', fmt(m.profit_factor || 0, 2));
  const pfEl = document.getElementById('pm-profitfactor');
  if (pfEl) {
    pfEl.style.color = (m.profit_factor || 0) > 1.5 ? 'var(--green)' : 'var(--text)';
  }
}

// ── Equity Curve ──

function _drawEquityCurve() {
  const canvas = document.getElementById('equity-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = 280 * devicePixelRatio;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '280px';
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const W = rect.width;
  const H = 280;
  const pad = { top: 20, right: 60, bottom: 30, left: 80 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const snaps = _snapshots.snapshots || [];
  const bench = _snapshots.benchmark || [];
  if (snaps.length < 2) {
    ctx.fillStyle = '#4d5f7a';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Not enough data — snapshots taken every 5 minutes', W / 2, H / 2);
    return;
  }

  const equities = snaps.map(s => s.equity);
  const benchValues = bench.map(b => b.value);
  const allValues = [...equities, ...benchValues];
  const initial = _metrics.total_equity ? parseFloat(_metrics.total_equity) - parseFloat(_metrics.total_pnl || 0) : 100000;

  const minY = Math.min(...allValues, initial) * 0.998;
  const maxY = Math.max(...allValues, initial) * 1.002;
  const rangeY = maxY - minY || 1;

  const x = (i) => pad.left + (i / (snaps.length - 1)) * cw;
  const y = (v) => pad.top + (1 - (v - minY) / rangeY) * ch;

  // Grid lines
  ctx.strokeStyle = '#1a2438';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = pad.top + (i / 4) * ch;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(W - pad.right, gy);
    ctx.stroke();

    const val = maxY - (i / 4) * rangeY;
    ctx.fillStyle = '#4d5f7a';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('$' + fmt(val, 0), pad.left - 8, gy + 3);
  }

  // Breakeven line
  ctx.strokeStyle = 'rgba(255,214,0,0.3)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, y(initial));
  ctx.lineTo(W - pad.right, y(initial));
  ctx.stroke();
  ctx.setLineDash([]);

  // Benchmark line (gray dashed)
  if (benchValues.length > 1) {
    ctx.strokeStyle = 'rgba(132,148,178,0.5)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    benchValues.forEach((v, i) => {
      i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Portfolio line with gradient fill
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#00d4ff';
  ctx.beginPath();
  equities.forEach((v, i) => {
    i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v));
  });
  ctx.stroke();

  // Fill area
  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, 'rgba(0,212,255,0.15)');
  grad.addColorStop(1, 'rgba(0,212,255,0.01)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  equities.forEach((v, i) => {
    i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v));
  });
  ctx.lineTo(x(equities.length - 1), H - pad.bottom);
  ctx.lineTo(pad.left, H - pad.bottom);
  ctx.closePath();
  ctx.fill();

  // X-axis time labels
  ctx.fillStyle = '#4d5f7a';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(snaps.length / 6));
  for (let i = 0; i < snaps.length; i += step) {
    const d = new Date(snaps[i].timestamp);
    const label = _timeRange === '1D'
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    ctx.fillText(label, x(i), H - pad.bottom + 18);
  }

  // Legend
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#00d4ff';
  ctx.fillRect(W - pad.right - 120, 8, 12, 3);
  ctx.fillText('Portfolio', W - pad.right - 104, 13);
  ctx.fillStyle = '#8494b2';
  ctx.fillRect(W - pad.right - 120, 22, 12, 3);
  ctx.fillText('Buy & Hold', W - pad.right - 104, 27);
}

// ── PnL by Trade Chart ──

function _drawPnlChart() {
  const canvas = document.getElementById('pnl-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = 160 * devicePixelRatio;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '160px';
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const W = rect.width;
  const H = 160;
  const pad = { top: 10, right: 20, bottom: 20, left: 60 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const sellTrades = _trades.filter(t => t.side === 'sell' && t.pnl !== null);
  if (sellTrades.length === 0) {
    ctx.fillStyle = '#4d5f7a';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No closed trades yet', W / 2, H / 2);
    return;
  }

  // Reverse so oldest first
  const ordered = [...sellTrades].reverse();
  const pnls = ordered.map(t => t.pnl);
  const maxAbs = Math.max(...pnls.map(Math.abs), 1);

  const barW = Math.max(2, Math.min(20, (cw - ordered.length) / ordered.length));
  const gap = Math.max(1, (cw - barW * ordered.length) / (ordered.length + 1));
  const zeroY = pad.top + ch / 2;

  // Zero line
  ctx.strokeStyle = '#364863';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, zeroY);
  ctx.lineTo(W - pad.right, zeroY);
  ctx.stroke();

  // Bars
  ordered.forEach((t, i) => {
    const bx = pad.left + gap + i * (barW + gap);
    const barH = (Math.abs(t.pnl) / maxAbs) * (ch / 2 - 4);
    const by = t.pnl >= 0 ? zeroY - barH : zeroY;
    ctx.fillStyle = t.pnl >= 0 ? '#00e87b' : '#ff2952';
    ctx.fillRect(bx, by, barW, barH);
  });

  // Y-axis labels
  ctx.fillStyle = '#4d5f7a';
  ctx.font = '10px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('+$' + fmt(maxAbs, 0), pad.left - 6, pad.top + 10);
  ctx.fillText('$0', pad.left - 6, zeroY + 3);
  ctx.fillText('-$' + fmt(maxAbs, 0), pad.left - 6, H - pad.bottom);
}

// ── Trade Log ──

function _renderTradeLog() {
  const el = document.getElementById('trade-log-body');
  if (!el) return;

  const sellTrades = _trades.filter(t => t.side === 'sell' && t.pnl !== null);

  if (sellTrades.length === 0) {
    el.innerHTML = '<tr><td colspan="8" class="trading-empty">No closed trades</td></tr>';
    return;
  }

  // Sort
  const sorted = [...sellTrades].sort((a, b) => {
    let va = a[_sortCol], vb = b[_sortCol];
    if (typeof va === 'string') va = va || '';
    if (typeof vb === 'string') vb = vb || '';
    if (va < vb) return _sortAsc ? -1 : 1;
    if (va > vb) return _sortAsc ? 1 : -1;
    return 0;
  });

  el.innerHTML = sorted.map(t => {
    const pnlClass = (t.pnl || 0) >= 0 ? 'pnl-positive' : 'pnl-negative';
    const pnlSign = (t.pnl || 0) >= 0 ? '+' : '';
    const date = t.executed_at ? new Date(t.executed_at).toLocaleString() : '-';
    const dur = t.duration_seconds != null ? _fmtDuration(t.duration_seconds) : '-';
    return `<tr>
      <td class="mono">${date}</td>
      <td><span class="side-badge sell">SELL</span></td>
      <td class="mono">${t.entry_price != null ? '$' + fmt(t.entry_price) : '-'}</td>
      <td class="mono">$${fmt(t.exit_price)}</td>
      <td class="mono">${t.quantity.toFixed(6)}</td>
      <td class="mono">$${fmt(t.fee)}</td>
      <td class="mono ${pnlClass}">${pnlSign}$${fmt(t.pnl || 0)}</td>
      <td class="mono">${dur}</td>
    </tr>`;
  }).join('');

  // Bind sort headers
  document.querySelectorAll('#trade-log-head th[data-sort]').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.sort;
      if (_sortCol === col) _sortAsc = !_sortAsc;
      else { _sortCol = col; _sortAsc = false; }
      _renderTradeLog();
    };
  });
}

// ── Helpers ──

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _setColor(id, value) {
  const el = document.getElementById(id);
  if (el) {
    const v = parseFloat(value || 0);
    el.style.color = v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text)';
  }
}

function _fmtDuration(seconds) {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
  return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
}
