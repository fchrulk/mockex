/**
 * REST API fetch wrappers.
 */

import { update } from './state.js';

export const MAX_CANDLES = 100;

/** Fetch initial candle data from server. */
export async function loadCandles() {
  try {
    const resp = await fetch('/api/candles');
    const data = await resp.json();
    const candles = data.map((k) => ({
      t: k[0],
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: parseFloat(k[5]),
    }));
    update('candles', candles);
  } catch (e) {
    console.error('Failed to load candles:', e);
  }
}
