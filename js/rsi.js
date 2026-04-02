/**
 * RSI sub-chart rendering.
 */

import { calcRSI } from './indicators.js';

export function drawRSI(candles) {
  const canvas = document.getElementById('rsi-canvas');
  const container = document.getElementById('rsi-container');
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

  const rsi = calcRSI(candles);
  const cw = (W - padL - padR) / candles.length;
  const yR = (v) => 5 + (1 - v / 100) * (H - 10);

  // Overbought zone
  ctx.fillStyle = 'rgba(255,41,82,0.05)';
  ctx.fillRect(padL, yR(100), W - padL - padR, yR(70) - yR(100));
  // Oversold zone
  ctx.fillStyle = 'rgba(0,232,123,0.05)';
  ctx.fillRect(padL, yR(30), W - padL - padR, yR(0) - yR(30));

  // Grid lines
  [30, 50, 70].forEach((v) => {
    ctx.strokeStyle = 'rgba(30,42,58,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, yR(v));
    ctx.lineTo(W - padR, yR(v));
    ctx.stroke();
    ctx.fillStyle = '#4a5a74';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(v, W - 5, yR(v) + 4);
  });

  // RSI line
  ctx.strokeStyle = '#ab47bc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  rsi.forEach((v, i) => {
    if (v === null) return;
    const x = padL + i * cw + cw / 2;
    if (!started) {
      ctx.moveTo(x, yR(v));
      started = true;
    } else {
      ctx.lineTo(x, yR(v));
    }
  });
  ctx.stroke();

  // Update indicator display
  const lastRSI = rsi.filter((v) => v !== null).pop();
  const rsiEl = document.getElementById('rsi-val');
  const rsiLabel = document.getElementById('rsi-label');
  if (lastRSI != null) {
    rsiEl.textContent = lastRSI.toFixed(1);
    if (lastRSI >= 70) {
      rsiEl.style.color = 'var(--red)';
      rsiLabel.textContent = 'Overbought';
      rsiLabel.style.color = 'var(--red)';
    } else if (lastRSI <= 30) {
      rsiEl.style.color = 'var(--green)';
      rsiLabel.textContent = 'Oversold';
      rsiLabel.style.color = 'var(--green)';
    } else {
      rsiEl.style.color = 'var(--text)';
      rsiLabel.textContent = 'Neutral';
      rsiLabel.style.color = 'var(--text2)';
    }
  }
}
