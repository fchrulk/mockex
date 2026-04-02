/**
 * Candlestick chart rendering, scheduling, and hover/crosshair interaction.
 */

import { fmt, fmtK } from './utils.js';
import { calcSMA } from './indicators.js';
import { drawRSI } from './rsi.js';
import { state } from './state.js';

let chartLayout = { padL: 10, padR: 70, cw: 0, chartH: 0, minL: 0, totalRange: 1 };
let chartDirty = false;
let chartRAF = null;

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

export function drawChart() {
  const candles = state.candles;
  const canvas = document.getElementById('chart-canvas');
  const container = document.getElementById('chart-container');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = container.clientWidth;
  const H = container.clientHeight;

  // Dark background with subtle gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0a0f1a');
  bgGrad.addColorStop(1, '#060a12');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  if (candles.length < 2) return;

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
  const pRange = maxH - minL || 1;
  const pPad = pRange * 0.05;
  minL -= pPad;
  maxH += pPad;
  const totalRange = maxH - minL;

  chartLayout = { padL, padR, cw, chartH, minL, totalRange };

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
    const time = new Date(candles[i].t).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    ctx.fillText(time, x, H - volH + 12);
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
  const sma7 = calcSMA(candles, 7);
  const sma25 = calcSMA(candles, 25);

  function drawLine(data, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    data.forEach((v, i) => {
      if (v === null) return;
      const x = padL + i * cw + cw / 2;
      const y = yP(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }
  drawLine(sma7, '#2196f3');
  drawLine(sma25, '#ff9800');

  const lastSma7 = sma7.filter((v) => v !== null).pop();
  const lastSma25 = sma25.filter((v) => v !== null).pop();
  document.getElementById('sma7-val').textContent = lastSma7 ? fmt(lastSma7) : '--';
  document.getElementById('sma25-val').textContent = lastSma25 ? fmt(lastSma25) : '--';

  drawRSI(candles);
}

/** Set up hover tooltip and crosshair on the chart container. */
export function initChartInteraction() {
  const chartContainer = document.getElementById('chart-container');
  const tooltip = document.getElementById('chart-tooltip');
  const crosshair = document.getElementById('chart-crosshair');
  const chH = document.getElementById('ch-h');
  const chV = document.getElementById('ch-v');
  const chPriceLabel = document.getElementById('ch-price-label');

  chartContainer.addEventListener('mousemove', (e) => {
    const candles = state.candles;
    if (candles.length < 2) return;
    const rect = chartContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { padL, padR, cw, chartH, minL, totalRange } = chartLayout;

    const idx = Math.floor((x - padL) / cw);
    if (idx < 0 || idx >= candles.length) {
      tooltip.style.display = 'none';
      crosshair.style.display = 'none';
      return;
    }

    const c = candles[idx];
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
    chV.style.left = padL + idx * cw + cw / 2 + 'px';

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
