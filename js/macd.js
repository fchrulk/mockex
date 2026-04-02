/**
 * MACD sub-chart rendering.
 */

import { fmt } from './utils.js';
import { calcMACD } from './indicators.js';

export function drawMACD(allCandles, start, end, fast = 12, slow = 26, signal = 9) {
  const canvas = document.getElementById('macd-canvas');
  const container = document.getElementById('macd-container');
  if (!canvas || !container) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = container.clientWidth;
  const H = container.clientHeight;
  const padR = 70;
  const padL = 10;

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0a0f1a');
  bgGrad.addColorStop(1, '#060a12');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const macdAll = calcMACD(allCandles, fast, slow, signal);
  const macdLine = macdAll.macd.slice(start, end);
  const signalLine = macdAll.signal.slice(start, end);
  const histogram = macdAll.histogram.slice(start, end);
  const visibleCount = end - start;
  const cw = (W - padL - padR) / visibleCount;

  // Find Y range from visible data
  let minV = 0, maxV = 0;
  for (let i = 0; i < visibleCount; i++) {
    if (macdLine[i] !== null) {
      minV = Math.min(minV, macdLine[i]);
      maxV = Math.max(maxV, macdLine[i]);
    }
    if (signalLine[i] !== null) {
      minV = Math.min(minV, signalLine[i]);
      maxV = Math.max(maxV, signalLine[i]);
    }
    if (histogram[i] !== null) {
      minV = Math.min(minV, histogram[i]);
      maxV = Math.max(maxV, histogram[i]);
    }
  }
  const range = Math.max(maxV - minV, 0.01);
  const pad = range * 0.1;
  minV -= pad;
  maxV += pad;
  const totalRange = maxV - minV;

  const yM = (v) => 5 + (1 - (v - minV) / totalRange) * (H - 10);

  // Zero line
  ctx.strokeStyle = 'rgba(54,72,99,0.6)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, yM(0));
  ctx.lineTo(W - padR, yM(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Y-axis labels
  ctx.fillStyle = '#4a5a74';
  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(fmt(maxV, 1), W - 5, 12);
  ctx.fillText('0', W - 5, yM(0) + 4);
  ctx.fillText(fmt(minV, 1), W - 5, H - 3);

  // Histogram bars
  histogram.forEach((v, i) => {
    if (v === null) return;
    const x = padL + i * cw;
    const barH = Math.abs(yM(v) - yM(0));
    const barY = v >= 0 ? yM(v) : yM(0);
    ctx.fillStyle = v >= 0 ? 'rgba(0,232,123,0.4)' : 'rgba(255,41,82,0.4)';
    ctx.fillRect(x + cw * 0.2, barY, cw * 0.6, barH);
  });

  // MACD line
  _drawLine(ctx, macdLine, padL, cw, yM, '#2196f3', 1.5);

  // Signal line
  _drawLine(ctx, signalLine, padL, cw, yM, '#ff9800', 1.5);
}

function _drawLine(ctx, data, padL, cw, yFn, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  data.forEach((v, i) => {
    if (v === null) return;
    const x = padL + i * cw + cw / 2;
    if (!started) { ctx.moveTo(x, yFn(v)); started = true; }
    else ctx.lineTo(x, yFn(v));
  });
  ctx.stroke();
}
