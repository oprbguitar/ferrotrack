/** Vistas clínicas: resumen, historial, gráficos, seguimiento, preguntas y controles. */

import { h, card, num, signed, why, clear } from '../ui/dom.js';
import { lineChart, gauge, barChart, sparkline, COLORS } from '../ui/charts.js';
import { ironMap, axesDiagram, pipelineDiagram } from '../ui/diagrams.js';
import { analyte, dictionary } from '../core/parser.js';
import { compare, series, trend, narrateLab, formatDate, projectToTarget } from '../core/longitudinal.js';
import { questionsFor, LEVEL_LABEL, rules } from '../core/rules.js';
import { axes, overall } from '../core/score.js';
import { formatDate as fdate } from '../core/longitudinal.js';

const CHIP_COLORS = {
  reservas: ['var(--blood-soft)', 'var(--blood)'],
  disponibilidad: ['var(--amber-soft)', '#b57c05'],
  hemograma: ['var(--red-soft)', 'var(--red)'],
  cofactores: ['var(--blue-soft)', 'var(--blue)'],
  inflamacion: ['var(--accent-soft)', 'var(--accent)'],
};

function chip(def) {
  const [bg, fg] = CHIP_COLORS[def.axis] || ['var(--surface-2)', 'var(--ink-3)'];
  return h('span', { class: 'analyte-chip', style: `background:${bg};color:${fg}`, text: def.code || def.short.slice(0, 3) });
}

/** Clasifica un resultado contra el rango que informó el laboratorio. */
function classify(result) {
  if (!result || result.value == null) return { key: 'sin', label: 'Sin dato' };
  const r = result.labRange;
  if (!r) return { key: 'sin', label: 'Sin rango' };
  if (r.low != null && result.value < r.low) return { key: 'bajo', label: 'Bajo' };
  if (r.high != null && result.value > r.high) {
    // Para B12 y folato, por encima del rango no es alarma.
    return { key: 'alto', label: 'Alto' };
  }
  if (r.high != null && result.value > r.high * 0.85) return { key: 'optimo', label: 'Óptimo' };
  return { key: 'normal', label: 'Normal' };
}

const TREND_GLYPH = { sube: '↑', baja: '↓', estable: '→', nuevo: '•' };

// =====================================================================
// RESUMEN
// =====================================================================

export function resumen(ctx) {
  const { caseData, lab, previous, interpretation } = ctx;

  if (!lab) return emptyState(ctx);

  const axisMap = axes({
    lab, profile: caseData.profile, ageMonths: ctx.ageMonths, interpretation,
    nutrition: ctx.nutritionSummary, adherence: ctx.adherence,
  });
  const total = overall(axisMap);
  const deltas = compare(lab, previous);

  return h('div', { class: 'stack' }, [
    statusCard(interpretation, total, axisMap, ctx),
    h('div', { class: 'grid grid-main' }, [
      comparisonCard(lab, previous, deltas),
      changesCard(deltas, ctx),
    ]),
    evolutionCard(ctx),
    h('div', { class: 'grid grid-3' }, [
      nutritionTeaser(ctx),
      nextControlsCard(ctx),
      questionsTeaser(interpretation, ctx),
    ]),
    disclaimer(),
  ]);
}

function statusCard(interpretation, total, axisMap, ctx) {
  const level = interpretation.level;
  const main = interpretation.patterns[0];

  const gaugeColor = {
    verde: 'var(--green)', amarillo: 'var(--amber)',
    naranja: 'var(--orange)', rojo: 'var(--red)',
  }[level];

  return card('Estado actual del hierro', [
    h('div', { class: 'status' }, [
      h('div', {}, [
        h('div', { class: 'status-level' }, [
          h('span', { class: `status-dot level-${level}` }),
          h('span', { class: `status-name level-${level}`, text: LEVEL_LABEL[level] }),
        ]),
        h('p', { class: 'small', text: main ? main.says : 'Aún no hay suficientes indicadores para describir un patrón.' }),
        why('¿Por qué este estado?', [
          ...(main?.because || []),
          `Regla aplicada: <span class="source-tag">${main?.id || '—'}</span> del conjunto <span class="source-tag">${interpretation.ruleset.version}</span>`,
        ]),
      ]),
      h('div', { class: 'center' }, [
        gauge({ value: total.value, color: gaugeColor }),
        h('div', { class: 'tiny muted', style: 'max-width:180px;margin:0 auto' }, [
          'Índice de Recuperación del Hierro',
          h('br'),
          h('span', { text: `resume ${total.basis.length} ejes · cobertura ${total.coverage} %` }),
        ]),
      ]),
      h('div', {}, [
        axesDiagram(axisMap),
        why('¿Cómo se calcula cada eje?', total.basis.map((b) => `<b>${b.label} (${b.score})</b>: ${b.detail} Pesa ${b.weight} % del índice.`)),
      ]),
    ]),
    interpretation.alerts.length ? h('div', { class: 'stack', style: 'margin-top:16px' },
      interpretation.alerts.map((a) => h('div', { class: 'notice notice-danger' }, [
        h('span', { class: 'ico', text: '⚠️' }),
        h('div', {}, [h('b', { text: 'Requiere valoración' }), h('span', { text: a.says })]),
      ]))) : null,
    ctx.onExplain ? h('div', { style: 'margin-top:16px' }, [
      h('button', { class: 'btn btn-sm', onclick: ctx.onExplain, text: 'Ver el seguimiento completo →' }),
    ]) : null,
  ]);
}

function comparisonCard(lab, previous, deltas) {
  const dict = dictionary();
  const order = dict.analytes.map((a) => a.id).filter((id) => lab.results[id]);

  const rows = order.map((id) => {
    const def = analyte(id);
    const result = lab.results[id];
    const d = deltas[id];
    const cls = classify(result);

    return h('tr', {}, [
      h('td', {}, [h('span', { class: 'analyte-cell' }, [
        chip(def),
        h('span', {}, [def.label, ' ', h('span', { class: 'analyte-unit', text: `(${def.displayUnit})` })]),
      ])]),
      h('td', { class: 'num muted', text: d?.previous != null ? num(d.previous, def.decimals) : '—' }),
      h('td', { class: 'num', style: `font-weight:700;color:${cls.key === 'bajo' ? 'var(--red)' : cls.key === 'alto' ? 'var(--amber)' : 'var(--green)'}`,
        text: num(result.value, def.decimals) }),
      h('td', {}, [h('span', {
        class: `trend trend-${d?.quality || 'nuevo'}`,
        title: d?.pct != null ? `${signed(d.pct, 1)} %` : 'primer registro',
        text: `${TREND_GLYPH[d?.direction] || '•'} ${d?.pct != null ? `${signed(d.pct, 0)} %` : 'nuevo'}`,
      })]),
      h('td', {}, [h('span', { class: `pill pill-${cls.key}`, text: cls.label })]),
    ]);
  });

  return card('Comparación de resultados', [
    h('div', { class: 'scroll-x' }, [
      h('table', { class: 'table' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', { text: 'Indicador' }),
          h('th', { class: 'right', text: previous ? fdate(previous.date) : 'Anterior' }),
          h('th', { class: 'right', text: fdate(lab.date) }),
          h('th', { text: 'Tendencia' }),
          h('th', { text: 'Lectura' }),
        ])]),
        h('tbody', {}, rows),
      ]),
    ]),
    h('div', { class: 'legend' }, [
      h('span', {}, [h('i', { style: 'background:var(--green)' }), 'Mejora']),
      h('span', {}, [h('i', { style: 'background:var(--red)' }), 'Empeora']),
      h('span', {}, [h('i', { style: 'background:var(--blue)' }), 'Sin cambios']),
    ]),
    h('p', { class: 'tiny muted', style: 'margin-top:12px' },
      ['La lectura compara contra el rango que informó el laboratorio emisor. Los umbrales clínicos del sistema (OMS) se aplican aparte, en el estado general.']),
  ]);
}

function changesCard(deltas, ctx) {
  const list = Object.values(deltas).filter((d) => !d.isNew);
  const good = list.filter((d) => d.quality === 'mejora');
  const watch = list.filter((d) => d.quality === 'empeora');

  const item = (d) => h('div', { class: 'change-item' }, [
    h('b', { text: d.def.short }),
    h('br'),
    h('span', { class: 'mono small', text: `${num(d.previous, d.def.decimals)} → ${num(d.value, d.def.decimals)} ${d.def.displayUnit}` }),
    h('span', { class: 'small muted', text: `  (${signed(d.pct, 0)} %)` }),
  ]);

  return card('¿Qué cambió desde tu último análisis?', [
    good.length ? h('div', { class: 'change-group good' }, [
      h('h4', {}, ['↑ Cambios positivos']),
      ...good.map(item),
    ]) : null,
    watch.length ? h('div', { class: 'change-group watch' }, [
      h('h4', {}, ['↓ Cambios que requieren seguimiento']),
      ...watch.map(item),
    ]) : null,
    !good.length && !watch.length
      ? h('p', { class: 'small muted', text: 'Sin cambios relevantes respecto del control anterior.' })
      : null,
    ctx.onNavigate ? h('button', {
      class: 'btn btn-ghost btn-sm', style: 'margin-top:8px',
      onclick: () => ctx.onNavigate('seguimiento'),
      text: 'Ver explicación detallada →',
    }) : null,
  ]);
}

const KEY_ANALYTES = [
  { id: 'ferritina', color: COLORS.blood, target: { min: 20, label: 'zona objetivo ≥ 20' } },
  { id: 'sat_transferrina', color: COLORS.amber, limit: { value: 20, label: 'límite ≥ 20 %' } },
  { id: 'hemoglobina', color: COLORS.green },
  { id: 'rdw_cv', color: COLORS.accent, limit: { value: 14.4, label: 'límite ≤ 14,4 %' } },
];

function evolutionCard(ctx) {
  const { labs } = ctx;
  const charts = KEY_ANALYTES.map((spec) => {
    const def = analyte(spec.id);
    const points = series(labs, spec.id);
    if (!points.length) return null;

    return h('div', { class: 'chart-card' }, [
      h('div', { class: 'chart-title' }, [def.short, ' ', h('span', { class: 'unit', text: `(${def.displayUnit})` })]),
      lineChart({
        points, color: spec.color, target: spec.target, limit: spec.limit,
        decimals: def.decimals, unit: def.displayUnit,
        formatDate: (d) => fdate(d).replace(/ \d{4}$/, ''),
      }),
    ]);
  }).filter(Boolean);

  return card('Evolución de tus indicadores clave', [
    charts.length
      ? h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(240px,1fr))' }, charts)
      : h('p', { class: 'muted small', text: 'Hacen falta al menos dos análisis para dibujar la evolución.' }),
  ]);
}

function nutritionTeaser(ctx) {
  const plan = ctx.plan;
  return card('Nutrición para recuperar hierro', [
    plan ? h('div', { class: 'stack' }, [
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', text: `${num(plan.absorbed, 2)} mg` }),
        h('span', { class: 'kpi-label', text: 'hierro absorbido que aporta el plan de hoy' }),
      ]),
      h('div', { class: 'small muted', text: `Cubre el ${plan.coverage} % de la meta diaria de recuperación.` }),
      h('button', {
        class: 'btn btn-primary btn-block', onclick: () => ctx.onNavigate('nutricion'),
        text: 'Ver plan diario completo →',
      }),
    ]) : h('div', { class: 'stack' }, [
      h('p', { class: 'small muted', text: 'Todavía no hay un plan generado para hoy.' }),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => ctx.onNavigate('nutricion'), text: 'Armar mi plan →' }),
    ]),
  ]);
}

function nextControlsCard(ctx) {
  const { labs, caseData } = ctx;
  const items = [];

  for (const lab of labs.slice(-2)) {
    items.push({ date: lab.date, text: 'Análisis registrado', done: true });
  }
  for (const c of caseData.controls || []) {
    items.push({ date: c.date, text: c.label, done: false });
  }

  return card('Próximos controles', [
    items.length ? h('div', { class: 'timeline' }, items.map((it) => h('div', { class: `tl-item ${it.done ? 'done' : ''}` }, [
      h('div', { class: 'tl-date', text: fdate(it.date) }),
      h('div', { class: 'tl-text', text: it.text }),
    ]))) : h('p', { class: 'small muted', text: 'Sin controles programados.' }),
    h('button', { class: 'btn btn-sm', onclick: () => ctx.onNavigate('controles'), text: 'Ver calendario completo' }),
  ]);
}

function questionsTeaser(interpretation, ctx) {
  const questions = questionsFor(interpretation).slice(0, 4);
  return card('Preguntas para tu médico', [
    questions.length ? h('ul', { class: 'small', style: 'padding-left:18px;margin:0' },
      questions.map((q) => h('li', { text: q.text, style: 'margin-bottom:6px' })))
      : h('p', { class: 'small muted', text: 'Sin preguntas sugeridas por ahora.' }),
    h('button', {
      class: 'btn btn-sm', style: 'margin-top:12px',
      onclick: () => ctx.onNavigate('preguntas'), text: 'Ver todas las preguntas →',
    }),
  ]);
}

function disclaimer() {
  return h('div', { class: 'notice notice-warn' }, [
    h('span', { class: 'ico', text: '⚠️' }),
    h('div', {}, [
      h('b', { text: 'Información importante' }),
      h('span', { text: 'Esta aplicación no reemplaza la evaluación médica. Los resultados e interpretaciones son orientativos y deben ser validados por un profesional de la salud.' }),
    ]),
  ]);
}

function emptyState(ctx) {
  return h('div', { class: 'stack' }, [
    card(null, [
      h('div', { class: 'empty' }, [
        h('div', { class: 'big', text: '🩸' }),
        h('h2', { text: 'Todavía no hay ningún análisis' }),
        h('p', { class: 'muted', text: 'Pega el texto de tu informe de laboratorio o escribe los valores a mano. Nada sale de este navegador.' }),
        h('button', { class: 'btn btn-accent', onclick: () => ctx.onNavigate('subir'), text: 'Subir mi primer análisis' }),
      ]),
    ]),
    card('Cómo funciona', [
      h('div', { class: 'diagram' }, [pipelineDiagram()]),
    ]),
  ]);
}

// =====================================================================
// HISTORIAL
// =====================================================================

export function historial(ctx) {
  const { labs } = ctx;
  if (!labs.length) return emptyState(ctx);

  const entries = labs.map((lab, i) => {
    const prev = i > 0 ? labs[i - 1] : null;
    const narrative = narrateLab(lab, prev, i);
    const count = Object.keys(lab.results).length;

    return card(null, [
      h('div', { class: 'spread' }, [
        h('div', {}, [
          h('h3', { text: narrative.title }),
          h('div', { class: 'tiny muted', text: `${count} indicadores · origen: ${lab.source || 'registro manual'}` }),
        ]),
        h('div', { class: 'btn-row' }, [
          h('button', { class: 'btn btn-sm', onclick: () => ctx.onViewLab(lab.id), text: 'Ver detalle' }),
          h('button', { class: 'btn btn-sm', onclick: () => ctx.onDeleteLab(lab.id), text: 'Eliminar' }),
        ]),
      ]),
      h('p', { class: 'small', style: 'margin-top:12px', text: narrative.text }),
      h('div', { class: 'scroll-x' }, [
        h('table', { class: 'table' }, [
          h('tbody', {}, Object.keys(lab.results).map((id) => {
            const def = analyte(id);
            if (!def) return null;
            const r = lab.results[id];
            const points = series(labs.slice(0, i + 1), id);
            return h('tr', {}, [
              h('td', { style: 'width:44%' }, [h('span', { class: 'analyte-cell' }, [chip(def), def.short])]),
              h('td', { class: 'num', text: `${num(r.value, def.decimals)} ${def.displayUnit}` }),
              h('td', { style: 'width:80px' }, [sparkline({ points, color: 'var(--accent)' })]),
              h('td', {}, [h('span', { class: `pill pill-${classify(r).key}`, text: classify(r).label })]),
              h('td', { class: 'tiny muted mono', text: r.loinc ? `LOINC ${r.loinc}` : '' }),
            ]);
          }).filter(Boolean)),
        ]),
      ]),
    ]);
  }).reverse();

  return h('div', { class: 'stack' }, [
    card('Antecedente anónimo generado', [
      h('p', { class: 'small muted' }, [
        'Cada análisis genera un antecedente redactado automáticamente. El conjunto forma una historia clínica del hierro sin ninguna identidad asociada: solo el código ',
        h('span', { class: 'mono', text: ctx.caseData.caseId }),
        '.',
      ]),
    ]),
    ...entries,
  ]);
}

// =====================================================================
// GRÁFICOS
// =====================================================================

export function graficos(ctx) {
  const { labs, lab } = ctx;
  if (!labs.length) return emptyState(ctx);

  const dict = dictionary();
  const present = dict.analytes.filter((a) => series(labs, a.id).length > 0);

  const charts = present.map((def) => {
    const points = series(labs, def.id);
    const t = trend(labs, def.id);
    const last = points[points.length - 1];
    const range = last.labRange;

    return h('div', { class: 'chart-card' }, [
      h('div', { class: 'chart-title' }, [def.label, ' ', h('span', { class: 'unit', text: `(${def.displayUnit})` })]),
      lineChart({
        points,
        color: def.axis === 'reservas' ? COLORS.blood : def.axis === 'disponibilidad' ? COLORS.amber
          : def.axis === 'hemograma' ? COLORS.green : COLORS.blue,
        target: range?.low != null ? { min: range.low, max: range.high, label: 'rango del laboratorio' } : null,
        decimals: def.decimals, unit: def.displayUnit,
        formatDate: (d) => fdate(d).replace(/ \d{4}$/, ''),
      }),
      h('div', { class: 'tiny muted center' }, [
        t.points.length > 1 ? `Tendencia ${t.label} · ${t.perMonth}` : 'Un solo registro',
      ]),
      h('p', { class: 'tiny muted', style: 'margin-top:8px', text: def.plain }),
    ]);
  });

  return h('div', { class: 'stack' }, [
    card('Mapa del hierro', [
      h('p', { class: 'small muted', text: 'Los compartimentos del hierro y cómo se conectan, con los valores del último control.' }),
      h('div', { class: 'diagram' }, [ironMap(lab)]),
    ]),
    card('Todos los indicadores', [
      h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(280px,1fr))' }, charts),
    ]),
  ]);
}

// =====================================================================
// SEGUIMIENTO
// =====================================================================

export function seguimiento(ctx) {
  const { interpretation, labs, lab, previous, caseData } = ctx;
  if (!lab) return emptyState(ctx);

  const deltas = compare(lab, previous);
  const ruleset = rules();

  const projections = [
    { id: 'ferritina', target: 20, label: 'ferritina ≥ 20 ng/mL' },
    { id: 'sat_transferrina', target: 20, label: 'saturación ≥ 20 %' },
  ].map(({ id, target, label }) => {
    const p = projectToTarget(labs, id, target);
    if (!p) return null;
    if (p.alreadyThere) return h('li', { text: `Ya alcanzó ${label}.` });
    if (p.unreachable) return h('li', { text: `Al ritmo actual, ${label} no se alcanza: el indicador no está subiendo.` });
    return h('li', {}, [
      `Al ritmo actual, ${label} llegaría en unos `,
      h('b', { text: `${num(p.months, 1)} meses` }),
      ` (rango ${num(p.range[0], 1)}–${num(p.range[1], 1)}, confianza ${p.confidence}).`,
    ]);
  }).filter(Boolean);

  return h('div', { class: 'stack' }, [
    card('Patrones detectados', [
      interpretation.patterns.length ? h('div', {}, interpretation.patterns.map((p) => h('div', { class: `pattern ${p.level}` }, [
        h('h3', { text: p.title }),
        h('p', { text: p.says }),
        why('¿En qué se basó?', [
          ...p.because,
          `Regla <span class="source-tag">${p.id}</span> · conjunto <span class="source-tag">${interpretation.ruleset.version}</span> (revisado ${interpretation.ruleset.revised})`,
        ]),
      ]))) : h('p', { class: 'muted small', text: 'No se activó ningún patrón con los datos disponibles.' }),
    ]),

    interpretation.missing.length ? card('¿Qué análisis podría faltar?', [
      h('p', { class: 'small muted', text: 'Estos datos no cambian lo que ya se sabe, pero permitirían leerlo con más certeza.' }),
      h('ul', { class: 'small', style: 'padding-left:18px' },
        interpretation.missing.map((m) => h('li', { style: 'margin-bottom:8px' }, [h('b', { text: m.label }), ': ', m.says]))),
    ]) : null,

    projections.length ? card('Proyección de los indicadores', [
      h('p', { class: 'small muted', text: 'Extrapolación del ritmo observado. Es una estimación, no una promesa: depende de que se sostengan las mismas condiciones.' }),
      h('ul', { class: 'small', style: 'padding-left:18px' }, projections),
    ]) : null,

    card('Cambios indicador por indicador', [
      h('div', { class: 'scroll-x' }, [
        h('table', { class: 'table' }, [
          h('thead', {}, [h('tr', {}, [
            h('th', { text: 'Indicador' }), h('th', { class: 'right', text: 'Antes' }),
            h('th', { class: 'right', text: 'Ahora' }), h('th', { class: 'right', text: 'Δ' }),
            h('th', { class: 'right', text: '%' }), h('th', { class: 'right', text: 'Por mes' }),
            h('th', { text: 'Lectura' }),
          ])]),
          h('tbody', {}, Object.values(deltas).filter((d) => !d.isNew).map((d) => h('tr', {}, [
            h('td', { text: d.def.label }),
            h('td', { class: 'num muted', text: num(d.previous, d.def.decimals) }),
            h('td', { class: 'num', text: num(d.value, d.def.decimals) }),
            h('td', { class: 'num', text: signed(d.abs, d.def.decimals) }),
            h('td', { class: 'num', text: `${signed(d.pct, 0)} %` }),
            h('td', { class: 'num muted', text: d.perMonth != null ? signed(d.perMonth, d.def.decimals + 1) : '—' }),
            h('td', {}, [h('span', { class: `trend trend-${d.quality}`, text: d.quality })]),
          ]))),
        ]),
      ]),
    ]),

    card('Umbrales aplicados a este caso', [
      h('div', { class: 'grid grid-2' }, [
        thresholdBlock('Hemoglobina', interpretation.cutoffs.hemoglobina, caseData),
        thresholdBlock('Ferritina', interpretation.cutoffs.ferritina, caseData),
      ]),
      h('hr', { class: 'sep' }),
      h('div', { class: 'small' }, [
        h('b', { text: 'Fuentes del conjunto de reglas' }),
        h('ul', { style: 'padding-left:18px;margin-top:8px' }, ruleset.sources.map((s) => h('li', {}, [
          s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.label }) : s.label,
          s.published ? h('span', { class: 'muted', text: ` · ${s.published}` }) : null,
        ]))),
      ]),
    ]),
  ]);
}

function thresholdBlock(title, cutoff, caseData) {
  if (!cutoff) return h('div', { class: 'small muted', text: `${title}: sin umbral aplicable (falta la edad en el perfil).` });
  return h('div', { class: 'notice notice-info' }, [
    h('span', { class: 'ico', text: '📏' }),
    h('div', {}, [
      h('b', { text: `${title}: ${cutoff.value} ${title === 'Hemoglobina' ? 'g/dL' : 'ng/mL'}` }),
      h('div', { class: 'tiny' }, [
        `Criterio: ${cutoff.label}.`,
        cutoff.adjust ? ` Ajuste por altitud (${caseData.profile.altitude} m): +${cutoff.adjust}.` : '',
        cutoff.inflammation ? ' Se aplicó el umbral para contexto inflamatorio.' : '',
      ]),
    ]),
  ]);
}

// =====================================================================
// PREGUNTAS
// =====================================================================

export function preguntas(ctx) {
  const { interpretation, lab } = ctx;
  if (!lab) return emptyState(ctx);

  const questions = questionsFor(interpretation);
  const text = questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');

  return h('div', { class: 'stack' }, [
    card('Preguntas para llevar a la consulta', [
      h('p', { class: 'small muted', text: 'Salen de los patrones detectados en tu último análisis. Sirven para ordenar la conversación, no para reemplazarla.' }),
      h('ol', { style: 'padding-left:20px' }, questions.map((q) => h('li', { style: 'margin-bottom:12px' }, [
        h('div', { text: q.text }),
        h('div', { class: 'tiny muted', text: `Surge de: ${q.from}` }),
      ]))),
      h('div', { class: 'btn-row', style: 'margin-top:16px' }, [
        h('button', {
          class: 'btn btn-primary',
          onclick: (e) => {
            navigator.clipboard?.writeText(text);
            e.target.textContent = '¡Copiado!';
            setTimeout(() => { e.target.textContent = 'Copiar la lista'; }, 1600);
          },
          text: 'Copiar la lista',
        }),
        h('button', { class: 'btn', onclick: () => window.print(), text: 'Imprimir' }),
      ]),
    ]),
  ]);
}

// =====================================================================
// CONTROLES
// =====================================================================

export function controles(ctx) {
  const { caseData, labs, onAddControl, onRemoveControl } = ctx;
  const controls = caseData.controls || [];

  const items = [
    ...labs.map((l) => ({ date: l.date, label: 'Análisis registrado', done: true })),
    ...controls.map((c) => ({ ...c, done: new Date(c.date) < new Date() })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let dateInput; let labelInput;

  return h('div', { class: 'stack' }, [
    card('Calendario de seguimiento', [
      h('p', { class: 'small muted', text: 'El sistema no fija fechas médicas por su cuenta: las define quien corresponda. Aquí solo se anotan y se recuerdan.' }),
      items.length ? h('div', { class: 'timeline' }, items.map((it) => h('div', { class: `tl-item ${it.done ? 'done' : ''}` }, [
        h('div', { class: 'spread' }, [
          h('div', {}, [
            h('div', { class: 'tl-date', text: formatDate(it.date) }),
            h('div', { class: 'tl-text', text: it.label }),
          ]),
          !it.done && it.id ? h('button', { class: 'btn btn-sm', onclick: () => onRemoveControl(it.id), text: 'Quitar' }) : null,
        ]),
      ]))) : h('p', { class: 'muted small', text: 'Todavía no hay nada en el calendario.' }),
    ]),
    card('Agregar un control', [
      h('div', { class: 'grid grid-2' }, [
        h('div', { class: 'field' }, [
          h('label', { text: 'Fecha' }),
          (dateInput = h('input', { type: 'date' })),
        ]),
        h('div', { class: 'field' }, [
          h('label', { text: 'Qué toca ese día' }),
          (labelInput = h('input', { type: 'text', placeholder: 'Hemograma + ferritina + perfil de hierro' })),
        ]),
      ]),
      h('button', {
        class: 'btn btn-primary',
        onclick: () => {
          if (!dateInput.value) return;
          onAddControl({ date: dateInput.value, label: labelInput.value || 'Control' });
          dateInput.value = ''; labelInput.value = '';
        },
        text: 'Agregar al calendario',
      }),
    ]),
  ]);
}

export { classify, chip, emptyState, disclaimer, clear, barChart };
