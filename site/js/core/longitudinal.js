/**
 * Motor longitudinal.
 *
 * Un análisis nuevo no reemplaza al anterior: se suma a una línea de tiempo.
 * Para cada indicador se calcula la diferencia, el porcentaje, la velocidad por
 * mes, la dirección y la distancia respecto del umbral aplicado.
 */

import { analyte } from './parser.js';

/** Serie completa de un analito a lo largo de todos los análisis. */
export function series(labs, analyteId) {
  return labs
    .filter((lab) => lab.results?.[analyteId]?.value != null)
    .map((lab) => ({
      date: lab.date,
      value: lab.results[analyteId].value,
      labRange: lab.results[analyteId].labRange || null,
      labId: lab.id,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375;

export function monthsBetween(a, b) {
  return (new Date(b) - new Date(a)) / MS_PER_MONTH;
}

/**
 * Compara dos análisis y devuelve un delta por cada indicador presente en ambos.
 * Cuando el indicador solo existe en el más reciente, devuelve un delta "nuevo".
 */
export function compare(current, previous) {
  const out = {};
  if (!current) return out;

  for (const [id, result] of Object.entries(current.results || {})) {
    const def = analyte(id);
    if (!def || result.value == null) continue;

    const before = previous?.results?.[id]?.value ?? null;
    if (before == null) {
      out[id] = { analyte: id, def, value: result.value, previous: null, isNew: true, direction: 'nuevo' };
      continue;
    }

    const abs = round(result.value - before, def.decimals + 1);
    const pct = before === 0 ? null : round((abs / Math.abs(before)) * 100, 1);
    const months = previous ? monthsBetween(previous.date, current.date) : null;
    const perMonth = months && months > 0.2 ? round(abs / months, def.decimals + 2) : null;

    // Umbral de ruido: por debajo de esto el cambio se considera estable.
    const noise = Math.max(Math.abs(before) * 0.03, 10 ** -def.decimals);
    let direction = 'estable';
    if (abs > noise) direction = 'sube';
    else if (abs < -noise) direction = 'baja';

    out[id] = {
      analyte: id,
      def,
      value: result.value,
      previous: before,
      abs,
      pct,
      months: months == null ? null : round(months, 1),
      perMonth,
      direction,
      // "Mejora" o "empeora" depende de hacia dónde conviene que se mueva.
      quality: qualify(direction, def.direction),
    };
  }

  return out;
}

function qualify(direction, preferred) {
  if (direction === 'estable') return 'estable';
  if (preferred === 'higher_better') return direction === 'sube' ? 'mejora' : 'empeora';
  if (preferred === 'lower_better') return direction === 'baja' ? 'mejora' : 'empeora';
  return 'contexto';
}

/**
 * Tendencia sostenida a lo largo de tres o más análisis: sirve para distinguir
 * un rebote puntual de un movimiento real.
 */
export function trend(labs, analyteId) {
  const points = series(labs, analyteId);
  if (points.length < 2) return { points, slope: null, label: 'sin historial suficiente' };

  // Regresión lineal simple sobre meses transcurridos.
  const t0 = new Date(points[0].date);
  const xs = points.map((p) => (new Date(p.date) - t0) / MS_PER_MONTH);
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const den = xs.reduce((acc, x) => acc + (x - mx) ** 2, 0);
  const slope = den === 0 ? 0 : xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0) / den;

  const def = analyte(analyteId);
  const rel = my === 0 ? 0 : (slope / Math.abs(my)) * 100;
  let label = 'estable';
  if (rel > 3) label = 'en ascenso';
  else if (rel < -3) label = 'en descenso';

  return {
    points,
    slope: round(slope, (def?.decimals ?? 2) + 2),
    perMonth: `${slope >= 0 ? '+' : ''}${round(slope, (def?.decimals ?? 2) + 1)} ${def?.displayUnit || ''}/mes`,
    label,
    n,
  };
}

/**
 * Proyecta cuándo un indicador alcanzaría un objetivo si mantuviera su ritmo.
 * Es una extrapolación, no una promesa: se devuelve junto con su incertidumbre.
 */
export function projectToTarget(labs, analyteId, target) {
  const t = trend(labs, analyteId);
  if (!t.slope || t.points.length < 2) return null;
  const last = t.points[t.points.length - 1];
  const gap = target - last.value;
  if (gap <= 0) return { alreadyThere: true, months: 0 };
  if (t.slope <= 0) return { unreachable: true, months: null };
  const months = gap / t.slope;
  if (months > 60) return { unreachable: true, months: null };
  return {
    months: round(months, 1),
    // Con pocos puntos el margen es amplio; se comunica como rango.
    range: [round(months * 0.6, 1), round(months * 1.8, 1)],
    confidence: t.points.length >= 4 ? 'media' : 'baja',
  };
}

/** Redacta el antecedente estructurado que acompaña a cada análisis. */
export function narrateLab(lab, previous, index) {
  const deltas = compare(lab, previous);
  const improved = [];
  const worsened = [];

  for (const d of Object.values(deltas)) {
    if (d.isNew) continue;
    if (d.quality === 'mejora') improved.push(d);
    if (d.quality === 'empeora') worsened.push(d);
  }

  const ordinal = ['Primer', 'Segundo', 'Tercer', 'Cuarto', 'Quinto', 'Sexto'][index] || `${index + 1}.º`;

  if (!previous) {
    return {
      title: `${ordinal} control — ${formatDate(lab.date)}`,
      text: 'Valoración inicial del metabolismo del hierro. Los resultados quedan registrados como línea basal para las comparaciones siguientes.',
      improved, worsened,
    };
  }

  const parts = [];
  if (improved.length) {
    parts.push(`Mejoran ${listNames(improved)}`);
  }
  if (worsened.length) {
    parts.push(`${improved.length ? 'mientras que retroceden' : 'Retroceden'} ${listNames(worsened)}`);
  }
  if (!parts.length) parts.push('Los indicadores se mantienen sin cambios relevantes respecto del control previo');

  return {
    title: `${ordinal} control — ${formatDate(lab.date)}`,
    text: `${parts.join(', ')}. Intervalo desde el control anterior: ${describeGap(previous.date, lab.date)}.`,
    improved, worsened,
  };
}

function listNames(deltas) {
  const names = deltas.slice(0, 4).map((d) => d.def.short.toLowerCase());
  if (deltas.length > 4) names.push(`y ${deltas.length - 4} más`);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function describeGap(a, b) {
  const days = Math.round((new Date(b) - new Date(a)) / 86400000);
  if (days < 45) return `${days} días`;
  const months = Math.round(days / 30.4375);
  return `${months} ${months === 1 ? 'mes' : 'meses'}`;
}

export function formatDate(iso) {
  const [y, m, d] = String(iso).split('-');
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

function round(v, decimals = 2) {
  const f = 10 ** Math.max(0, decimals);
  return Math.round(v * f) / f;
}
