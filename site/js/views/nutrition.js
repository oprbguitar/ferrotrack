/**
 * Nutrición: la portada de la aplicación.
 *
 * Es lo primero que se ve. Si todavía no hay un perfil, muestra la pantalla de
 * arranque por rangos (edad, peso, tipo de día). Con perfil, muestra el visor
 * del plan: un día grande con tarjetas de colores que se pueden reproducir en
 * automático, más energía, costo, gráficos y la compra de la semana.
 */

import { h, card, field, num } from '../ui/dom.js';
import { barChart, COLORS } from '../ui/charts.js';
import { dayTimeline } from '../ui/diagrams.js';
import { deriveSlots, pretty, summarize, DEFAULT_SCHEDULE } from '../nutrition/schedule.js';
import { planDay, planWeek, eligibleFoods, analyzePlate } from '../nutrition/planner.js';
import { suggestions } from '../nutrition/absorption.js';
import { project } from '../nutrition/projection.js';
import { formatDate } from '../core/longitudinal.js';
import {
  AGE_RANGES, WEIGHT_RANGES, OCCUPATIONS, DIETS,
  findAge, findWeight, findOccupation, profileFromRanges, scheduleFor, energyReport,
} from '../nutrition/profiles.js';
import { mealCost, dayCost, shoppingList, soles, pricePerKg, foodCost } from '../nutrition/pricing.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const yieldColor = (y) => (y >= 20 ? 'var(--green)' : y >= 12 ? 'var(--amber)' : 'var(--red)');

// Tema de color y emoji por tipo de comida. Cada momento del día tiene el suyo.
const MEAL_THEME = {
  desayuno: { theme: 'sol', emoji: '🌅' },
  recreo: { theme: 'cielo', emoji: '🍎' },
  almuerzo: { theme: 'campo', emoji: '🍲' },
  merienda: { theme: 'uva', emoji: '🥛' },
  cena: { theme: 'atardecer', emoji: '🌙' },
};
const themeFor = (slot) => MEAL_THEME[slot.tag] || MEAL_THEME[slot.id] || MEAL_THEME.merienda;

// Un solo temporizador de reproducción para toda la app.
let autoTimer = null;
const stopAuto = () => { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } };

function profileReady(profile) {
  return profile && profile.ageYears != null && profile.weightKg != null;
}

// =====================================================================
// PORTADA / PLAN
// =====================================================================

export function nutricion(ctx) {
  stopAuto();
  const { foods, caseData } = ctx;

  if (!foods?.length) {
    return card(null, [h('p', { class: 'muted', text: 'La base de alimentos todavía no se cargó.' })]);
  }
  if (!profileReady(caseData.profile)) {
    return onboarding(ctx);
  }
  return planViewer(ctx);
}

// --------------------------------------------------------------- arranque

export function onboarding(ctx) {
  const { onSetupProfile } = ctx;
  const state = {
    ageId: ctx.caseData.profile.ageRange || null,
    weightId: ctx.caseData.profile.weightRange || null,
    occupationId: ctx.caseData.profile.occupation || null,
    diet: ctx.caseData.profile.diet || 'mixta',
  };

  const container = h('div', { class: 'stack onboarding' });

  const pickerGrid = (options, selectedId, onPick, big) => h(
    'div', { class: `pick-grid${big ? ' pick-grid-lg' : ''}` },
    options.map((o) => h('button', {
      type: 'button',
      class: `pick${selectedId === o.id ? ' pick-on' : ''}`,
      onclick: () => { onPick(o.id); render(); },
    }, [
      o.emoji ? h('span', { class: 'pick-emoji', text: o.emoji }) : null,
      h('span', { class: 'pick-label', text: o.label }),
      o.desc ? h('span', { class: 'pick-desc', text: o.desc }) : null,
      o.tag ? h('span', { class: 'pick-tag', text: o.tag }) : null,
    ])),
  );

  const render = () => {
    const ready = state.ageId && state.weightId && state.occupationId;
    const age = state.ageId && findAge(state.ageId);
    const weight = state.weightId && findWeight(state.weightId);

    container.replaceChildren(
      h('section', { class: 'hero hero-welcome' }, [
        h('div', { class: 'hero-emoji', text: '🥗' }),
        h('div', {}, [
          h('h1', { text: 'Arma tu plan de nutrición' }),
          h('p', { class: 'hero-sub', text: 'Comer bien es lo que te da energía para estudiar, trabajar, caminar y jugar. Elige tus rangos y te preparo el menú del día y de la semana, con su costo aproximado.' }),
        ]),
      ]),

      card('1 · ¿Qué edad tienes?', [
        h('p', { class: 'small muted', text: 'Elige el rango. Con el promedio calculo cuánto hierro y energía necesitas.' }),
        pickerGrid(AGE_RANGES, state.ageId, (id) => { state.ageId = id; }),
      ]),

      card('2 · ¿Cuánto pesas más o menos?', [
        h('p', { class: 'small muted', text: 'Un rango basta. Sirve para ajustar las porciones y la meta del día.' }),
        pickerGrid(WEIGHT_RANGES, state.weightId, (id) => { state.weightId = id; }),
      ]),

      card('3 · ¿Cómo es tu día?', [
        h('p', { class: 'small muted', text: 'No es solo para escolares: también para quien trabaja o para en casa. Ajusta los horarios de comida.' }),
        pickerGrid(OCCUPATIONS, state.occupationId, (id) => { state.occupationId = id; }, true),
      ]),

      card('4 · ¿Cómo comes?', [
        pickerGrid(DIETS, state.diet, (id) => { state.diet = id; }, true),
      ]),

      h('div', { class: 'launch' }, [
        ready ? h('p', { class: 'launch-sum', text: `${age.emoji} ${age.tag} · ${weight.label} · ${findOccupation(state.occupationId).label} · promedio ${age.mid} años y ${weight.mid} kg` }) : h('p', { class: 'muted small', text: 'Completa los cuatro pasos para lanzar tu plan.' }),
        h('button', {
          class: 'btn btn-launch',
          disabled: !ready,
          onclick: () => {
            const profile = profileFromRanges({
              ageId: state.ageId, weightId: state.weightId, occupationId: state.occupationId,
              diet: state.diet, base: ctx.caseData.profile,
            });
            onSetupProfile(profile, scheduleFor(state.occupationId));
          },
          text: '🚀 Generar mi plan de nutrición',
        }),
      ]),
    );
  };

  render();
  return container;
}

// --------------------------------------------------------------- visor

function planViewer(ctx) {
  const { foods, caseData, ferritin, onRegenerate, onNavigate } = ctx;
  const schedule = caseData.schedule || DEFAULT_SCHEDULE;

  // La semana entera se calcula una vez; el visor pasa día por día. El día 0 es HOY.
  const week = planWeek({ foods, profile: caseData.profile, schedule, ferritin, startDate: new Date() });

  const view = { index: 0, playing: false };
  const container = h('div', { class: 'stack' });

  const stage = h('div', { class: 'stage' });

  const setIndex = (i) => {
    view.index = (i + week.days.length) % week.days.length;
    drawStage();
  };

  const togglePlay = () => {
    view.playing = !view.playing;
    stopAuto();
    if (view.playing) {
      autoTimer = setInterval(() => {
        if (!document.body.contains(stage)) { stopAuto(); return; }
        setIndex(view.index + 1);
      }, 4500);
    }
    drawHead();
  };

  const head = h('div', {});

  function drawHead() {
    const day = week.days[view.index];
    const cost = dayCost(day);
    const isToday = view.index === 0;

    head.replaceChildren(
      h('section', { class: 'hero hero-plan' }, [
        h('div', { class: 'hero-top' }, [
          h('div', {}, [
            h('div', { class: 'hero-kicker', text: isToday ? '🍽 Plan de hoy' : `Plan · ${cap(WEEKDAYS[day.weekday])} ${formatDate(day.date)}` }),
            h('h1', { text: isToday ? 'Tu menú de hoy' : `Menú del ${WEEKDAYS[day.weekday]}` }),
          ]),
          profileChip(caseData.profile, onNavigate),
        ]),

        h('div', { class: 'hero-kpis' }, [
          kpi(`${num(day.absorbed, 2)} mg`, 'hierro que aprovechas', 'var(--blood)'),
          kpi(`${num(day.totals.kcal, 0)}`, 'kcal del día', 'var(--amber)'),
          kpi(soles(cost), 'costo aproximado', 'var(--green)'),
          kpi(`${day.coverage} %`, 'de tu meta diaria', day.coverage >= 100 ? 'var(--green)' : 'var(--accent)'),
        ]),

        h('div', { class: 'viewer-controls' }, [
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setIndex(view.index - 1), text: '‹ Anterior' }),
          h('button', {
            class: `btn btn-sm ${view.playing ? 'btn-accent' : 'btn-primary'}`,
            onclick: togglePlay,
            text: view.playing ? '⏸ Pausar visor' : '▶ Reproducir semana',
          }),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setIndex(view.index + 1), text: 'Siguiente ›' }),
          h('span', { style: 'flex:1' }),
          h('button', { class: 'btn btn-sm', onclick: () => { stopAuto(); onRegenerate('day'); }, text: '🎲 Cambiar al azar' }),
          h('button', { class: 'btn btn-sm', onclick: () => onNavigate('compra'), text: '🛒 Compra semanal' }),
        ]),

        h('div', { class: 'viewer-dots' }, week.days.map((d, i) => h('button', {
          type: 'button',
          class: `vdot${i === view.index ? ' on' : ''}`,
          title: `${cap(WEEKDAYS[d.weekday])} ${formatDate(d.date)}`,
          onclick: () => { stopAuto(); view.playing = false; setIndex(i); },
          text: i === 0 ? 'HOY' : cap(WEEKDAYS[d.weekday]).slice(0, 3),
        }))),
      ]),
    );
  }

  function drawStage() {
    const day = week.days[view.index];
    drawHead();

    const projection = project({
      profile: caseData.profile,
      absorbedPerDay: day.absorbed,
      hemoglobin: ctx.hemoglobin,
      hemoglobinTarget: ctx.hemoglobinTarget,
      ferritin,
    });
    const energy = energyReport(day, caseData.profile);

    stage.replaceChildren(
      day.corrections?.length ? h('div', { class: 'notice notice-good' }, [
        h('span', { class: 'ico', text: '🛠️' }),
        h('div', {}, [
          h('b', { text: 'Ajustes que hice para que rinda más' }),
          h('ul', { style: 'padding-left:18px;margin:4px 0 0' }, day.corrections.map((c) => h('li', { class: 'tiny', text: c }))),
        ]),
      ]) : null,

      h('div', { class: 'meal-grid' }, day.meals.map((meal, i) => mealCard(meal, i))),

      energyCard(energy),

      h('div', { class: 'grid grid-2' }, [
        contributionCard(day),
        perMealChart(day),
      ]),

      projectionCard(projection),
    );
  }

  container.append(head, stage);
  drawStage();
  return container;
}

function profileChip(profile, onNavigate) {
  const age = findAge(profile.ageRange);
  const occ = findOccupation(profile.occupation);
  return h('button', {
    class: 'profile-chip',
    onclick: () => onNavigate('perfil'),
    title: 'Editar mi perfil',
  }, [
    h('span', { class: 'pc-emoji', text: occ.emoji }),
    h('span', {}, [
      h('span', { class: 'pc-line', text: `${age.tag} · ${profile.weightKg} kg` }),
      h('span', { class: 'pc-sub', text: `${occ.label} · ${dietLabel(profile.diet)} · editar` }),
    ]),
  ]);
}

const dietLabel = (d) => ({ mixta: 'como de todo', vegetariana: 'vegetariana', vegana: 'vegana' }[d] || d);

function kpi(value, label, color) {
  return h('div', { class: 'hkpi' }, [
    h('span', { class: 'hkpi-value', style: color ? `color:${color}` : null, text: value }),
    h('span', { class: 'hkpi-label', text: label }),
  ]);
}

// --------------------------------------------------------------- tarjeta de comida

function mealCard(meal, order) {
  const { slot, items, analysis } = meal;
  const t = themeFor(slot);
  const cost = mealCost(items);

  return h('article', {
    class: `mealx mealx--${t.theme}`,
    style: `--i:${order}`,
  }, [
    h('header', { class: 'mealx-head' }, [
      h('span', { class: 'mealx-emoji', text: t.emoji }),
      h('div', { style: 'flex:1' }, [
        h('div', { class: 'mealx-name', text: slot.label }),
        h('div', { class: 'mealx-time', text: pretty(slot.time) }),
      ]),
      h('div', { class: 'mealx-cost', text: soles(cost) }),
    ]),

    slot.warning ? h('div', { class: 'mealx-warn', text: `⏰ ${slot.warning}` }) : null,

    h('ul', { class: 'mealx-items' }, items.map((it) => h('li', {}, [
      h('span', { class: 'mi-name' }, [
        it.food.n,
        it.role === 'refuerzo' ? h('span', { class: 'mi-tag', text: 'refuerzo' }) : null,
      ]),
      h('span', { class: 'mi-grams', text: `${it.grams} g` }),
      h('span', { class: 'mi-kcal', text: `${Math.round((it.food.kcal * it.grams) / 100)} kcal` }),
    ]))),

    h('div', { class: 'mealx-foot' }, [
      chipStat('🩸', `${num(analysis.absorbed, 2)} mg`, 'hierro'),
      chipStat('🔥', `${Math.round(analysis.totals.kcal)}`, 'kcal'),
      chipStat('📈', `${analysis.yield}%`, 'rinde', yieldColor(analysis.yield)),
    ]),

    slot.note ? h('p', { class: 'mealx-note', text: slot.note }) : null,
  ]);
}

function chipStat(emoji, value, label, color) {
  return h('span', { class: 'cstat' }, [
    h('span', { class: 'cstat-emoji', text: emoji }),
    h('b', { style: color ? `color:${color}` : null, text: value }),
    h('span', { class: 'cstat-label', text: label }),
  ]);
}

// --------------------------------------------------------------- energía

function energyCard(energy) {
  const bar = Math.min(100, Math.round(energy.ratio * 100));
  const tone = energy.level === 'alto' ? 'var(--green)' : energy.level === 'medio' ? 'var(--amber)' : 'var(--orange)';

  return h('section', { class: 'card energy-card' }, [
    h('div', { class: 'energy-head' }, [
      h('span', { class: 'energy-emoji', text: '⚡' }),
      h('div', { style: 'flex:1' }, [
        h('div', { class: 'card-title', style: 'margin:0', text: 'Con esta comida vas a poder' }),
        h('div', { class: 'energy-headline', text: energy.headline }),
      ]),
      h('div', { class: 'energy-num' }, [
        h('b', { text: `${energy.kcal}` }),
        h('span', { class: 'tiny muted', text: `de ~${energy.need} kcal que gastas` }),
      ]),
    ]),
    h('div', { class: 'energy-track' }, [
      h('div', { class: 'energy-fill', style: `width:${bar}%;background:${tone}` }),
    ]),
    h('div', { class: 'ability-grid' }, energy.abilities.map((a) => h('div', {
      class: `ability${a.ok ? ' ability-on' : ''}`,
    }, [
      h('span', { class: 'ability-emoji', text: a.emoji }),
      h('span', { text: a.text }),
    ]))),
  ]);
}

// --------------------------------------------------------------- gráficos

function contributionCard(plan) {
  const rows = [
    ['proteína', num(plan.totals.protein, 0), 'g'],
    ['vitamina C', num(plan.totals.vitC, 0), 'mg'],
    ['calcio', num(plan.totals.calcium, 0), 'mg'],
    ['folato', num(plan.totals.folate, 0), 'µg'],
    ['vitamina B12', num(plan.totals.b12, 1), 'µg'],
    ['zinc', num(plan.totals.zinc, 1), 'mg'],
  ];
  return card('Qué más te aporta el día', [
    h('div', { class: 'nutri-grid' }, rows.map(([label, value, unit]) => h('div', { class: 'nutri-cell' }, [
      h('span', { class: 'nutri-value', text: `${value} ${unit}` }),
      h('span', { class: 'nutri-label', text: label }),
    ]))),
  ]);
}

function perMealChart(plan) {
  return card('Hierro que rinde por comida', [
    h('p', { class: 'small muted', text: 'Cuánto hierro entra de verdad en cada momento. Verde: bien combinado.' }),
    barChart({
      items: plan.meals.map((m) => ({
        label: `${pretty(m.slot.time)} ${m.slot.label}`,
        value: m.analysis.absorbed,
        color: yieldColor(m.analysis.yield),
      })),
      unit: ' mg',
    }),
  ]);
}

function projectionCard(projection) {
  const tone = { insuficiente: 'notice-danger', justo: 'notice-warn', bueno: 'notice-good', muy_bueno: 'notice-good' }[projection.verdict.tone];
  return card('Si comes así todos los días', [
    h('div', { class: `notice ${tone}`, style: 'margin-bottom:16px' }, [
      h('span', { class: 'ico', text: projection.sufficient ? '📈' : '⚠️' }),
      h('div', {}, [
        h('b', { text: projection.sufficient ? 'Vas a recuperar terreno' : 'Todavía no alcanza para recuperar' }),
        h('span', { text: projection.verdict.text }),
      ]),
    ]),
    h('div', { class: 'grid grid-3' }, projection.horizons.map((hz) => h('div', { class: 'horizon' }, [
      h('div', { class: 'horizon-when', text: `${hz.label} · ${hz.sub}` }),
      h('div', { class: 'horizon-feel' }, [
        h('div', { class: 'icon', text: hz.feeling.icon }),
        h('b', { text: hz.feeling.title }),
        h('p', { text: hz.feeling.text }),
      ]),
    ]))),
  ]);
}

// =====================================================================
// SEMANA
// =====================================================================

export function semana(ctx) {
  stopAuto();
  const { foods, caseData, ferritin, onNavigate } = ctx;
  if (!profileReady(caseData.profile)) return onboarding(ctx);

  const week = planWeek({
    foods, profile: caseData.profile, schedule: caseData.schedule || DEFAULT_SCHEDULE,
    ferritin, startDate: new Date(),
  });
  const weekCost = week.days.reduce((a, d) => a + dayCost(d), 0);

  return h('div', { class: 'stack' }, [
    card('Tu semana completa', [
      h('div', { class: 'grid grid-3' }, [
        h('div', { class: 'kpi' }, [
          h('span', { class: 'kpi-value', text: `${num(week.averageAbsorbed, 2)} mg` }),
          h('span', { class: 'kpi-label', text: 'hierro absorbido al día (promedio)' }),
        ]),
        h('div', { class: 'kpi' }, [
          h('span', { class: 'kpi-value', style: 'color:var(--green)', text: soles(weekCost) }),
          h('span', { class: 'kpi-label', text: 'costo aproximado de la semana' }),
        ]),
        h('div', { class: 'kpi' }, [
          h('span', { class: 'kpi-value', text: String(week.variety) }),
          h('span', { class: 'kpi-label', text: 'alimentos distintos en la semana' }),
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
      h('div', { class: 'btn-row', style: 'margin-top:16px' }, [
        h('button', { class: 'btn btn-primary', onclick: () => onNavigate('nutricion'), text: '‹ Volver al visor del día' }),
        h('button', { class: 'btn', onclick: () => onNavigate('compra'), text: '🛒 Ver la compra de la semana' }),
      ]),
    ]),

    ...week.days.map((day) => {
      const cost = dayCost(day);
      return h('section', { class: 'card weekday-card' }, [
        h('div', { class: 'spread', style: 'margin-bottom:12px' }, [
          h('div', {}, [
            h('div', { class: 'weekday-name', text: `${cap(WEEKDAYS[day.weekday])} ${formatDate(day.date)}` }),
            h('span', { class: 'small muted', text: `${day.diversity} alimentos · ${Math.round(day.totals.kcal)} kcal · ${soles(cost)}` }),
          ]),
          h('span', { class: 'mono small', style: `color:${day.absorbed >= day.target ? 'var(--green)' : 'var(--amber)'}`,
            text: `${num(day.absorbed, 2)} mg (${day.coverage} %)` }),
        ]),
        h('div', { class: 'week-meals' }, day.meals.map((m) => {
          const t = themeFor(m.slot);
          return h('div', { class: `week-meal week-meal--${t.theme}` }, [
            h('div', { class: 'wm-top', text: `${t.emoji} ${m.slot.label}` }),
            h('div', { class: 'tiny', text: m.items.map((i) => i.food.n).join(' · ') }),
          ]);
        })),
      ]);
    }),
  ]);
}

// =====================================================================
// COMPRA SEMANAL
// =====================================================================

export function compra(ctx) {
  stopAuto();
  const { foods, caseData, ferritin, onNavigate } = ctx;
  if (!profileReady(caseData.profile)) return onboarding(ctx);

  const week = planWeek({
    foods, profile: caseData.profile, schedule: caseData.schedule || DEFAULT_SCHEDULE,
    ferritin, startDate: new Date(),
  });
  const list = shoppingList(week);

  return h('div', { class: 'stack' }, [
    h('section', { class: 'hero hero-shop' }, [
      h('div', { class: 'hero-emoji', text: '🛒' }),
      h('div', { style: 'flex:1' }, [
        h('h1', { text: 'Tu compra de la semana' }),
        h('p', { class: 'hero-sub', text: 'Todo lo que el plan usa en 7 días, junto y con precio aproximado de mercado peruano. Llévalo así al mercado.' }),
      ]),
      h('div', { class: 'shop-total' }, [
        h('span', { class: 'shop-total-value', text: soles(list.total) }),
        h('span', { class: 'tiny', text: `≈ ${soles(list.perDay)} por día` }),
      ]),
    ]),

    h('div', { class: 'notice notice-info' }, [
      h('span', { class: 'ico', text: '💡' }),
      h('div', { class: 'small' }, [
        h('b', { text: 'Precios referenciales' }),
        'Son precios de mercado de barrio y cambian por temporada y región. Úsalo como estimación para saber si te alcanza, no como cuenta exacta.',
      ]),
    ]),

    ...list.groups.map((g) => h('section', { class: 'card shop-group' }, [
      h('div', { class: 'shop-group-head' }, [
        h('span', { class: 'card-title', style: 'margin:0', text: g.label }),
        h('span', { class: 'shop-group-total', text: soles(g.soles) }),
      ]),
      h('table', { class: 'table shop-table' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', { text: 'Alimento' }), h('th', { text: 'Compra' }),
          h('th', { class: 'right', text: 'S/ x kg' }), h('th', { class: 'right', text: 'Costo' }),
        ])]),
        h('tbody', {}, g.items.map((it) => h('tr', {}, [
          h('td', { text: it.food.n }),
          h('td', { class: 'small', text: it.buyLabel }),
          h('td', { class: 'num muted', text: soles(it.pricePerKg) }),
          h('td', { class: 'num', text: soles(it.soles) }),
        ]))),
      ]),
    ])),

    h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn btn-primary', onclick: () => onNavigate('nutricion'), text: '‹ Volver al plan' }),
      h('button', { class: 'btn', onclick: () => onNavigate('semana'), text: 'Ver el detalle de la semana' }),
    ]),
  ]);
}

// =====================================================================
// PERFIL (rangos) — reemplaza el perfil clínico
// =====================================================================

export function perfil(ctx) {
  const { caseData, onSetupProfile, onNavigate } = ctx;
  const p = caseData.profile;
  const state = {
    ageId: p.ageRange || '10-13',
    weightId: p.weightRange || '50-60',
    occupationId: p.occupation || 'colegio',
    diet: p.diet || 'mixta',
    budget: p.budget || 2,
  };

  const container = h('div', { class: 'stack' });

  const row = (title, options, key, big) => card(title, [
    h('div', { class: `pick-grid${big ? ' pick-grid-lg' : ''}` }, options.map((o) => h('button', {
      type: 'button', class: `pick${state[key] === o.id ? ' pick-on' : ''}`,
      onclick: () => { state[key] = o.id; render(); },
    }, [
      o.emoji ? h('span', { class: 'pick-emoji', text: o.emoji }) : null,
      h('span', { class: 'pick-label', text: o.label }),
      o.desc ? h('span', { class: 'pick-desc', text: o.desc }) : null,
    ]))),
  ]);

  const render = () => {
    container.replaceChildren(
      h('section', { class: 'hero hero-shop' }, [
        h('div', { class: 'hero-emoji', text: '👤' }),
        h('div', { style: 'flex:1' }, [
          h('h1', { text: 'Mi perfil' }),
          h('p', { class: 'hero-sub', text: 'Cambia tus rangos cuando quieras: el plan y el costo se recalculan al instante.' }),
        ]),
      ]),
      row('Edad', AGE_RANGES, 'ageId'),
      row('Peso', WEIGHT_RANGES, 'weightId'),
      row('Tu día', OCCUPATIONS, 'occupationId', true),
      row('Alimentación', DIETS, 'diet', true),
      card('Presupuesto', [
        h('div', { class: 'pick-grid pick-grid-lg' }, [
          { id: 1, label: 'Ajustado', emoji: '🪙' }, { id: 2, label: 'Medio', emoji: '💵' }, { id: 3, label: 'Amplio', emoji: '💳' },
        ].map((o) => h('button', {
          type: 'button', class: `pick${state.budget === o.id ? ' pick-on' : ''}`,
          onclick: () => { state.budget = o.id; render(); },
        }, [h('span', { class: 'pick-emoji', text: o.emoji }), h('span', { class: 'pick-label', text: o.label })]))),
      ]),
      h('div', { class: 'btn-row' }, [
        h('button', {
          class: 'btn btn-launch',
          onclick: () => {
            const profile = profileFromRanges({
              ageId: state.ageId, weightId: state.weightId, occupationId: state.occupationId,
              diet: state.diet, budget: state.budget, base: caseData.profile,
            });
            onSetupProfile(profile, scheduleFor(state.occupationId));
          },
          text: '✅ Guardar y rehacer el plan',
        }),
        h('button', { class: 'btn', onclick: () => onNavigate('nutricion'), text: 'Volver sin cambios' }),
      ]),
    );
  };

  render();
  return container;
}

// =====================================================================
// CONSTRUCTOR DE PLATOS (se mantiene, con costo)
// =====================================================================

export function platos(ctx) {
  stopAuto();
  const { foods, caseData, ferritin } = ctx;
  const catalog = eligibleFoods(foods, caseData.profile);
  const selected = ctx.plateState;

  const container = h('div', { class: 'stack' });

  const render = () => {
    container.replaceChildren(
      card('Constructor de platos', [
        h('p', { class: 'small muted', text: 'Arma una combinación y mira cuánto hierro entra de verdad y cuánto cuesta.' }),
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
  return h('select', {
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
}

function plateTable(selected, rerender) {
  return h('table', { class: 'table' }, [
    h('thead', {}, [h('tr', {}, [
      h('th', { text: 'Alimento' }), h('th', { class: 'right', text: 'Cantidad' }),
      h('th', { class: 'right', text: 'Fe' }), h('th', { class: 'right', text: 'Costo' }), h('th', {}),
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
      h('td', { class: 'num muted', text: soles(foodCost(item.food, item.grams)) }),
      h('td', { class: 'right' }, [h('button', {
        class: 'btn btn-sm', onclick: () => { selected.splice(i, 1); rerender(); }, text: 'Quitar',
      })]),
    ]))),
  ]);
}

function plateAnalysis(selected, ctx, catalog, rerender) {
  const analysis = analyzePlate(selected, ctx);
  const tips = suggestions(selected, catalog, { ferritin: ctx.ferritin });
  const cost = mealCost(selected);

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
        h('span', { class: 'kpi-value', style: 'color:var(--green)', text: soles(cost) }),
        h('span', { class: 'kpi-label', text: 'costo aproximado del plato' }),
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
  ]);
}

// =====================================================================
// HORARIO (se mantiene)
// =====================================================================

export function horario(ctx) {
  stopAuto();
  const { caseData, onSaveSchedule, onNavigate } = ctx;
  const s = structuredClone(caseData.schedule || DEFAULT_SCHEDULE);

  const container = h('div', { class: 'stack' });

  const render = () => {
    const { slots, adaptations } = deriveSlots(s);

    container.replaceChildren(
      card('Horario del día', [
        h('p', { class: 'small muted', text: summarize(s) }),
        h('label', { class: 'check', style: 'margin-bottom:12px' }, [
          h('input', {
            type: 'checkbox', checked: s.school.enabled,
            onchange: (e) => { s.school.enabled = e.target.checked; render(); },
          }),
          'Voy al colegio estos días',
        ]),
        s.school.enabled ? h('div', { class: 'grid grid-3' }, [
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
          })),
        ]) : null,
      ]),

      card('Horas de comida', [
        ...['desayuno', 'almuerzo', 'merienda', 'cena'].map((key) => h('div', { class: 'grid grid-3', style: 'align-items:end' }, [
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
        adaptations.length ? h('div', { class: 'stack', style: 'margin-top:16px' },
          adaptations.map((a) => h('div', { class: 'notice notice-info' }, [
            h('span', { class: 'ico', text: '🔁' }), h('div', { class: 'small', text: a.text }),
          ]))) : null,
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

const cap = (str) => (str ? str[0].toUpperCase() + str.slice(1) : str);

export { yieldColor, COLORS, planDay };
