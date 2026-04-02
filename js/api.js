/**
 * REST API fetch wrappers.
 */

import { update } from './state.js';

export const MAX_CANDLES = 200;

/** Fetch candle data from server for the given interval. */
export async function loadCandles(interval = '1m') {
  try {
    const resp = await fetch(`/api/candles?interval=${interval}`);
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
