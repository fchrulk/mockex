/**
 * AI Trading Signals: analysis card, active signals list, signal history.
 */

import { fmt } from './utils.js';

let _analysis = null;
let _activeSignals = [];
let _signalHistory = [];

// ── Init ──
export function initSignals() {
  _fetchInitialData();
}

// ── WebSocket message handler ──
export function onSignalMessage(msg) {
  if (msg.type === 'signal') {
    _activeSignals.unshift(msg.data);
    if (_activeSignals.length > 20) _activeSignals.pop();
    _renderActiveSignals();
  } else if (msg.type === 'ai_analysis') {
    _analysis = msg.data;
    _renderAnalysis();
  }
}

// ── Data fetching ──
async function _fetchInitialData() {
  try {
    const [sigResp, anaResp] = await Promise.all([
      fetch('/api/signals'),
      fetch('/api/analysis'),
    ]);
    _activeSignals = await sigResp.json();
    const ana = await anaResp.json();
    if (ana.trend) _analysis = ana;
  } catch (e) {
    console.error('Failed to load signal data:', e);
  }
  _renderAnalysis();
  _renderActiveSignals();
}

// ── AI Analysis Card ──
function _renderAnalysis() {
  const el = document.getElementById('ai-analysis');
  if (!el) return;

  if (!_analysis || !_analysis.trend) {
    const hasKey = true; // We can't check server-side from here
    el.innerHTML = `<div class="analysis-empty">AI Analysis awaiting data...</div>`;
    return;
  }

  const a = _analysis;
  const trendClass = a.trend === 'bullish' ? 'trend-bull' : a.trend === 'bearish' ? 'trend-bear' : 'trend-neutral';
  const riskClass = a.risk === 'low' ? 'risk-low' : a.risk === 'high' ? 'risk-high' : 'risk-med';
  const age = a.timestamp ? _timeAgo(new Date(a.timestamp)) : '';
  const support = (a.key_levels?.support || []).map(p => '$' + fmt(p)).join(' / ') || '-';
  const resistance = (a.key_levels?.resistance || []).map(p => '$' + fmt(p)).join(' / ') || '-';

  el.innerHTML = `
    <div class="analysis-header">
      <span class="analysis-badge ${trendClass}">${a.trend.toUpperCase()}</span>
      <span class="analysis-badge ${riskClass}">${(a.risk || 'medium').toUpperCase()}</span>
      <span class="analysis-age">${age}</span>
    </div>
    <div class="analysis-text">${a.analysis || ''}</div>
    <div class="analysis-levels">
      <div><span class="level-label">Support:</span> <span class="mono">${support}</span></div>
      <div><span class="level-label">Resistance:</span> <span class="mono">${resistance}</span></div>
    </div>
    <div class="analysis-suggestion">${a.suggestion || ''}</div>
    <div class="analysis-confidence">
      <span>Confidence: ${a.confidence || 0}%</span>
      <div class="confidence-bar"><div class="confidence-fill" style="width:${a.confidence || 0}%"></div></div>
    </div>
  `;
}

// ── Active Signals List ──
function _renderActiveSignals() {
  const el = document.getElementById('active-signals');
  if (!el) return;

  if (_activeSignals.length === 0) {
    el.innerHTML = '<div class="signals-empty">No active signals</div>';
    return;
  }

  el.innerHTML = _activeSignals.map(s => {
    const icon = s.direction === 'buy' ? '&#9650;' : s.direction === 'sell' ? '&#9660;' : '&#9888;';
    const dirClass = s.direction === 'buy' ? 'sig-buy' : s.direction === 'sell' ? 'sig-sell' : 'sig-neutral';
    const age = s.timestamp ? _timeAgo(new Date(s.timestamp)) : '';
    const label = s.signal_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<div class="signal-item ${dirClass}">
      <div class="signal-top">
        <span class="signal-icon">${icon}</span>
        <span class="signal-dir">${s.direction.toUpperCase()}</span>
        <span class="signal-type">${label}</span>
        <span class="signal-conf">${s.confidence}%</span>
      </div>
      <div class="signal-detail">${s.reasoning} <span class="signal-age">${age}</span></div>
    </div>`;
  }).join('');
}

// ── Signal History (for portfolio view) ──
export async function renderSignalHistory(container) {
  if (!container) return;
  try {
    const resp = await fetch('/api/signals/history');
    _signalHistory = await resp.json();
  } catch { /* ignore */ }

  if (_signalHistory.length === 0) {
    container.innerHTML = '<div class="trading-empty">No signal history</div>';
    return;
  }

  // Summary stats
  const total = _signalHistory.length;
  const resolved = _signalHistory.filter(s => s.outcome !== 'pending');
  const correct = resolved.filter(s => s.outcome === 'correct').length;
  const accuracy = resolved.length > 0 ? (correct / resolved.length * 100).toFixed(1) : '0.0';
  const avgConf = (total > 0 ? _signalHistory.reduce((s, x) => s + x.confidence, 0) / total : 0).toFixed(0);

  const rows = _signalHistory.map(s => {
    const outcomeIcon = s.outcome === 'correct' ? '<span style="color:var(--green)">&#10003;</span>'
      : s.outcome === 'incorrect' ? '<span style="color:var(--red)">&#10007;</span>'
      : '<span style="color:var(--text3)">&#9201;</span>';
    const dirClass = s.direction === 'buy' ? 'buy' : s.direction === 'sell' ? 'sell' : '';
    const time = s.created_at ? new Date(s.created_at).toLocaleString() : '';
    return `<tr>
      <td class="mono">${time}</td>
      <td>${s.signal_type.replace(/_/g, ' ')}</td>
      <td><span class="side-badge ${dirClass}">${s.direction.toUpperCase()}</span></td>
      <td class="mono">${s.confidence}%</td>
      <td class="mono">$${fmt(s.price)}</td>
      <td>${outcomeIcon}</td>
      <td class="mono">${s.outcome_price ? '$' + fmt(s.outcome_price) : '-'}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="signal-stats">
      <span>Total: ${total}</span>
      <span>Accuracy: ${accuracy}%</span>
      <span>Avg Confidence: ${avgConf}%</span>
    </div>
    <table class="trading-table">
      <thead><tr>
        <th>Time</th><th>Type</th><th>Dir</th><th>Conf</th><th>Price</th><th>Result</th><th>Outcome Price</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Helpers ──
function _timeAgo(date) {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return secs + 's ago';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  return Math.floor(secs / 3600) + 'h ago';
}
