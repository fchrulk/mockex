/**
 * Indicator toggle state and parameter management with localStorage persistence.
 */

import { scheduleChartDraw } from './chart.js';

const STORAGE_KEY = 'mockex_indicators';

const DEFAULTS = {
  sma7: { enabled: true, period: 7 },
  sma25: { enabled: true, period: 25 },
  rsi: { enabled: true, period: 14 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
  bollinger: { enabled: false, period: 20, stddev: 2 },
  volumeProfile: { enabled: false },
};

let _settings = null;

function _load() {
  if (_settings) return _settings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Merge with defaults to handle new keys
      _settings = {};
      for (const [key, def] of Object.entries(DEFAULTS)) {
        _settings[key] = { ...def, ...(saved[key] || {}) };
      }
    } else {
      _settings = JSON.parse(JSON.stringify(DEFAULTS));
    }
  } catch {
    _settings = JSON.parse(JSON.stringify(DEFAULTS));
  }
  return _settings;
}

function _save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings));
  } catch { /* ignore */ }
}

export function getIndicatorSettings() {
  return _load();
}

export function toggleIndicator(key) {
  const s = _load();
  if (s[key]) {
    s[key].enabled = !s[key].enabled;
    _save();
    scheduleChartDraw();
  }
}

export function updateIndicatorParam(key, param, value) {
  const s = _load();
  if (s[key]) {
    s[key][param] = value;
    _save();
    scheduleChartDraw();
  }
}

/** Initialize the indicator toggle panel UI. */
export function initIndicatorPanel() {
  const panel = document.getElementById('indicator-toggles');
  if (!panel) return;

  const settings = _load();
  const indicators = [
    { key: 'sma7', label: 'SMA 7', params: [{ name: 'period', label: 'Period', type: 'number' }] },
    { key: 'sma25', label: 'SMA 25', params: [{ name: 'period', label: 'Period', type: 'number' }] },
    { key: 'rsi', label: 'RSI', params: [{ name: 'period', label: 'Period', type: 'number' }] },
    { key: 'macd', label: 'MACD', params: [
      { name: 'fast', label: 'Fast', type: 'number' },
      { name: 'slow', label: 'Slow', type: 'number' },
      { name: 'signal', label: 'Signal', type: 'number' },
    ]},
    { key: 'bollinger', label: 'Bollinger', params: [
      { name: 'period', label: 'Period', type: 'number' },
      { name: 'stddev', label: 'StdDev', type: 'number' },
    ]},
    { key: 'volumeProfile', label: 'Vol Profile', params: [] },
  ];

  panel.innerHTML = indicators.map(ind => {
    const s = settings[ind.key];
    const activeClass = s.enabled ? 'active' : '';
    const hasParams = ind.params.length > 0;
    return `<div class="ind-toggle-group">
      <button class="ind-toggle ${activeClass}" data-key="${ind.key}">${ind.label}</button>
      ${hasParams ? `<button class="ind-gear" data-key="${ind.key}" title="Settings">&#9881;</button>` : ''}
      <div class="ind-params" data-key="${ind.key}" style="display:none">
        ${ind.params.map(p => `
          <label>${p.label}
            <input type="number" class="ind-param-input mono" data-key="${ind.key}" data-param="${p.name}" value="${s[p.name] || ''}" step="1" min="1">
          </label>
        `).join('')}
      </div>
    </div>`;
  }).join('');

  // Toggle buttons
  panel.querySelectorAll('.ind-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleIndicator(btn.dataset.key);
      btn.classList.toggle('active');
    });
  });

  // Gear buttons
  panel.querySelectorAll('.ind-gear').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const paramPanel = panel.querySelector(`.ind-params[data-key="${btn.dataset.key}"]`);
      if (paramPanel) {
        paramPanel.style.display = paramPanel.style.display === 'none' ? 'flex' : 'none';
      }
    });
  });

  // Param inputs
  panel.querySelectorAll('.ind-param-input').forEach(input => {
    input.addEventListener('change', () => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val > 0) {
        updateIndicatorParam(input.dataset.key, input.dataset.param, val);
      }
    });
  });
}
