/**
 * Trading panel: wallet bar, order entry, positions/orders/history tabs.
 */

import { fmt, fmtK } from './utils.js';
import { state, subscribe } from './state.js';

let ws = null;

// ── State ──
let account = { cash: '0', reserved: '0', equity: '0' };
let position = null;
let openOrders = [];
let tradeHistory = [];
let activeTab = 'positions';
let selectedOrderType = 'market';

// ── Init ──
export function initTrading(proxyWs) {
  ws = proxyWs;
  _bindOrderPanel();
  _bindTabs();
  _renderTab();
  _fetchInitialState();
}

export function setTradingWs(proxyWs) {
  ws = proxyWs;
}

// ── WebSocket message handler ──
export function onTradingMessage(msg) {
  if (msg.type === 'balance_update') {
    account = msg.data;
    _renderWallet();
  } else if (msg.type === 'position_update') {
    position = msg.data;
    if (activeTab === 'positions') _renderPositions();
    _renderWallet();
  } else if (msg.type === 'order_update') {
    _handleOrderUpdate(msg.data);
  } else if (msg.type === 'trade_executed') {
    tradeHistory.unshift(msg.data);
    if (tradeHistory.length > 100) tradeHistory.pop();
    if (activeTab === 'history') _renderHistory();
  } else if (msg.type === 'error') {
    _showNotification(msg.data.message, 'error');
  }
}

// ── Fetch initial state from REST ──
async function _fetchInitialState() {
  try {
    const [accResp, posResp, ordersResp, tradesResp] = await Promise.all([
      fetch('/api/account'),
      fetch('/api/positions'),
      fetch('/api/orders?status=open'),
      fetch('/api/trades'),
    ]);
    account = await accResp.json();
    const posData = await posResp.json();
    position = Object.keys(posData).length > 0 ? posData : null;
    openOrders = await ordersResp.json();
    tradeHistory = await tradesResp.json();
  } catch (e) {
    console.error('Failed to load trading state:', e);
  }
  _renderWallet();
  _renderTab();
}

// ── Wallet bar ──
function _renderWallet() {
  const el = document.getElementById('wallet-bar');
  if (!el) return;
  const cash = parseFloat(account.cash || 0);
  const reserved = parseFloat(account.reserved || 0);
  const equity = parseFloat(account.equity || 0);

  document.getElementById('wallet-cash').textContent = '$' + fmt(cash);
  document.getElementById('wallet-reserved').textContent = '$' + fmt(reserved);
  document.getElementById('wallet-equity').textContent = '$' + fmt(equity);
}

// ── Order panel ──
function _bindOrderPanel() {
  // Order type tabs
  document.querySelectorAll('.order-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedOrderType = btn.dataset.type;
      document.querySelectorAll('.order-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _togglePriceFields();
      _updateEstimate();
    });
  });

  // Quick quantity buttons
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pct = parseFloat(btn.dataset.pct) / 100;
      const qtyInput = document.getElementById('order-qty');
      const currentPrice = state.lastPrice || parseFloat(account.equity) / 100;
      if (currentPrice <= 0) return;

      // For buy: use cash balance; for sell: use position
      const activeSide = document.querySelector('.side-btn.active')?.dataset.side || 'buy';
      if (activeSide === 'buy') {
        const available = parseFloat(account.cash || 0);
        const maxQty = available / currentPrice / 1.001; // account for fee
        qtyInput.value = (maxQty * pct).toFixed(6);
      } else if (position) {
        const held = parseFloat(position.quantity || 0);
        qtyInput.value = (held * pct).toFixed(6);
      }
      _updateEstimate();
    });
  });

  // Input change -> update estimate
  document.getElementById('order-qty')?.addEventListener('input', _updateEstimate);
  document.getElementById('order-price')?.addEventListener('input', _updateEstimate);

  // Buy/Sell buttons
  document.getElementById('btn-buy')?.addEventListener('click', () => _submitOrder('buy'));
  document.getElementById('btn-sell')?.addEventListener('click', () => _submitOrder('sell'));

  // Side toggle for quick qty buttons
  document.querySelectorAll('.side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  _togglePriceFields();
}

function _togglePriceFields() {
  const priceRow = document.getElementById('price-row');
  const stopRow = document.getElementById('stop-row');
  if (priceRow) priceRow.style.display = selectedOrderType === 'market' ? 'none' : 'flex';
  if (stopRow) stopRow.style.display = selectedOrderType === 'stop' ? 'flex' : 'none';
}

function _updateEstimate() {
  const qty = parseFloat(document.getElementById('order-qty')?.value || 0);
  const priceInput = document.getElementById('order-price');
  const price = selectedOrderType === 'market'
    ? (state.lastPrice || 0)
    : parseFloat(priceInput?.value || 0);
  const cost = qty * price;
  const fee = cost * 0.001;
  const total = cost + fee;

  const estEl = document.getElementById('order-estimate');
  if (estEl) {
    estEl.textContent = `Est: $${fmt(cost)}  |  Fee: $${fmt(fee)}  |  Total: $${fmt(total)}`;
  }
}

function _submitOrder(side) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    _showNotification('Not connected', 'error');
    return;
  }

  const qty = parseFloat(document.getElementById('order-qty')?.value || 0);
  if (qty <= 0) {
    _showNotification('Enter a valid quantity', 'error');
    return;
  }

  const data = {
    side,
    order_type: selectedOrderType,
    quantity: qty,
  };

  if (selectedOrderType === 'limit' || selectedOrderType === 'stop') {
    const price = parseFloat(document.getElementById('order-price')?.value || 0);
    if (price <= 0) {
      _showNotification('Enter a valid price', 'error');
      return;
    }
    data.price = price;
  }

  if (selectedOrderType === 'stop') {
    const stopPrice = parseFloat(document.getElementById('order-stop')?.value || 0);
    if (stopPrice <= 0) {
      _showNotification('Enter a valid stop price', 'error');
      return;
    }
    data.stop_price = stopPrice;
  }

  ws.send(JSON.stringify({ type: 'place_order', data }));

  // Clear inputs
  document.getElementById('order-qty').value = '';
  if (document.getElementById('order-price')) document.getElementById('order-price').value = '';
  if (document.getElementById('order-stop')) document.getElementById('order-stop').value = '';
  _updateEstimate();

  _showNotification(`${side.toUpperCase()} ${selectedOrderType} order placed`, 'success');
}

// ── Tabs ──
function _bindTabs() {
  document.querySelectorAll('.trading-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.trading-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _renderTab();
    });
  });

  // Reset button
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    if (confirm('Reset account? This will clear all orders, trades, and positions.')) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reset_account' }));
        openOrders = [];
        tradeHistory = [];
        position = null;
        _renderTab();
        _showNotification('Account reset', 'success');
      }
    }
  });
}

function _renderTab() {
  if (activeTab === 'positions') _renderPositions();
  else if (activeTab === 'orders') _renderOrders();
  else if (activeTab === 'history') _renderHistory();
}

function _renderPositions() {
  const el = document.getElementById('trading-tab-content');
  if (!el) return;

  if (!position || parseFloat(position.quantity) <= 0) {
    el.innerHTML = '<div class="trading-empty">No open positions</div>';
    return;
  }

  const pnl = parseFloat(position.unrealized_pnl || 0);
  const pnlClass = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
  const pnlSign = pnl >= 0 ? '+' : '';

  el.innerHTML = `
    <table class="trading-table">
      <thead><tr>
        <th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Current</th><th>PnL</th><th></th>
      </tr></thead>
      <tbody><tr>
        <td class="mono">BTCUSDT</td>
        <td><span class="side-badge long">LONG</span></td>
        <td class="mono">${parseFloat(position.quantity).toFixed(6)}</td>
        <td class="mono">$${fmt(parseFloat(position.entry_price))}</td>
        <td class="mono">$${fmt(parseFloat(position.current_price || 0))}</td>
        <td class="mono ${pnlClass}">${pnlSign}$${fmt(pnl)}</td>
        <td><button class="close-btn" id="btn-close-pos">Close</button></td>
      </tr></tbody>
    </table>
  `;

  document.getElementById('btn-close-pos')?.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'close_position' }));
    }
  });
}

function _renderOrders() {
  const el = document.getElementById('trading-tab-content');
  if (!el) return;

  if (openOrders.length === 0) {
    el.innerHTML = '<div class="trading-empty">No open orders</div>';
    return;
  }

  const rows = openOrders.map(o => {
    const sideClass = o.side === 'buy' ? 'buy' : 'sell';
    return `<tr>
      <td class="mono">${o.symbol}</td>
      <td><span class="side-badge ${sideClass}">${o.side.toUpperCase()}</span></td>
      <td class="mono">${o.order_type}</td>
      <td class="mono">${parseFloat(o.quantity).toFixed(6)}</td>
      <td class="mono">${o.price ? '$' + fmt(parseFloat(o.price)) : '-'}</td>
      <td class="mono">${o.stop_price ? '$' + fmt(parseFloat(o.stop_price)) : '-'}</td>
      <td><button class="cancel-btn" data-id="${o.id}">Cancel</button></td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <table class="trading-table">
      <thead><tr>
        <th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th>Stop</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  el.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'cancel_order', data: { order_id: btn.dataset.id } }));
      }
    });
  });
}

function _renderHistory() {
  const el = document.getElementById('trading-tab-content');
  if (!el) return;

  if (tradeHistory.length === 0) {
    el.innerHTML = '<div class="trading-empty">No trade history</div>';
    return;
  }

  const rows = tradeHistory.map(t => {
    const sideClass = t.side === 'buy' ? 'buy' : 'sell';
    const pnl = t.realized_pnl ? parseFloat(t.realized_pnl) : null;
    const pnlStr = pnl !== null
      ? `<span class="${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${pnl >= 0 ? '+' : ''}$${fmt(pnl)}</span>`
      : '-';
    const time = t.executed_at ? new Date(t.executed_at).toLocaleTimeString() : '';
    return `<tr>
      <td class="mono">${time}</td>
      <td><span class="side-badge ${sideClass}">${t.side.toUpperCase()}</span></td>
      <td class="mono">${parseFloat(t.quantity).toFixed(6)}</td>
      <td class="mono">$${fmt(parseFloat(t.price))}</td>
      <td class="mono">$${fmt(parseFloat(t.fee))}</td>
      <td class="mono">${pnlStr}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <table class="trading-table">
      <thead><tr>
        <th>Time</th><th>Side</th><th>Qty</th><th>Price</th><th>Fee</th><th>PnL</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Helpers ──
function _handleOrderUpdate(data) {
  if (data.status === 'open') {
    const exists = openOrders.find(o => o.id === data.id);
    if (!exists) openOrders.push(data);
  } else {
    openOrders = openOrders.filter(o => o.id !== data.id);
  }
  if (activeTab === 'orders') _renderOrders();
}

function _showNotification(message, type = 'info') {
  const container = document.getElementById('notifications');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// Update position PnL on price changes
subscribe('lastPrice', (price) => {
  if (position && price > 0) {
    const entry = parseFloat(position.entry_price || 0);
    const qty = parseFloat(position.quantity || 0);
    position.current_price = price;
    position.unrealized_pnl = ((price - entry) * qty).toFixed(2);
    if (activeTab === 'positions') _renderPositions();
  }
});
