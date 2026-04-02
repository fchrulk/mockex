/**
 * Candlestick chart with zoom/pan, multi-timeframe, and indicator overlays.
 */

import { fmt, fmtK } from './utils.js';
import { calcSMA, calcBollinger, calcVolumeProfile } from './indicators.js';
import { drawRSI } from './rsi.js';
import { drawMACD } from './macd.js';
import { state, update } from './state.js';
import { getIndicatorSettings } from './indicator-settings.js';

// ── Viewport state ──
const viewport = {
  startIndex: 0,
  visibleCount: 100,
  isDragging: false,
  dragStartX: 0,
  dragStartIndex: 0,
  autoScroll: true,
};

let chartLayout = { padL: 10, padR: 70, cw: 0, chartH: 0, minL: 0, totalRange: 1 };
let chartDirty = false;
let chartRAF = null;

// ── Timeframe ──
const TIMEFRAME_MS = {
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
};
let activeTimeframe = '1m';

export function getActiveTimeframe() { return activeTimeframe; }
export function getTimeframeMs() { return TIMEFRAME_MS[activeTimeframe]; }

export function setTimeframe(tf) {
  activeTimeframe = tf;
  viewport.autoScroll = true;
}

// ── Scheduling ──

export function scheduleChartDraw() {
  if (!chartDirty) {
    chartDirty = true;
    cancelAnimationFrame(chartRAF);
    chartRAF = requestAnimationFrame(() => {
      chartDirty = false;
      drawChart();
    });
  }
}

// ── Main draw ──

export function drawChart() {
  const allCandles = state.candles;
  const canvas = document.getElementById('chart-canvas');
  const container = document.getElementById('chart-container');
  if (!canvas || !container) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = container.clientWidth;
  const H = container.clientHeight;

  // Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0a0f1a');
  bgGrad.addColorStop(1, '#060a12');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  if (allCandles.length < 2) return;

  // Viewport slicing
  if (viewport.autoScroll) {
    viewport.startIndex = Math.max(0, allCandles.length - viewport.visibleCount);
  }
  const start = Math.max(0, Math.min(viewport.startIndex, allCandles.length - viewport.visibleCount));
  const end = Math.min(allCandles.length, start + viewport.visibleCount);
  const candles = allCandles.slice(start, end);

  if (candles.length < 2) return;

  const settings = getIndicatorSettings();

  const volH = H * 0.18;
  const chartH = H - volH - 10;
  const padR = 70;
  const padL = 10;
  const cw = (W - padL - padR) / candles.length;

  let minL = Infinity;
  let maxH = -Infinity;
  let maxVol = 0;
  candles.forEach((c) => {
    if (c.l < minL) minL = c.l;
    if (c.h > maxH) maxH = c.h;
    if (c.v > maxVol) maxVol = c.v;
  });

  // Expand range if Bollinger is visible
  if (settings.bollinger.enabled) {
    const bb = calcBollinger(allCandles, settings.bollinger.period, settings.bollinger.stddev);
    for (let i = start; i < end; i++) {
      if (bb.upper[i] !== null && bb.upper[i] > maxH) maxH = bb.upper[i];
      if (bb.lower[i] !== null && bb.lower[i] < minL) minL = bb.lower[i];
    }
  }

  const pRange = maxH - minL || 1;
  const pPad = pRange * 0.05;
  minL -= pPad;
  maxH += pPad;
  const totalRange = maxH - minL;

  chartLayout = { padL, padR, cw, chartH, minL, totalRange, start, end };

  const yP = (p) => 5 + (1 - (p - minL) / totalRange) * chartH;

  // Grid lines
  ctx.fillStyle = '#4a5a74';
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const p = minL + (totalRange * i) / 5;
    const y = yP(p);
    ctx.strokeStyle = 'rgba(30,42,58,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(fmt(p), W - 5, y + 4);
  }

  // Time labels
  ctx.fillStyle = '#4a5a74';
  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'center';
  const labelEvery = Math.max(1, Math.floor(candles.length / 6));
  for (let i = 0; i < candles.length; i += labelEvery) {
    const x = padL + i * cw + cw / 2;
    const d = new Date(candles[i].t);
    let label;
    if (activeTimeframe === '1d') {
      label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else if (activeTimeframe === '4h' || activeTimeframe === '1h') {
      label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
              d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    } else {
      label = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    }
    ctx.fillText(label, x, H - volH + 12);
  }

  // Bollinger Bands (draw before candles so they appear behind)
  if (settings.bollinger.enabled) {
    const bb = calcBollinger(allCandles, settings.bollinger.period, settings.bollinger.stddev);
    const sliceU = bb.upper.slice(start, end);
    const sliceM = bb.middle.slice(start, end);
    const sliceL = bb.lower.slice(start, end);

    // Fill between bands
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < candles.length; i++) {
      if (sliceU[i] === null) continue;
      const x = padL + i * cw + cw / 2;
      if (!started) { ctx.moveTo(x, yP(sliceU[i])); started = true; }
      else ctx.lineTo(x, yP(sliceU[i]));
    }
    for (let i = candles.length - 1; i >= 0; i--) {
      if (sliceL[i] === null) continue;
      const x = padL + i * cw + cw / 2;
      ctx.lineTo(x, yP(sliceL[i]));
    }
    ctx.closePath();
    ctx.fill();

    // Upper band
    _drawLineSlice(ctx, sliceU, padL, cw, yP, 'rgba(132,148,178,0.5)', 1);
    // Middle band (dashed)
    ctx.setLineDash([4, 4]);
    _drawLineSlice(ctx, sliceM, padL, cw, yP, 'rgba(132,148,178,0.4)', 1);
    ctx.setLineDash([]);
    // Lower band
    _drawLineSlice(ctx, sliceL, padL, cw, yP, 'rgba(132,148,178,0.5)', 1);
  }

  // Volume bars
  candles.forEach((c, i) => {
    const x = padL + i * cw;
    const vh = maxVol > 0 ? (c.v / maxVol) * (volH - 15) : 0;
    const vGrad = ctx.createLinearGradient(0, H - vh, 0, H);
    if (c.c >= c.o) {
      vGrad.addColorStop(0, 'rgba(0,232,123,0.25)');
      vGrad.addColorStop(1, 'rgba(0,232,123,0.05)');
    } else {
      vGrad.addColorStop(0, 'rgba(255,41,82,0.25)');
      vGrad.addColorStop(1, 'rgba(255,41,82,0.05)');
    }
    ctx.fillStyle = vGrad;
    ctx.fillRect(x + cw * 0.15, H - vh, cw * 0.7, vh);
  });

  // Volume Profile overlay
  if (settings.volumeProfile.enabled) {
    const vp = calcVolumeProfile(candles, 20);
    const maxW = (W - padL - padR) * 0.15;
    vp.forEach(bucket => {
      const bh = totalRange / 20;
      const y1 = yP(bucket.priceLevel + bh / 2);
      const y2 = yP(bucket.priceLevel - bh / 2);
      const barW = bucket.pct * maxW;
      const isHigh = bucket.pct > 0.8;
      ctx.fillStyle = isHigh ? 'rgba(0,212,255,0.15)' : 'rgba(132,148,178,0.08)';
      ctx.fillRect(W - padR - barW, y1, barW, y2 - y1);
    });
    // POC line
    const poc = vp.reduce((max, b) => b.volume > max.volume ? b : max, vp[0]);
    if (poc) {
      ctx.strokeStyle = 'rgba(0,212,255,0.3)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, yP(poc.priceLevel));
      ctx.lineTo(W - padR, yP(poc.priceLevel));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Candles
  candles.forEach((c, i) => {
    const x = padL + i * cw + cw / 2;
    const green = c.c >= c.o;
    const color = green ? '#00e87b' : '#ff2952';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yP(c.h));
    ctx.lineTo(x, yP(c.l));
    ctx.stroke();
    const yOpen = yP(c.o);
    const yClose = yP(c.c);
    const bodyH = Math.max(Math.abs(yClose - yOpen), 1);
    ctx.fillStyle = color;
    ctx.fillRect(x - cw * 0.35, Math.min(yOpen, yClose), cw * 0.7, bodyH);
  });

  // SMA lines
  if (settings.sma7.enabled) {
    const sma7 = calcSMA(allCandles, settings.sma7.period).slice(start, end);
    _drawLineSlice(ctx, sma7, padL, cw, yP, '#2196f3', 1.5);
    const last = sma7.filter(v => v !== null).pop();
    document.getElementById('sma7-val').textContent = last ? fmt(last) : '--';
  }

  if (settings.sma25.enabled) {
    const sma25 = calcSMA(allCandles, settings.sma25.period).slice(start, end);
    _drawLineSlice(ctx, sma25, padL, cw, yP, '#ff9800', 1.5);
    const last = sma25.filter(v => v !== null).pop();
    document.getElementById('sma25-val').textContent = last ? fmt(last) : '--';
  }

  // Sub-charts
  if (settings.rsi.enabled) {
    document.getElementById('rsi-container').style.display = '';
    drawRSI(allCandles, start, end, settings.rsi.period);
  } else {
    document.getElementById('rsi-container').style.display = 'none';
  }

  if (settings.macd.enabled) {
    document.getElementById('macd-container').style.display = '';
    drawMACD(allCandles, start, end, settings.macd.fast, settings.macd.slow, settings.macd.signal);
  } else {
    const macdEl = document.getElementById('macd-container');
    if (macdEl) macdEl.style.display = 'none';
  }
}

function _drawLineSlice(ctx, data, padL, cw, yP, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  data.forEach((v, i) => {
    if (v === null) return;
    const x = padL + i * cw + cw / 2;
    const y = yP(v);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── Interactions: zoom, pan, crosshair ──

export function initChartInteraction() {
  const chartContainer = document.getElementById('chart-container');
  const tooltip = document.getElementById('chart-tooltip');
  const crosshair = document.getElementById('chart-crosshair');
  const chH = document.getElementById('ch-h');
  const chV = document.getElementById('ch-v');
  const chPriceLabel = document.getElementById('ch-price-label');

  // Zoom (mouse wheel)
  chartContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const candles = state.candles;
    if (candles.length < 2) return;

    const rect = chartContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const { padL, padR, cw } = chartLayout;
    const chartW = rect.width - padL - padR;

    // Cursor position as fraction of visible chart
    const cursorFrac = Math.max(0, Math.min(1, (mouseX - padL) / chartW));
    const oldCount = viewport.visibleCount;

    // Zoom in (scroll up) or out (scroll down)
    const delta = e.deltaY > 0 ? 10 : -10;
    viewport.visibleCount = Math.max(20, Math.min(200, viewport.visibleCount + delta));

    if (viewport.visibleCount !== oldCount) {
      // Anchor zoom at cursor position
      const countDiff = viewport.visibleCount - oldCount;
      viewport.startIndex = Math.max(0, viewport.startIndex - Math.round(countDiff * cursorFrac));
      viewport.autoScroll = (viewport.startIndex + viewport.visibleCount >= candles.length);
      scheduleChartDraw();
    }
  }, { passive: false });

  // Pan (click and drag)
  chartContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    viewport.isDragging = true;
    viewport.dragStartX = e.clientX;
    viewport.dragStartIndex = viewport.startIndex;
    chartContainer.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!viewport.isDragging) return;
    const { cw } = chartLayout;
    if (cw <= 0) return;
    const dx = e.clientX - viewport.dragStartX;
    const indexDelta = Math.round(dx / cw);
    const candles = state.candles;
    const maxStart = Math.max(0, candles.length - viewport.visibleCount);
    viewport.startIndex = Math.max(0, Math.min(maxStart, viewport.dragStartIndex - indexDelta));
    viewport.autoScroll = (viewport.startIndex + viewport.visibleCount >= candles.length);
    scheduleChartDraw();
  });

  window.addEventListener('mouseup', () => {
    if (viewport.isDragging) {
      viewport.isDragging = false;
      chartContainer.style.cursor = 'crosshair';
    }
  });

  // Double-click to reset
  chartContainer.addEventListener('dblclick', () => {
    viewport.visibleCount = 100;
    viewport.autoScroll = true;
    scheduleChartDraw();
  });

  // Hover tooltip + crosshair
  chartContainer.addEventListener('mousemove', (e) => {
    if (viewport.isDragging) {
      tooltip.style.display = 'none';
      crosshair.style.display = 'none';
      return;
    }

    const candles = state.candles;
    if (candles.length < 2) return;
    const rect = chartContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { padL, padR, cw, chartH, minL, totalRange, start, end } = chartLayout;

    const localIdx = Math.floor((x - padL) / cw);
    const visibleCount = end - start;
    if (localIdx < 0 || localIdx >= visibleCount) {
      tooltip.style.display = 'none';
      crosshair.style.display = 'none';
      return;
    }

    const c = candles[start + localIdx];
    const green = c.c >= c.o;
    const time = new Date(c.t).toLocaleTimeString('en-US', { hour12: false });
    const date = new Date(c.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    tooltip.innerHTML = `
      <div class="tt-time">${date} ${time}</div>
      <div><span class="tt-label">O</span> <span class="${green ? 'tt-green' : 'tt-red'}">${fmt(c.o)}</span></div>
      <div><span class="tt-label">H</span> <span class="${green ? 'tt-green' : 'tt-red'}">${fmt(c.h)}</span></div>
      <div><span class="tt-label">L</span> <span class="${green ? 'tt-green' : 'tt-red'}">${fmt(c.l)}</span></div>
      <div><span class="tt-label">C</span> <span class="${green ? 'tt-green' : 'tt-red'}">${fmt(c.c)}</span></div>
      <div><span class="tt-label">Vol</span> ${fmtK(c.v)}</div>
    `;
    tooltip.style.display = 'block';

    const ttW = tooltip.offsetWidth;
    const ttH = tooltip.offsetHeight;
    let tx = x + 15;
    let ty = y - ttH / 2;
    if (tx + ttW > rect.width - 10) tx = x - ttW - 15;
    if (ty < 5) ty = 5;
    if (ty + ttH > rect.height - 5) ty = rect.height - ttH - 5;
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';

    crosshair.style.display = 'block';
    chH.style.top = y + 'px';
    chV.style.left = padL + localIdx * cw + cw / 2 + 'px';

    if (y <= chartH + 5 && totalRange > 0) {
      const hoverPrice = minL + (1 - (y - 5) / chartH) * totalRange;
      chPriceLabel.textContent = fmt(hoverPrice);
      chPriceLabel.style.top = y + 'px';
      chPriceLabel.style.display = 'block';
    } else {
      chPriceLabel.style.display = 'none';
    }
  });

  chartContainer.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    crosshair.style.display = 'none';
  });
}
