/**
 * Centralized state store with pub/sub notifications.
 *
 * Usage:
 *   import { state, subscribe, update } from './state.js';
 *   subscribe('candles', (candles) => drawChart(candles));
 *   update('candles', newCandles);
 */

const _subscribers = {};

export const state = {
  candles: [],
  lastPrice: 0,
  trades: [],
  ticker: {},
  orderBook: { bids: [], asks: [] },
  connected: false,
  lastUpdateTime: 0,
};

/**
 * Subscribe to changes on a specific state key.
 * Returns an unsubscribe function.
 */
export function subscribe(key, callback) {
  if (!_subscribers[key]) _subscribers[key] = [];
  _subscribers[key].push(callback);
  return () => {
    _subscribers[key] = _subscribers[key].filter((cb) => cb !== callback);
  };
}

/**
 * Update a state key and notify all subscribers.
 */
export function update(key, value) {
  state[key] = value;
  const subs = _subscribers[key];
  if (subs) {
    for (const cb of subs) {
      cb(value);
    }
  }
}
