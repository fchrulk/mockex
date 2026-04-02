/**
 * Shared formatting and DOM helper utilities.
 */

/** Format a number with fixed decimal places and locale separators. */
export function fmt(v, d = 2) {
  return parseFloat(v).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Format a large number with K/M/B suffix. */
export function fmtK(v) {
  const n = parseFloat(v);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

/** Set element color based on positive/negative value. */
export function setColor(el, val) {
  const n = parseFloat(val);
  el.style.color = n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text)';
}
