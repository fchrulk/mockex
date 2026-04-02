/**
 * Technical indicator calculations (pure math, no DOM).
 */

/** Simple Moving Average over close prices. */
export function calcSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].c;
    result.push(sum / period);
  }
  return result;
}

/** Relative Strength Index. */
export function calcRSI(data, period = 14) {
  const result = [];
  if (data.length < period + 1) return data.map(() => null);

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i].c - data[i - 1].c;
    if (diff > 0) gainSum += diff;
    else lossSum -= diff;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = 0; i < period; i++) result.push(null);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].c - data[i - 1].c;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

/** Exponential Moving Average over close prices. */
export function calcEMA(data, period) {
  const result = [];
  if (data.length < period) return data.map(() => null);

  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    result.push(null);
    sum += data[i].c;
  }
  let ema = sum / period;
  result[period - 1] = ema;

  const k = 2 / (period + 1);
  for (let i = period; i < data.length; i++) {
    ema = data[i].c * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

/** EMA over raw value array (not candle objects). */
function emaOfValues(values, period) {
  const result = [];
  let ema = null;
  const k = 2 / (period + 1);
  let count = 0;
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) {
      result.push(null);
      continue;
    }
    if (ema === null) {
      count++;
      sum += values[i];
      if (count >= period) {
        ema = sum / period;
        result.push(ema);
      } else {
        result.push(null);
      }
    } else {
      ema = values[i] * k + ema * (1 - k);
      result.push(ema);
    }
  }
  return result;
}

/**
 * MACD — Moving Average Convergence Divergence.
 * Returns { macd: [], signal: [], histogram: [] }
 */
export function calcMACD(data, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(data, fast);
  const emaSlow = calcEMA(data, slow);

  const macdLine = [];
  for (let i = 0; i < data.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine.push(emaFast[i] - emaSlow[i]);
    } else {
      macdLine.push(null);
    }
  }

  const signalLine = emaOfValues(macdLine, signal);

  const histogram = [];
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      histogram.push(macdLine[i] - signalLine[i]);
    } else {
      histogram.push(null);
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Bollinger Bands.
 * Returns { upper: [], middle: [], lower: [] }
 */
export function calcBollinger(data, period = 20, stddev = 2) {
  const middle = calcSMA(data, period);
  const upper = [];
  const lower = [];

  for (let i = 0; i < data.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = data[j].c - middle[i];
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / period);
    upper.push(middle[i] + stddev * sd);
    lower.push(middle[i] - stddev * sd);
  }

  return { upper, middle, lower };
}

/**
 * Volume Profile for visible candles.
 * Returns array of { priceLevel, volume, pct } sorted by price.
 */
export function calcVolumeProfile(candles, bucketCount = 20) {
  if (candles.length === 0) return [];

  let minP = Infinity, maxP = -Infinity;
  candles.forEach(c => {
    if (c.l < minP) minP = c.l;
    if (c.h > maxP) maxP = c.h;
  });
  const range = maxP - minP || 1;
  const bucketSize = range / bucketCount;

  const buckets = new Array(bucketCount).fill(0);
  candles.forEach(c => {
    // Distribute volume across the candle's price range
    const low = Math.max(0, Math.floor((c.l - minP) / bucketSize));
    const high = Math.min(bucketCount - 1, Math.floor((c.h - minP) / bucketSize));
    const spread = high - low + 1;
    for (let b = low; b <= high; b++) {
      buckets[b] += c.v / spread;
    }
  });

  const maxVol = Math.max(...buckets, 1);
  return buckets.map((vol, i) => ({
    priceLevel: minP + (i + 0.5) * bucketSize,
    volume: vol,
    pct: vol / maxVol,
  }));
}
