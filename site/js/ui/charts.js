/**
 * Gráficos en SVG puro.
 *
 * Sin librerías: todo se dibuja a mano, se ve igual sin conexión y pesa nada.
 * Las reglas son las mismas que en los diagramas — retícula de 4 px, filete de
 * 1 px, un solo acento por pieza, sin sombras — para que un gráfico y un
 * diagrama del sistema se lean como parte de la misma familia.
 */

const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Redondea a la retícula de 4 px: evita el aspecto de gráfico autogenerado. */
const g4 = (v) => Math.round(v / 4) * 4;

const COLORS = {
  accent: 'var(--accent)',
  blood: 'var(--blood)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  orange: 'var(--orange)',
  red: 'var(--red)',
  blue: 'var(--blue)',
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  ink3: 'var(--ink-3)',
  hair: 'var(--hairline)',
};

/**
 * Gráfico de línea con banda objetivo.
 *
 * @param {Object} spec
 * @param {Array}  spec.points   [{date, value}]
 * @param {String} spec.color    color de la serie
 * @param {Object} spec.target   {min, max, label} zona objetivo opcional
 * @param {Object} spec.limit    {value, label} límite de referencia opcional
 */
export function lineChart({
  points, color = COLORS.accent, target = null, limit = null,
  width = 320, height = 172, unit = '', decimals = 1, formatDate = (d) => d,
}) {
  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' });
  if (!points.length) return svg;

  const values = points.map((p) => p.value);
  const extras = [
    ...(target ? [target.min, target.max].filter((v) => v != null) : []),
    ...(limit ? [limit.value] : []),
  ];
  let min = Math.min(...values, ...extras);
  let max = Math.max(...values, ...extras);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.15;
  max += span * 0.15;
  if (min < 0 && Math.min(...values) >= 0) min = 0;

  const x = (i) => pad.left + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => pad.top + h - ((v - min) / (max - min)) * h;

  // --- Retícula horizontal, tres líneas, nada más ---
  for (let i = 0; i <= 2; i += 1) {
    const value = min + ((max - min) * i) / 2;
    const yy = g4(y(value));
    svg.append(el('line', {
      x1: pad.left, y1: yy, x2: width - pad.right, y2: yy,
      stroke: COLORS.hair, 'stroke-width': 1,
    }));
    svg.append(el('text', {
      x: pad.left - 6, y: yy + 4, 'text-anchor': 'end',
      'font-size': 10, fill: COLORS.ink3,
    }, formatNumber(value, decimals)));
  }

  // --- Zona objetivo ---
  if (target && target.min != null) {
    const top = target.max != null ? y(target.max) : pad.top;
    const bottom = y(target.min);
    svg.append(el('rect', {
      x: pad.left, y: Math.min(top, bottom), width: w, height: Math.abs(bottom - top),
      fill: COLORS.green, opacity: 0.08,
    }));
    svg.append(el('line', {
      x1: pad.left, y1: bottom, x2: width - pad.right, y2: bottom,
      stroke: COLORS.green, 'stroke-width': 1, 'stroke-dasharray': '4 4',
    }));
    if (target.label) {
      svg.append(el('text', {
        x: width - pad.right, y: bottom - 5, 'text-anchor': 'end',
        'font-size': 9, fill: COLORS.green, 'font-weight': 600,
      }, target.label));
    }
  }

  // --- Límite de referencia ---
  if (limit && limit.value != null) {
    const yy = y(limit.value);
    svg.append(el('line', {
      x1: pad.left, y1: yy, x2: width - pad.right, y2: yy,
      stroke: COLORS.red, 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.7,
    }));
    if (limit.label) {
      svg.append(el('text', {
        x: width - pad.right, y: yy - 5, 'text-anchor': 'end',
        'font-size': 9, fill: COLORS.red, 'font-weight': 600,
      }, limit.label));
    }
  }

  // --- Serie ---
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const line = el('path', {
    d: path, fill: 'none', stroke: color, 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  svg.append(line);

  // Animación de trazado, discreta y respetuosa con reduced-motion.
  if (points.length > 1 && !prefersReducedMotion()) {
    requestAnimationFrame(() => {
      const len = line.getTotalLength?.() || 0;
      if (!len) return;
      line.style.strokeDasharray = String(len);
      line.style.strokeDashoffset = String(len);
      line.style.transition = 'stroke-dashoffset .9s cubic-bezier(.3,.7,.3,1)';
      requestAnimationFrame(() => { line.style.strokeDashoffset = '0'; });
    });
  }

  points.forEach((p, i) => {
    svg.append(el('circle', { cx: x(i), cy: y(p.value), r: 4, fill: color }));
    svg.append(el('circle', { cx: x(i), cy: y(p.value), r: 4, fill: 'none', stroke: 'var(--surface)', 'stroke-width': 1.5 }));

    const above = i === 0 || p.value >= points[i - 1].value;
    svg.append(el('text', {
      x: x(i), y: y(p.value) + (above ? -10 : 17), 'text-anchor': 'middle',
      'font-size': 11, 'font-weight': 700, fill: color,
    }, formatNumber(p.value, decimals)));

    svg.append(el('text', {
      x: x(i), y: height - 8, 'text-anchor': 'middle',
      'font-size': 10, fill: COLORS.ink3,
    }, formatDate(p.date)));

    svg.append(el('title', {}, `${formatDate(p.date)}: ${formatNumber(p.value, decimals)} ${unit}`));
  });

  return svg;
}

/** Medidor circular del índice global. */
export function gauge({ value, size = 168, color = COLORS.orange, label = '' }) {
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img' });
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;
  const circumference = 2 * Math.PI * r;
  // Arco de 270°, abierto abajo.
  const arc = circumference * 0.75;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;

  svg.append(el('circle', {
    cx, cy, r, fill: 'none', stroke: COLORS.hair, 'stroke-width': 12,
    'stroke-dasharray': `${arc} ${circumference}`, 'stroke-linecap': 'round',
    transform: `rotate(135 ${cx} ${cy})`,
  }));

  const fill = el('circle', {
    cx, cy, r, fill: 'none', stroke: color, 'stroke-width': 12,
    'stroke-dasharray': `${arc * pct} ${circumference}`, 'stroke-linecap': 'round',
    transform: `rotate(135 ${cx} ${cy})`,
  });
  svg.append(fill);

  if (!prefersReducedMotion()) {
    fill.setAttribute('stroke-dasharray', `0 ${circumference}`);
    requestAnimationFrame(() => {
      fill.style.transition = 'stroke-dasharray 1s cubic-bezier(.3,.7,.3,1)';
      fill.setAttribute('stroke-dasharray', `${arc * pct} ${circumference}`);
    });
  }

  svg.append(el('text', {
    x: cx, y: cy + 4, 'text-anchor': 'middle',
    'font-size': 38, 'font-weight': 700, fill: color,
    'font-family': 'var(--mono)',
  }, value == null ? '—' : String(value)));

  svg.append(el('text', {
    x: cx, y: cy + 24, 'text-anchor': 'middle', 'font-size': 12, fill: COLORS.ink3,
  }, value == null ? 'sin datos' : '/100'));

  if (label) {
    svg.append(el('text', { x: cx, y: size - 2, 'text-anchor': 'middle', 'font-size': 11, fill: COLORS.ink3 }, label));
  }

  return svg;
}

/** Barras horizontales comparativas, para el desglose por comida. */
export function barChart({ items, width = 480, barHeight = 24, max = null, color = COLORS.accent, unit = '' }) {
  const gap = 8;
  const labelWidth = 132;
  const height = items.length * (barHeight + gap) + 8;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' });

  const top = max ?? Math.max(...items.map((i) => i.value), 0.001);
  const trackWidth = width - labelWidth - 56;

  items.forEach((item, i) => {
    const y = i * (barHeight + gap);
    svg.append(el('text', {
      x: 0, y: y + barHeight / 2 + 4, 'font-size': 12, fill: COLORS.ink2,
    }, item.label));

    svg.append(el('rect', {
      x: labelWidth, y, width: trackWidth, height: barHeight,
      rx: 6, fill: COLORS.hair, opacity: 0.5,
    }));

    const w = Math.max(2, (item.value / top) * trackWidth);
    const bar = el('rect', {
      x: labelWidth, y, width: prefersReducedMotion() ? w : 0, height: barHeight,
      rx: 6, fill: item.color || color,
    });
    svg.append(bar);
    if (!prefersReducedMotion()) {
      requestAnimationFrame(() => {
        bar.style.transition = `width .7s cubic-bezier(.3,.7,.3,1) ${i * 60}ms`;
        bar.setAttribute('width', String(w));
      });
    }

    svg.append(el('text', {
      x: labelWidth + trackWidth + 8, y: y + barHeight / 2 + 4,
      'font-size': 12, 'font-weight': 700, fill: COLORS.ink,
      'font-family': 'var(--mono)',
    }, `${formatNumber(item.value, 2)}${unit}`));
  });

  return svg;
}

/** Miniatura de tendencia, del tamaño de una palabra. */
export function sparkline({ points, width = 72, height = 22, color = COLORS.accent }) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  if (points.length < 2) return svg;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (width - 4) + 2;
    const y = height - 3 - ((p.value - min) / span) * (height - 6);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  svg.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'round' }));
  return svg;
}

function formatNumber(v, decimals = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const d = abs >= 100 ? 0 : decimals;
  return v.toFixed(d).replace('.', ',');
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export { COLORS, formatNumber };
