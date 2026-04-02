/**
 * WebSocket connection to the local proxy server.
 */

import { update } from './state.js';

let proxyWs = null;
let proxyReconnectTimer = null;
let streamHandlers = {};

/** Register stream handlers before connecting. */
export function setStreamHandlers(handlers) {
  streamHandlers = handlers;
}

export function connectProxy() {
  if (proxyWs) {
    try {
      proxyWs.close();
    } catch (e) {
      /* ignore */
    }
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  proxyWs = new WebSocket(`${proto}//${location.host}/ws`);

  proxyWs.onopen = () => {
    update('connected', true);
    updateConnStatus(true);
  };

  proxyWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      const handler = streamHandlers[msg.stream];
      if (handler) handler(msg.data);
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  proxyWs.onclose = () => {
    update('connected', false);
    updateConnStatus(false);
    clearTimeout(proxyReconnectTimer);
    proxyReconnectTimer = setTimeout(connectProxy, 3000);
  };

  proxyWs.onerror = () => proxyWs.close();
}

function updateConnStatus(connected) {
  const dot = document.getElementById('conn-dot');
  const txt = document.getElementById('conn-text');
  if (connected) {
    dot.className = 'connected';
    txt.textContent = 'Connected';
  } else {
    dot.className = 'disconnected';
    txt.textContent = 'Disconnected';
  }
}
