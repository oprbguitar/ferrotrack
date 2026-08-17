/** Vistas de nutrición: plan del día, semana, constructor de platos y proyección. */

import { h, card, field, num } from '../ui/dom.js';
import { barChart, COLORS } from '../ui/charts.js';
import { dayTimeline } from '../ui/diagrams.js';
import { deriveSlots, pretty, summarize, DEFAULT_SCHEDULE } from '../nutrition/schedule.js';
import { planDay, planWeek, eligibleFoods, analyzePlate } from '../nutrition/planner.js';
import { suggestions } from '../nutrition/absorption.js';
import { project } from '../nutrition/projection.js';
import { formatDate } from '../core/longitudinal.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const yieldColor = (y) => (y >= 20 ? 'var(--green)' : y >= 12 ? 'var(--amber)' : 'var(--red)');

// =====================================================================
// PLAN DEL DÍA
// =====================================================================

export function nutricion(ctx) {
  const { foods, caseData, ferritin, plan, onRegenerate, onNavigate } = ctx;
  if (!foods?.length) {
    return card(null, [h('p', { class: 'muted', text: 'La base de alimentos todavía no se cargó.' })]);
  }

  const { slots, adaptations } = deriveSlots(caseData.schedule || DEFAULT_SCHEDULE);
  const projection = project({
    profile: caseData.profile,
    absorbedPerDay: plan.absorbed,
    hemoglobin: ctx.hemoglobin,
    hemoglobinTarget: ctx.hemoglobinTarget,
    ferritin,
  });

  return h('div', { class: 'stack' }, [
    dayHeader(plan, projection, caseData, onRegenerate),

    card('Tu día, hora por hora', [
      h('p', { class: 'small muted', text: summarize(caseData.schedule || DEFAULT_SCHEDULE) }),
      h('div', { class: 'diagram' }, [dayTimeline({ slots, schedule: (caseData.schedule || DEFAULT_SCHEDULE) })]),
      h('p', { class: 'tiny muted center', text: 'El tamaño de cada punto es el peso de esa comida en el aporte de hierro del día. Naranja: tiene que caber en la lonchera.' }),
      adaptations.length ? h('div', { class: 'stack', style: 'margin-top:16px' },
        adaptations.map((a) => h('div', { class: 'notice notice-info' }, [
          h('span', { class: 'ico', text: '🔁' }),
          h('div', { text: a.text }),
        ]))) : null,
      h('button', { class: 'btn btn-sm', style: 'margin-top:12px', onclick: () => onNavigate('horario'), text: 'Cambiar mi horario' }),
    ]),

    card('Plan de hoy', [
      plan.corrections.length ? h('div', { class: 'notice notice-good', style: 'margin-bottom:16px' }, [
        h('span', { class: 'ico', text: '🛠️' }),
        h('div', {}, [
          h('b', { text: 'Correcciones que hizo el planificador' }),
          h('ul', { style: 'padding-left:18px;margin:4px 0 0' }, plan.corrections.map((c) => h('li', { class: 'tiny', text: c }))),
        ]),
      ]) : null,
      h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(300px,1fr))' },
        plan.meals.map((meal) => mealCard(meal, ctx))),
    ]),

    contributionCard(plan),
    projectionCard(projection),

    card('Rendimiento por comida', [
      h('p', { class: 'small muted', text: 'Cuánto hierro entra de verdad en cada momento del día. Una comida con mucho hierro y poco rendimiento es hierro desperdiciado.' }),
      barChart({
        items: plan.meals.map((m) => ({
          label: `${m.slot.time} ${m.slot.label}`,
          value: m.analysis.absorbed,
          color: yieldColor(m.analysis.yield),
        })),
        unit: ' mg',
      }),
    ]),
  ]);
}

function dayHeader(plan, projection, caseData, onRegenerate) {
  const tone = { insuficiente: 'notice-danger', justo: 'notice-warn', bueno: 'notice-good', muy_bueno: 'notice-good' }[projection.verdict.tone];

  return card('Nutrición para recuperar hierro', [
    h('div', { class: 'grid grid-3' }, [
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', style: 'color:var(--blood)', text: `${num(plan.absorbed, 2)} mg` }),
        h('span', { class: 'kpi-label', text: 'hierro absorbido estimado hoy' }),
      ]),
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', text: `${num(plan.totals.ironTotal, 1)} mg` }),
        h('span', { class: 'kpi-label', text: 'hierro en el plato (el de la etiqueta)' }),
      ]),
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', style: `color:${plan.coverage >= 100 ? 'var(--green)' : 'var(--amber)'}`, text: `${plan.coverage} %` }),
        h('span', { class: 'kpi-label', text: 'de la meta diaria de recuperación' }),
      ]),
    ]),
    h('div', { class: `notice ${tone}`, style: 'margin-top:16px' }, [
      h('span', { class: 'ico', text: projection.sufficient ? '📈' : '⚠️' }),
      h('div', {}, [
        h('b', { text: projection.sufficient ? 'El plan alcanza para recuperar' : 'El plan no alcanza para recuperar' }),
        h('span', { text: projection.verdict.text }),
      ]),
    ]),
    h('details', { class: 'why' }, [
      h('summary', { text: '¿De dónde sale la necesidad diaria?' }),
      h('ul', {}, [
        ...projection.requirement.explain.map((e) => h('li', { text: e })),
        h('li', {}, [h('b', { text: `Total: ${num(projection.requirement.total, 2)} mg/día` }), ' de hierro absorbido solo para no perder terreno.']),
        h('li', { text: `Déficit total estimado por acumular: ${projection.deficit.totalMg} mg (fórmula de Ganzoni, peso ${projection.deficit.weightKg} kg).` }),
      ]),
    ]),
    h('div', { class: 'btn-row', style: 'margin-top:16px' }, [
      h('button', { class: 'btn btn-primary', onclick: () => onRegenerate('day'), text: '🎲 Otro plan para hoy' }),
      h('button', { class: 'btn', onclick: () => onRegenerate('week'), text: 'Ver la semana completa' }),
    ]),
    h('p', { class: 'tiny muted', style: 'margin-top:12px' }, [
      `Dieta ${caseData.profile.diet} · presupuesto ${['', 'económico', 'medio', 'amplio'][caseData.profile.budget] || 'medio'} · ${plan.diversity} alimentos distintos hoy.`,
    ]),
  ]);
}

function mealCard(meal, ctx) {
  const { slot, items, analysis } = meal;

  return h('div', { class: 'meal' }, [
    h('div', { class: 'meal-head' }, [
      h('div', {}, [
        h('div', { class: 'meal-time', text: pretty(slot.time) }),
        h('div', { class: 'meal-name', text: slot.label }),
      ]),
      h('div', { class: 'right' }, [
        h('div', { class: 'tiny muted', text: `${slot.minutes} min` }),
        h('div', { class: 'tiny muted', text: `${Math.round(slot.weight * 100)} % del día` }),
      ]),
    ]),

    slot.warning ? h('div', { class: 'notice notice-warn', style: 'margin-bottom:12px;padding:8px 12px' }, [
      h('span', { class: 'ico', text: '⏰' }), h('div', { class: 'tiny', text: slot.warning }),
    ]) : null,

    h('ul', { class: 'meal-items' }, items.map((it) => h('li', {}, [
      h('span', { text: it.food.n }),
      it.role === 'refuerzo' ? h('span', { class: 'role-tag refuerzo', text: 'refuerzo' }) : null,
      h('span', { class: 'grams', text: `${it.grams} g` }),
    ]))),

    h('div', { class: 'yield-bar' }, [
      h('div', {
        class: 'yield-fill',
        style: `width:${Math.min(100, (analysis.yield / 30) * 100)}%;background:${yieldColor(analysis.yield)}`,
      }),
    ]),

    h('div', { class: 'meal-foot' }, [
      h('span', {}, ['Absorbe ', h('b', { text: `${num(analysis.absorbed, 2)} mg` })]),
      h('span', {}, ['de ', h('b', { text: `${num(analysis.totals.ironTotal, 1)} mg` })]),
      h('span', {}, ['Rendimiento ', h('b', { style: `color:${yieldColor(analysis.yield)}`, text: `${analysis.yield} %` })]),
      h('span', {}, [h('b', { text: `${Math.round(analysis.totals.kcal)}` }), ' kcal']),
    ]),

    h('details', { class: 'why' }, [
      h('summary', { text: '¿Por qué rinde así?' }),
      h('ul', {}, factorList(analysis)),
    ]),

    h('p', { class: 'tiny muted', style: 'margin-top:8px', text: slot.note }),
    void ctx,
  ]);
}

function factorList(analysis) {
  const m = analysis.modifiers;
  const t = analysis.totals;
  const rows = [
    ['Vitamina C', `${Math.round(t.vitC)} mg`, m.vitC, m.vitC > 1.05],
    ['Proteína animal', `${Math.round(t.animalProteinGrams)} g`, m.meat, m.meat > 1.05],
    ['Fitatos', `${Math.round(t.phytate)} mg`, m.phytate, m.phytate > 0.95],
    ['Polifenoles', `${Math.round(t.polyphenol)} mg`, m.polyphenol, m.polyphenol > 0.95],
    ['Calcio', `${Math.round(t.calcium)} mg`, m.calcium, m.calcium > 0.95],
  ];

  return [
    ...rows.map(([label, amount, factor, good]) => h('li', {}, [
      `${label} (${amount}): `,
      h('b', { style: `color:${good ? 'var(--green)' : 'var(--red)'}`, text: `×${factor.toFixed(2)}` }),
    ])),
    h('li', {}, [
      'Efecto combinado sobre el hierro vegetal: ',
      h('b', { text: `×${m.total.toFixed(2)}` }),
      ` → absorción del ${analysis.nonHemeRate} %.`,
    ]),
    t.ironHeme > 0.05 ? h('li', {}, [
      `Hierro hemo (${num(t.ironHeme, 2)} mg): se absorbe al ${analysis.hemeRate} %, casi sin obstáculos.`,
    ]) : null,
  ].filter(Boolean);
}

function contributionCard(plan) {
  return card('¿Qué aporta este plan?', [
    h('div', { class: 'grid grid-3' }, [
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', text: `${num(plan.totals.protein, 0)} g` }),
        h('span', { class: 'kpi-label', text: 'proteína' }),
      ]),
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', text: `${num(plan.totals.vitC, 0)} mg` }),
        h('span', { class: 'kpi-label', text: 'vitamina C' }),
      ]),
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', text: `${num(plan.totals.kcal, 0)}` }),
        h('span', { class: 'kpi-label', text: 'kcal' }),
      ]),
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', text: `${num(plan.totals.folate, 0)} µg` }),
        h('span', { class: 'kpi-label', text: 'folato' }),
      ]),
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', text: `${num(plan.totals.b12, 1)} µg` }),
        h('span', { class: 'kpi-label', text: 'vitamina B12' }),
      ]),
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', text: `${num(plan.totals.calcium, 0)} mg` }),
        h('span', { class: 'kpi-label', text: 'calcio' }),
      ]),
    ]),
  ]);
}

function projectionCard(projection) {
  return card('Qué pasaría si comes así todos los días', [
    h('p', { class: 'small muted', text: 'Estimación a partir del hierro que este plan aporta cada día. La velocidad real depende de la causa del déficit y de lo que indique el profesional.' }),

    h('div', { class: 'grid grid-3' }, projection.horizons.map((hz) => h('div', { class: 'horizon' }, [
      h('div', { class: 'horizon-when', text: `${hz.label} · ${hz.sub}` }),
      hz.ferritin != null ? h('div', {}, [
        h('div', { class: 'horizon-value', style: 'color:var(--blood)', text: `${num(hz.ferritin, 1)}` }),
        h('div', { class: 'horizon-range', text: `ferritina ng/mL · rango ${num(hz.range.ferritin[0], 1)}–${num(hz.range.ferritin[1], 1)}` }),
      ]) : h('div', { class: 'muted small', text: 'sin ferritina de partida' }),

      hz.hemoglobinGain > 0.05 ? h('div', { class: 'tiny', style: 'margin-top:4px' },
        [`Hemoglobina: ${num(hz.hemoglobin, 1)} g/dL (${hz.hemoglobinGain > 0 ? '+' : ''}${num(hz.hemoglobinGain, 2)})`]) : null,

      hz.capped ? h('div', { class: 'tiny muted', style: 'margin-top:4px', text: 'A partir de aquí el cuerpo baja la absorción: el depósito ya está lleno.' }) : null,

      h('div', { class: 'horizon-feel' }, [
        h('div', { class: 'icon', text: hz.feeling.icon }),
        h('b', { text: hz.feeling.title }),
        h('p', { text: hz.feeling.text }),
      ]),
    ]))),

    projection.monthsToRepletion ? h('div', { class: 'notice notice-info', style: 'margin-top:16px' }, [
      h('span', { class: 'ico', text: '🗓️' }),
      h('div', {}, [
        h('b', { text: `Reposición completa estimada: ${num(projection.monthsToRepletion, 1)} meses` }),
        h('span', { text: `Sosteniendo ${num(projection.absorbedPerDay, 2)} mg de hierro absorbido al día, con un excedente de ${num(projection.surplus, 2)} mg sobre las pérdidas.` }),
      ]),
    ]) : null,
  ]);
}

// =====================================================================
// SEMANA
// =====================================================================

export function semana(ctx) {
  const { foods, caseData, ferritin, onNavigate } = ctx;
  const week = planWeek({
    foods, profile: caseData.profile, schedule: caseData.schedule || DEFAULT_SCHEDULE,
    ferritin, startDate: new Date(),
  });

  return h('div', { class: 'stack' }, [
    card('Tu semana', [
      h('div', { class: 'grid grid-3' }, [
        h('div', { class: 'kpi' }, [
          h('span', { class: 'kpi-value', text: `${num(week.averageAbsorbed, 2)} mg` }),
          h('span', { class: 'kpi-label', text: 'promedio de hierro absorbido al día' }),
        ]),
        h('div', { class: 'kpi' }, [
          h('span', { class: 'kpi-value', text: String(week.variety) }),
          h('span', { class: 'kpi-label', text: 'alimentos distintos en la semana' }),
        ]),
        h('div', { class: 'kpi' }, [
          h('span', { class: 'kpi-value', text: `${num(week.target, 2)} mg` }),
          h('span', { class: 'kpi-label', text: 'meta diaria' }),
        ]),
      ]),
      h('div', { style: 'margin-top:16px' }, [
        barChart({
          items: week.days.map((d) => ({
            label: `${WEEKDAYS[d.weekday]} ${d.date.slice(8)}`,
            value: d.absorbed,
            color: d.absorbed >= week.target ? 'var(--green)' : 'var(--amber)',
          })),
          max: Math.max(week.target * 1.5, ...week.days.map((d) => d.absorbed)),
          unit: ' mg',
        }),
      ]),
      h('button', { class: 'btn', style: 'margin-top:16px', onclick: () => onNavigate('nutricion'), text: '← Volver al plan de hoy' }),
    ]),

    ...week.days.map((day) => card(`${WEEKDAYS[day.weekday][0].toUpperCase()}${WEEKDAYS[day.weekday].slice(1)} ${formatDate(day.date)}`, [
      h('div', { class: 'spread', style: 'margin-bottom:12px' }, [
        h('span', { class: 'small muted', text: `${day.diversity} alimentos · ${Math.round(day.totals.kcal)} kcal` }),
        h('span', { class: 'mono small', style: `color:${day.absorbed >= day.target ? 'var(--green)' : 'var(--amber)'}`,
          text: `${num(day.absorbed, 2)} mg absorbidos (${day.coverage} %)` }),
      ]),
      h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(200px,1fr))' },
        day.meals.map((m) => h('div', { class: 'small' }, [
          h('div', { class: 'meal-time', text: pretty(m.slot.time) }),
          h('div', { style: 'font-weight:600;margin-bottom:4px', text: m.slot.label }),
          h('div', { class: 'tiny muted', text: m.items.map((i) => i.food.n).join(' · ') }),
        ]))),
    ])),
  ]);
}

// =====================================================================
// CONSTRUCTOR DE PLATOS
// =====================================================================

export function platos(ctx) {
  const { foods, caseData, ferritin } = ctx;
  const catalog = eligibleFoods(foods, caseData.profile);
  const selected = ctx.plateState;

  const container = h('div', { class: 'stack' });

  const render = () => {
    container.replaceChildren(
      card('Constructor de platos', [
        h('p', { class: 'small muted', text: 'Arma una combinación y mira cuánto hierro entra de verdad. No mide cuánto hierro trae el plato: mide qué tan bien está armado para aprovecharlo.' }),
        h('div', { class: 'field' }, [
          h('label', { text: 'Agregar alimento' }),
          foodPicker(catalog, (food) => {
            selected.push({ food, grams: food.porc || 100 });
            render();
          }),
        ]),
        selected.length ? plateTable(selected, render) : h('p', { class: 'muted small', text: 'Todavía no agregaste nada.' }),
      ]),
      selected.length ? plateAnalysis(selected, { ferritin, profile: caseData.profile }, catalog, render) : null,
    );
  };

  render();
  return container;
}

function foodPicker(catalog, onPick) {
  const groups = [...new Set(catalog.map((f) => f.g))];
  const select = h('select', {
    onchange: (e) => {
      const food = catalog.find((f) => f.id === e.target.value);
      if (food) onPick(food);
      e.target.value = '';
    },
  }, [
    h('option', { value: '', text: 'Elegir un alimento…' }),
    ...groups.map((g) => h('optgroup', { label: catalog.find((f) => f.g === g).gLabel },
      catalog.filter((f) => f.g === g).sort((a, b) => a.n.localeCompare(b.n))
        .map((f) => h('option', { value: f.id, text: `${f.n} — ${num(f.fe, 1)} mg Fe/100 g` })))),
  ]);
  return select;
}

function plateTable(selected, rerender) {
  return h('table', { class: 'table' }, [
    h('thead', {}, [h('tr', {}, [
      h('th', { text: 'Alimento' }), h('th', { class: 'right', text: 'Cantidad' }),
      h('th', { class: 'right', text: 'Fe' }), h('th', { class: 'right', text: 'Vit. C' }), h('th', {}),
    ])]),
    h('tbody', {}, selected.map((item, i) => h('tr', {}, [
      h('td', {}, [item.food.n, h('div', { class: 'tiny muted', text: item.food.pu })]),
      h('td', { class: 'right' }, [
        h('input', {
          type: 'number', min: '1', max: '1000', value: String(item.grams),
          style: 'width:80px;text-align:right',
          oninput: (e) => { item.grams = Math.max(1, Number(e.target.value) || 1); rerender(); },
        }),
        h('span', { class: 'tiny muted', text: ' g' }),
      ]),
      h('td', { class: 'num', text: num((item.food.fe * item.grams) / 100, 2) }),
      h('td', { class: 'num', text: num((item.food.c * item.grams) / 100, 0) }),
      h('td', { class: 'right' }, [h('button', {
        class: 'btn btn-sm', onclick: () => { selected.splice(i, 1); rerender(); }, text: 'Quitar',
      })]),
    ]))),
  ]);
}

function plateAnalysis(selected, ctx, catalog, rerender) {
  const analysis = analyzePlate(selected, ctx);
  const tips = suggestions(selected, catalog, { ferritin: ctx.ferritin });

  return card('Análisis de la combinación', [
    h('div', { class: 'grid grid-3' }, [
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', style: `color:${analysis.score >= 60 ? 'var(--green)' : analysis.score >= 35 ? 'var(--amber)' : 'var(--red)'}`,
          text: analysis.score == null ? '—' : `${analysis.score}/100` }),
        h('span', { class: 'kpi-label', text: `compatibilidad para absorber hierro · ${analysis.label}` }),
      ]),
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', style: 'color:var(--blood)', text: `${num(analysis.result.absorbed, 2)} mg` }),
        h('span', { class: 'kpi-label', text: `absorbidos de ${num(analysis.result.totals.ironTotal, 1)} mg del plato` }),
      ]),
      h('div', { class: 'kpi' }, [
        h('span', { class: 'kpi-value', text: `${analysis.pctOfNeed} %` }),
        h('span', { class: 'kpi-label', text: 'de la necesidad diaria de hierro absorbido' }),
      ]),
    ]),

    analysis.notes.length ? h('ul', { class: 'small', style: 'padding-left:18px;margin-top:16px' },
      analysis.notes.map((n) => h('li', { text: n, style: 'margin-bottom:6px' }))) : null,

    tips.length ? h('div', { style: 'margin-top:16px' }, [
      h('h4', { text: 'Cómo mejorarlo', style: 'margin-bottom:8px' }),
      h('div', { class: 'stack' }, tips.map((t) => h('div', { class: 'notice notice-good', style: 'padding:10px 14px' }, [
        h('span', { class: 'ico', text: t.remove ? '↔️' : '➕' }),
        h('div', { class: 'small', style: 'flex:1' }, [t.text]),
        !t.remove ? h('button', {
          class: 'btn btn-sm btn-primary',
          onclick: () => { selected.push({ food: t.food, grams: t.grams }); rerender(); },
          text: 'Agregar',
        }) : null,
      ]))),
    ]) : null,

    h('details', { class: 'why' }, [
      h('summary', { text: 'Ver el cálculo completo' }),
      h('ul', {}, factorList(analysis.result)),
    ]),
  ]);
}

// =====================================================================
// HORARIO
// =====================================================================

export function horario(ctx) {
  const { caseData, onSaveSchedule, onNavigate } = ctx;
  const s = structuredClone(caseData.schedule || DEFAULT_SCHEDULE);

  const container = h('div', { class: 'stack' });

  const render = () => {
    const { slots, adaptations } = deriveSlots(s);

    container.replaceChildren(
      card('Horario del colegio', [
        h('div', { class: 'grid grid-3' }, [
          field('Hora de entrada', h('input', {
            type: 'time', value: s.school.start,
            oninput: (e) => { s.school.start = e.target.value; render(); },
          })),
          field('Hora de salida', h('input', {
            type: 'time', value: s.school.end,
            oninput: (e) => { s.school.end = e.target.value; render(); },
          })),
          field('Traslado (min)', h('input', {
            type: 'number', min: '0', max: '120', value: String(s.school.travelMinutes),
            oninput: (e) => { s.school.travelMinutes = Number(e.target.value) || 0; render(); },
          }), 'Cuánto antes hay que salir de casa'),
        ]),
        h('label', { class: 'check' }, [
          h('input', {
            type: 'checkbox', checked: s.school.enabled,
            onchange: (e) => { s.school.enabled = e.target.checked; render(); },
          }),
          'Hay colegio estos días',
        ]),
      ]),

      card('Recreos', [
        h('p', { class: 'small muted', text: 'Cada recreo es un momento de comida: el plan solo pone ahí cosas que se comen de pie, con la mano y en pocos minutos.' }),
        ...s.breaks.map((br, i) => h('div', { class: 'grid grid-3', style: 'align-items:end' }, [
          field('Nombre', h('input', {
            type: 'text', value: br.label,
            oninput: (e) => { br.label = e.target.value; },
          })),
          field('Empieza', h('input', {
            type: 'time', value: br.start,
            oninput: (e) => { br.start = e.target.value; render(); },
          })),
          h('div', { class: 'row' }, [
            h('div', { style: 'flex:1' }, [field('Duración (min)', h('input', {
              type: 'number', min: '5', max: '120', value: String(br.minutes),
              oninput: (e) => { br.minutes = Number(e.target.value) || 15; render(); },
            }))]),
            h('button', {
              class: 'btn btn-sm', style: 'margin-bottom:16px',
              onclick: () => { s.breaks.splice(i, 1); render(); }, text: 'Quitar',
            }),
          ]),
        ])),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => {
            s.breaks.push({ id: `recreo${s.breaks.length + 1}`, label: `Recreo ${s.breaks.length + 1}`, start: '13:00', minutes: 15 });
            render();
          },
          text: '+ Agregar recreo',
        }),
      ]),

      card('Desayuno', [
        h('div', { class: 'chips', style: 'margin-bottom:16px' }, [
          ['rapido', 'Rápido (antes de salir)'],
          ['completo', 'Completo (hay tiempo de cocinar)'],
          ['ayuno', 'Ayuno (primera comida en el recreo)'],
        ].map(([value, label]) => h('button', {
          class: 'chip', 'aria-pressed': String(s.breakfastMode === value),
          onclick: () => { s.breakfastMode = value; render(); }, text: label,
        }))),
        s.breakfastMode !== 'ayuno' ? h('div', { class: 'grid grid-2' }, [
          field('Hora', h('input', {
            type: 'time', value: s.meals.desayuno.time,
            oninput: (e) => { s.meals.desayuno.time = e.target.value; render(); },
          })),
          field('Cuántos minutos hay', h('input', {
            type: 'number', min: '5', max: '90', value: String(s.meals.desayuno.minutes),
            oninput: (e) => { s.meals.desayuno.minutes = Number(e.target.value) || 15; render(); },
          })),
        ]) : h('div', { class: 'notice notice-info' }, [
          h('span', { class: 'ico', text: '⏳' }),
          h('div', { class: 'small', text: 'En modo ayuno no se desayuna en casa: el primer recreo pasa a ser la primera comida del día y carga más peso en el plan.' }),
        ]),
      ]),

      card('Resto de las comidas', [
        ...['almuerzo', 'merienda', 'cena'].map((key) => h('div', { class: 'grid grid-3', style: 'align-items:end' }, [
          field('Comida', h('input', {
            type: 'text', value: s.meals[key].label,
            oninput: (e) => { s.meals[key].label = e.target.value; },
          })),
          field('Hora', h('input', {
            type: 'time', value: s.meals[key].time,
            oninput: (e) => { s.meals[key].time = e.target.value; render(); },
          })),
          h('div', {}, [
            field('Minutos', h('input', {
              type: 'number', min: '5', max: '120', value: String(s.meals[key].minutes),
              oninput: (e) => { s.meals[key].minutes = Number(e.target.value) || 20; render(); },
            })),
            h('label', { class: 'check', style: 'margin-bottom:16px' }, [
              h('input', {
                type: 'checkbox', checked: s.meals[key].enabled,
                onchange: (e) => { s.meals[key].enabled = e.target.checked; render(); },
              }),
              'Activa',
            ]),
          ]),
        ])),
      ]),

      card('Así queda tu día', [
        h('div', { class: 'diagram' }, [dayTimeline({ slots, schedule: s })]),
        h('table', { class: 'table', style: 'margin-top:16px' }, [
          h('thead', {}, [h('tr', {}, [
            h('th', { text: 'Momento' }), h('th', { text: 'Hora' }), h('th', { text: 'Minutos' }),
            h('th', { class: 'right', text: 'Peso' }), h('th', { text: 'Condición' }),
          ])]),
          h('tbody', {}, slots.map((slot) => h('tr', {}, [
            h('td', { text: slot.label }),
            h('td', { class: 'mono', text: pretty(slot.time) }),
            h('td', { class: 'num', text: String(slot.minutes) }),
            h('td', { class: 'num', text: `${Math.round(slot.weight * 100)} %` }),
            h('td', { class: 'tiny muted', text: slot.portable ? 'lonchera' : slot.quick ? 'rápida' : 'con tiempo' }),
          ]))),
        ]),
        adaptations.length ? h('div', { class: 'stack', style: 'margin-top:16px' },
          adaptations.map((a) => h('div', { class: 'notice notice-info' }, [
            h('span', { class: 'ico', text: '🔁' }), h('div', { class: 'small', text: a.text }),
          ]))) : null,
        slots.filter((x) => x.warning).map((x) => h('div', { class: 'notice notice-warn', style: 'margin-top:8px' }, [
          h('span', { class: 'ico', text: '⏰' }), h('div', { class: 'small', text: x.warning }),
        ])),
      ]),

      h('div', { class: 'btn-row' }, [
        h('button', {
          class: 'btn btn-primary',
          onclick: () => { onSaveSchedule(structuredClone(s)); onNavigate('nutricion'); },
          text: 'Guardar horario y rehacer el plan',
        }),
        h('button', { class: 'btn', onclick: () => onNavigate('nutricion'), text: 'Cancelar' }),
      ]),
    );
  };

  render();
  return container;
}

export { yieldColor, COLORS, planDay };
