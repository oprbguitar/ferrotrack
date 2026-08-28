/**
 * FerroTrack — arranque y enrutado.
 *
 * Une el motor clínico, el motor nutricional y las vistas. Todo el estado vive
 * en el navegador; esta capa solo decide qué se dibuja y recalcula lo que
 * corresponde cuando algo cambia.
 */

import * as store from './core/store.js';
import { loadDictionary } from './core/parser.js';
import { loadRules, interpret, hemoglobinCutoff } from './core/rules.js';
import { compare } from './core/longitudinal.js';
import { loadFoods, refreshFromLive } from './nutrition/live.js';
import { planDay } from './nutrition/planner.js';
import { DEFAULT_SCHEDULE } from './nutrition/schedule.js';
import { maintenanceRequirement } from './nutrition/projection.js';
import { h, clear } from './ui/dom.js';
import { bloodDrop } from './ui/diagrams.js';
import * as coach from './ui/coach.js';
import * as clinical from './views/clinical.js';
import * as nutrition from './views/nutrition.js';
import * as settings from './views/settings.js';

const BASE = new URL('.', import.meta.url).pathname.replace(/js\/$/, '');

const ROUTES = [
  { id: 'nutricion', label: 'Plan de hoy', icon: '🍽', render: nutrition.nutricion },
  { id: 'semana', label: 'Plan de la semana', icon: '📅', render: nutrition.semana },
  { id: 'compra', label: 'Compra semanal', icon: '🛒', render: nutrition.compra },
  { id: 'plato', label: 'Arma tu plato', icon: '🍳', render: nutrition.platos },
  { id: 'perfil', label: 'Mi perfil', icon: '👤', render: nutrition.perfil },
  { id: 'config', label: 'Configuración', icon: '⚙️', render: settings.config },
];

// Rutas alcanzables pero que no ocupan lugar en el menú: la parte clínica sigue
// disponible por enlace directo para quien tenga análisis, sin recargar la portada.
const HIDDEN_ROUTES = [
  { id: 'horario', label: 'Mi horario', render: nutrition.horario },
  { id: 'subir', label: 'Subir análisis', render: settings.subir },
  { id: 'resumen', label: 'Resumen clínico', render: clinical.resumen },
  { id: 'historial', label: 'Historial de análisis', render: clinical.historial },
  { id: 'graficos', label: 'Gráficos clínicos', render: clinical.graficos },
];

const ALL_ROUTES = [...ROUTES, ...HIDDEN_ROUTES];

const app = {
  route: 'nutricion',
  foods: [],
  foodsVersion: null,
  plate: [],
  planCache: null,
  planSeed: 0,
};

// --------------------------------------------------------------- contexto

/** Reúne todo lo que las vistas necesitan, ya calculado una sola vez. */
function buildContext() {
  const caseData = store.get();
  const labs = store.labsChrono(caseData);
  const lab = labs[labs.length - 1] || null;
  const previous = labs[labs.length - 2] || null;
  const ageMonths = lab ? store.ageMonthsAt(caseData, lab.date) : null;

  const symptoms = caseData.symptoms?.[caseData.symptoms.length - 1]?.items || [];
  const interventionActive = (caseData.interventions || []).some((i) => !i.end);

  const interpretation = lab
    ? interpret({ lab, previous, profile: caseData.profile, ageMonths, interventionActive, symptoms })
    : null;

  const ferritin = lab?.results?.ferritina?.value ?? null;
  const hemoglobin = lab?.results?.hemoglobina?.value ?? null;
  const hbCut = hemoglobinCutoff(caseData.profile, ageMonths);

  const plan = app.foods.length ? currentPlan(caseData, ferritin) : null;
  const need = maintenanceRequirement(caseData.profile);

  return {
    caseData, labs, lab, previous, ageMonths, interpretation,
    ferritin, hemoglobin, hemoglobinTarget: hbCut?.value ?? null,
    foods: app.foods, foodsVersion: app.foodsVersion,
    plan, plateState: app.plate, currentSymptoms: symptoms,
    nutritionSummary: plan ? { absorbedMg: plan.absorbed, requirementMg: need.total * 2.2 } : null,
    adherence: adherenceOf(caseData),

    onNavigate: navigate,
    onSaveLab: saveLab,
    onDeleteLab: deleteLab,
    onViewLab: (id) => { navigate('historial'); void id; },
    onSaveProfile: saveProfile,
    onSetupProfile: setupProfile,
    onSaveSettings: saveSettings,
    onSaveSchedule: saveSchedule,
    onAddControl: addControl,
    onRemoveControl: removeControl,
    onRegenerate: regenerate,
    onReset: resetAll,
    onNewCase: newCase,
    onImport: importCase,
    onExplain: () => navigate('seguimiento'),
  };
}

function adherenceOf(caseData) {
  const controls = caseData.controls || [];
  const past = controls.filter((c) => new Date(c.date) < new Date());
  if (!past.length) return null;
  const done = past.filter((c) => caseData.labs.some((l) => Math.abs(new Date(l.date) - new Date(c.date)) < 12096e5));
  return { done: done.length, total: past.length };
}

function currentPlan(caseData, ferritin) {
  const key = `${new Date().toISOString().slice(0, 10)}#${app.planSeed}#${caseData.profile.diet}#${caseData.profile.budget}#${(caseData.profile.dislikes || []).join(',')}#${JSON.stringify(caseData.schedule || {})}`;
  if (app.planCache?.key === key) return app.planCache.plan;

  const plan = planDay({
    foods: app.foods,
    profile: caseData.profile,
    schedule: caseData.schedule || DEFAULT_SCHEDULE,
    ferritin: ferritin ?? 15,
    dateKey: key,
  });
  app.planCache = { key, plan };
  return plan;
}

// --------------------------------------------------------------- acciones

function navigate(route) {
  if (!ALL_ROUTES.some((r) => r.id === route)) return;
  app.route = route;
  location.hash = `#/${route}`;
  render();
  document.querySelector('.main')?.scrollTo?.({ top: 0 });
}

function saveLab(entry) {
  const caseData = store.get();

  store.update((c) => {
    // El informe suele traer también la columna del control anterior. Guardarla
    // como un análisis propio es lo que permite comparar desde el primer día.
    if (entry.previousDate && !c.labs.some((l) => l.date === entry.previousDate)) {
      const previousResults = {};
      for (const [id, r] of Object.entries(entry.results)) {
        if (r.previousInReport == null) continue;
        previousResults[id] = {
          analyte: id, loinc: r.loinc, value: r.previousInReport,
          unit: r.unit, ucum: r.ucum, labRange: r.labRange, previousInReport: null,
        };
      }
      if (Object.keys(previousResults).length) {
        c.labs.push({
          id: `lab-${Date.now()}-prev`,
          date: entry.previousDate,
          results: previousResults,
          source: 'columna de resultado anterior del informe',
          rulesetVersion: c.settings.rulesetVersion,
          createdAt: new Date().toISOString(),
        });
      }
    }

    const existing = c.labs.findIndex((l) => l.date === entry.date);
    const record = {
      id: existing >= 0 ? c.labs[existing].id : `lab-${Date.now()}`,
      date: entry.date,
      results: entry.results,
      source: entry.source,
      privacyRemoved: entry.privacyRemoved || 0,
      rulesetVersion: c.settings.rulesetVersion,
      createdAt: new Date().toISOString(),
    };
    if (existing >= 0) c.labs[existing] = record; else c.labs.push(record);

    // Edad y sexo detectados: solo se rellenan si el perfil está vacío.
    if (entry.hints?.ageYears != null && c.profile.ageYears == null) {
      c.profile.ageYears = entry.hints.ageYears;
      c.profile.ageAsOf = entry.date;
    }
    if (entry.hints?.sex && !c.profile.sexConfirmed) {
      c.profile.sex = entry.hints.sex;
    }
    if (entry.hints?.pregnant) c.profile.pregnant = true;
  });

  const isFirstLab = caseData.labs.length === 0;
  navigate('resumen');

  const ctx = buildContext();
  coach.reactTo({
    interpretation: ctx.interpretation,
    deltas: ctx.lab ? compare(ctx.lab, ctx.previous) : {},
    isFirstLab,
    privacyCount: entry.privacyRemoved,
  });
}

function deleteLab(id) {
  if (!confirm('¿Eliminar este análisis del historial?')) return;
  store.update((c) => { c.labs = c.labs.filter((l) => l.id !== id); });
  render();
}

function saveProfile(profile, symptoms) {
  store.update((c) => {
    c.profile = { ...c.profile, ...profile, sexConfirmed: true };
    if (c.profile.ageYears != null && !c.profile.ageAsOf) {
      c.profile.ageAsOf = new Date().toISOString().slice(0, 10);
    }
    c.symptoms = [...(c.symptoms || []), { date: new Date().toISOString().slice(0, 10), items: symptoms }];
  });
  app.planCache = null;
  navigate('resumen');
  coach.sayRaw('Perfil actualizado. Los umbrales y el plan se recalcularon con los datos nuevos.', 'feliz');
}

/** Guarda el perfil por rangos de la portada y rehace el plan de una vez. */
function setupProfile(profile, schedule) {
  store.update((c) => {
    c.profile = { ...c.profile, ...profile };
    if (schedule) c.schedule = schedule;
  });
  app.planCache = null;
  app.planSeed = 0;
  navigate('nutricion');
  coach.sayRaw('¡Listo! Tu plan de nutrición está armado con tus rangos. Dale a <b>▶ Reproducir</b> para ver la semana.', 'celebra');
}

function saveSettings(next) {
  store.update((c) => { c.settings = { ...c.settings, ...next }; });
  coach.setEnabled(next.coach);
  render();
}

function saveSchedule(schedule) {
  store.update((c) => { c.schedule = schedule; });
  app.planCache = null;
  coach.say('recreo', {}, { force: true });
}

function addControl(control) {
  store.update((c) => {
    c.controls = [...(c.controls || []), { id: `ctl-${Date.now()}`, ...control }];
  });
  render();
}

function removeControl(id) {
  store.update((c) => { c.controls = (c.controls || []).filter((x) => x.id !== id); });
  render();
}

function regenerate(kind) {
  if (kind === 'week') { navigate('semana'); return; }
  app.planSeed += 1;
  app.planCache = null;
  render();
  const ctx = buildContext();
  if (ctx.plan) coach.say('plan_listo', { mg: ctx.plan.absorbed.toFixed(2), pct: ctx.plan.coverage }, { force: true });
}

function resetAll() {
  store.resetCase();
  app.planCache = null;
  app.plate = [];
  navigate('resumen');
}

function newCase() {
  const id = store.newCaseId();
  render();
  coach.sayRaw(`Listo, el caso ahora se llama <b>${id}</b>. Los análisis siguen guardados.`, 'feliz');
}

function importCase(json) {
  store.importCase(json);
  app.planCache = null;
  navigate('resumen');
  coach.sayRaw('Caso importado. Todo lo que trae ya venía anonimizado.', 'celebra');
}

// --------------------------------------------------------------- pintado

function render() {
  const ctx = buildContext();
  const root = document.getElementById('app');
  clear(root);

  root.append(sidebar(ctx), main(ctx));
}

function sidebar(ctx) {
  const nav = h('nav', { class: 'nav' }, ROUTES.map((r) => h('button', {
    type: 'button',
    'aria-current': app.route === r.id ? 'page' : null,
    onclick: () => navigate(r.id),
  }, [h('span', { class: 'ico', text: r.icon }), r.label])));

  const mascot = h('div', { class: 'sidebar-mascot' }, [
    h('div', { class: 'drop bounce', onclick: () => coach.randomTip(), style: 'cursor:pointer' }, [bloodDrop({ size: 88, mood: moodFor(ctx) })]),
    h('div', { class: 'coach-bubble', style: 'margin-top:12px;text-align:left' }, [
      h('b', { class: 'small', text: bubbleTitle(ctx) }),
      h('div', { class: 'tiny muted', text: 'Tócame y te cuento algo útil.' }),
    ]),
  ]);

  return h('aside', { class: 'sidebar' }, [
    h('div', { class: 'brand' }, [
      h('div', {}, [bloodDrop({ size: 34, mood: 'feliz' })]),
      h('div', {}, [
        h('div', { class: 'brand-name', text: 'FerroTrack' }),
        h('div', { class: 'brand-tag', text: 'Tu salud, tu energía' }),
      ]),
    ]),
    nav,
    h('div', { class: 'privacy-badge' }, [
      h('b', { text: '🛡 100 % anónimo' }),
      'Tus datos se quedan en este navegador. No guardamos nombre, documento ni contacto.',
    ]),
    mascot,
  ]);
}

function moodFor(ctx) {
  if (!ctx.interpretation) return 'feliz';
  return { verde: 'celebra', amarillo: 'feliz', naranja: 'animo', rojo: 'triste' }[ctx.interpretation.level] || 'feliz';
}

function bubbleTitle(ctx) {
  if (!ctx.lab) return '¡Vamos a empezar!';
  const improved = Object.values(compare(ctx.lab, ctx.previous)).filter((d) => d.quality === 'mejora');
  if (improved.length) return '¡Vamos bien!';
  return 'Aquí estoy contigo';
}

function main(ctx) {
  const route = ALL_ROUTES.find((r) => r.id === app.route) || ALL_ROUTES[0];

  const header = h('header', { class: 'topbar' }, [
    h('div', {}, [
      h('div', { class: 'small muted', text: 'Comer bien es tu energía' }),
      h('div', { class: 'topbar-title', text: 'FerroTrack · Nutrición' }),
    ]),
    h('div', { class: 'topbar-meta' }, [
      h('button', { class: 'btn btn-accent', onclick: () => navigate('perfil'), text: '👤 Mi perfil' }),
    ]),
  ]);

  const secondary = ['nutricion', 'semana', 'compra', 'plato', 'horario'].includes(app.route)
    ? h('div', { class: 'btn-row', style: 'margin-bottom:16px' }, [
      h('button', { class: `btn btn-sm ${app.route === 'nutricion' ? 'btn-primary' : ''}`, onclick: () => navigate('nutricion'), text: '🍽 Plan de hoy' }),
      h('button', { class: `btn btn-sm ${app.route === 'semana' ? 'btn-primary' : ''}`, onclick: () => navigate('semana'), text: '📅 Semana' }),
      h('button', { class: `btn btn-sm ${app.route === 'compra' ? 'btn-primary' : ''}`, onclick: () => navigate('compra'), text: '🛒 Compra' }),
      h('button', { class: `btn btn-sm ${app.route === 'plato' ? 'btn-primary' : ''}`, onclick: () => navigate('plato'), text: '🍳 Arma tu plato' }),
      h('button', { class: `btn btn-sm ${app.route === 'horario' ? 'btn-primary' : ''}`, onclick: () => navigate('horario'), text: '🕐 Mi horario' }),
    ])
    : null;

  let body;
  try {
    body = route.render(ctx);
  } catch (err) {
    console.error(err);
    body = h('div', { class: 'notice notice-danger' }, [
      h('span', { class: 'ico', text: '💥' }),
      h('div', {}, [h('b', { text: 'Algo falló al dibujar esta sección' }), h('span', { text: String(err.message) })]),
    ]);
  }

  return h('main', { class: 'main', id: 'contenido' }, [header, secondary, body]);
}

// --------------------------------------------------------------- arranque

async function boot() {
  const caseData = store.load();

  if (caseData.settings.theme && caseData.settings.theme !== 'auto') {
    document.documentElement.setAttribute('data-theme', caseData.settings.theme);
  }
  coach.setEnabled(caseData.settings.coach !== false);

  const [, , foodsDb] = await Promise.all([
    loadDictionary(BASE),
    loadRules(BASE, caseData.settings.rulesetVersion),
    loadFoods(BASE).catch(() => ({ foods: [], version: null })),
  ]);

  app.foods = foodsDb.foods || [];
  app.foodsVersion = foodsDb.version || null;

  const hash = location.hash.replace('#/', '');
  if (ALL_ROUTES.some((r) => r.id === hash)) app.route = hash;

  render();

  window.addEventListener('hashchange', () => {
    const next = location.hash.replace('#/', '');
    if (ALL_ROUTES.some((r) => r.id === next) && next !== app.route) {
      app.route = next;
      render();
    }
  });

  // Presentación, solo la primera vez.
  if (!caseData.labs.length) {
    setTimeout(() => coach.say('bienvenida', {}, { ms: 14000 }), 700);
  } else {
    setTimeout(() => coach.randomTip(), 2400);
  }

  // Actualización en vivo del catálogo, en segundo plano y sin bloquear nada.
  if (caseData.settings.liveNutrition && caseData.settings.fdcApiKey) {
    refreshFromLive(app.foods, caseData.settings.fdcApiKey)
      .then((r) => { if (r.updated) { app.planCache = null; render(); } })
      .catch(() => {});
  }
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('app').innerHTML = `
    <div style="padding:48px;font-family:system-ui">
      <h1>No se pudo iniciar FerroTrack</h1>
      <p>${err.message}</p>
      <p style="color:#666">Si abriste el archivo directamente desde el disco, los módulos no cargan por seguridad del navegador. Sírvelo con un servidor local o ábrelo desde GitHub Pages.</p>
    </div>`;
});
