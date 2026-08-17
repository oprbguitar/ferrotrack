/**
 * Pruebas del motor de reglas, del índice, de la absorción y del planificador.
 * El caso de prueba reproduce los dos controles reales que originaron el
 * proyecto: una niña de 12 años con ferritina 7→8 ng/mL, saturación 7.21→5.62 %
 * y hemoglobina 12.1→12.8 g/dL.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');

globalThis.fetch = async (url) => {
  const body = await readFile(join(SITE, String(url).replace(/^\.?\//, '')), 'utf8');
  return { ok: true, json: async () => JSON.parse(body), text: async () => body };
};

const { loadDictionary } = await import('../site/js/core/parser.js');
const { loadRules, interpret, hemoglobinCutoff, ferritinCutoff } = await import('../site/js/core/rules.js');
const { compare, trend } = await import('../site/js/core/longitudinal.js');
const { axes, overall } = await import('../site/js/core/score.js');
const { absorbFromMeal, compatibility } = await import('../site/js/nutrition/absorption.js');
const { deriveSlots, DEFAULT_SCHEDULE } = await import('../site/js/nutrition/schedule.js');
const { planDay, planWeek, eligibleFoods } = await import('../site/js/nutrition/planner.js');
const { project, maintenanceRequirement } = await import('../site/js/nutrition/projection.js');

await loadDictionary('');
await loadRules('');

const FOODS = JSON.parse(await readFile(join(SITE, 'data', 'foods.json'), 'utf8')).foods;
const byId = (id) => FOODS.find((f) => f.id === id);

const PROFILE = {
  ageYears: 12, sex: 'female', pregnant: false, menstruates: true, menstrualFlow: 'moderado',
  altitude: 0, diet: 'mixta', weightKg: 40, budget: 3, allergies: [], dislikes: [],
};
const AGE_MONTHS = 12 * 12 + 9;

const LAB_JUN = {
  id: 'l1', date: '2026-06-27',
  results: {
    ferritina: { value: 7, unit: 'ng/mL', labRange: { low: 13, high: 68 } },
    hierro_serico: { value: 32.2, unit: 'µg/dL', labRange: { low: 33, high: 193 } },
    sat_transferrina: { value: 7.21, unit: '%', labRange: { low: 20, high: 50 } },
    hemoglobina: { value: 12.1, unit: 'g/dL', labRange: { low: 11.5, high: 16.1 } },
    vcm: { value: 83.8, unit: 'fL', labRange: { low: 79, high: 92.9 } },
    rdw_cv: { value: 15.6, unit: '%', labRange: { low: 11.7, high: 14.4 } },
    vitamina_b12: { value: 501, unit: 'pg/mL', labRange: { low: 197, high: 771 } },
    acido_folico: { value: 14.2, unit: 'ng/mL', labRange: { low: 4.8, high: 37.3 } },
  },
};

const LAB_AGO = {
  id: 'l2', date: '2026-08-15',
  results: {
    ferritina: { value: 8, unit: 'ng/mL', labRange: { low: 13, high: 68 } },
    hierro_serico: { value: 25.5, unit: 'µg/dL', labRange: { low: 33, high: 193 } },
    sat_transferrina: { value: 5.62, unit: '%', labRange: { low: 20, high: 50 } },
    transferrina: { value: 324, unit: 'mg/dL', labRange: { low: 200, high: 360 } },
    hemoglobina: { value: 12.8, unit: 'g/dL', labRange: { low: 11.5, high: 16.1 } },
    vcm: { value: 84.4, unit: 'fL', labRange: { low: 79, high: 92.9 } },
    rdw_cv: { value: 17.2, unit: '%', labRange: { low: 11.7, high: 14.4 } },
    vitamina_b12: { value: 642, unit: 'pg/mL', labRange: { low: 197, high: 771 } },
    acido_folico: { value: 36.5, unit: 'ng/mL', labRange: { low: 4.8, high: 37.3 } },
  },
};

// ---------------------------------------------------------------- umbrales

test('el punto de corte de hemoglobina sale de la tabla de la OMS por edad', () => {
  const cut = hemoglobinCutoff(PROFILE, AGE_MONTHS);
  assert.equal(cut.value, 12.0);
  assert.match(cut.label, /12 a 14 años/);
});

test('la altitud eleva el punto de corte de hemoglobina', () => {
  const cut = hemoglobinCutoff({ ...PROFILE, altitude: 3400 }, AGE_MONTHS);
  assert.equal(cut.base, 12.0);
  assert.equal(cut.adjust, 1.9);
  assert.equal(cut.value, 13.9);
});

test('la inflamación cambia el umbral de ferritina aplicado', () => {
  assert.equal(ferritinCutoff(AGE_MONTHS, false).value, 15);
  assert.equal(ferritinCutoff(AGE_MONTHS, true).value, 70);
});

// ---------------------------------------------------------------- reglas

test('detecta déficit de hierro sin anemia y explica en qué se basó', () => {
  const r = interpret({ lab: LAB_AGO, previous: LAB_JUN, profile: PROFILE, ageMonths: AGE_MONTHS });
  const p = r.patterns.find((x) => x.id === 'P01_deficit_sin_anemia');
  assert.ok(p, 'no se detectó el patrón de déficit sin anemia');
  assert.ok(p.because.length >= 2, 'el patrón debe declarar su evidencia');
  assert.ok(p.because.some((b) => b.includes('Ferritina 8')));
});

test('detecta la divergencia: hemoglobina sube y saturación baja', () => {
  const r = interpret({ lab: LAB_AGO, previous: LAB_JUN, profile: PROFILE, ageMonths: AGE_MONTHS });
  assert.ok(r.patterns.some((x) => x.id === 'P03_divergencia'),
    'el patrón central del caso no se detectó');
});

test('avisa que falta un marcador de inflamación para leer bien la ferritina', () => {
  const r = interpret({ lab: LAB_AGO, previous: LAB_JUN, profile: PROFILE, ageMonths: AGE_MONTHS });
  assert.ok(r.missing.some((m) => m.needs === 'pcr'));
});

test('no marca anemia cuando la hemoglobina alcanza el punto de corte', () => {
  const r = interpret({ lab: LAB_AGO, previous: LAB_JUN, profile: PROFILE, ageMonths: AGE_MONTHS });
  assert.equal(r.flags.hemoglobina_baja, false);
  assert.equal(r.flags.hemoglobina_normal, true);
  assert.ok(!r.patterns.some((x) => x.id === 'P02_anemia_ferropenica'));
});

test('a 3400 m la misma hemoglobina sí queda por debajo del corte ajustado', () => {
  const r = interpret({ lab: LAB_AGO, previous: LAB_JUN, profile: { ...PROFILE, altitude: 3400 }, ageMonths: AGE_MONTHS });
  assert.equal(r.flags.hemoglobina_baja, true);
  assert.equal(r.level, 'rojo');
});

test('una alerta de seguridad eleva el nivel global a rojo', () => {
  const critical = { ...LAB_AGO, results: { ...LAB_AGO.results, hemoglobina: { value: 7.5, labRange: { low: 11.5, high: 16.1 } } } };
  const r = interpret({ lab: critical, previous: LAB_JUN, profile: PROFILE, ageMonths: AGE_MONTHS });
  assert.equal(r.level, 'rojo');
  assert.ok(r.alerts.some((a) => a.id === 'S1'));
});

// ---------------------------------------------------------------- longitudinal

test('calcula deltas, porcentaje y calidad del cambio', () => {
  const d = compare(LAB_AGO, LAB_JUN);
  assert.equal(d.ferritina.abs, 1);
  assert.equal(d.ferritina.quality, 'mejora');
  assert.equal(d.sat_transferrina.quality, 'empeora');
  assert.equal(d.hemoglobina.quality, 'mejora');
  assert.equal(d.rdw_cv.quality, 'empeora'); // el RDW conviene que baje
  assert.equal(d.transferrina.isNew, true);
});

test('la tendencia se calcula por regresión sobre la serie', () => {
  const t = trend([LAB_JUN, LAB_AGO], 'hemoglobina');
  assert.equal(t.n, 2);
  assert.ok(t.slope > 0);
  assert.equal(t.label, 'en ascenso');
});

// ---------------------------------------------------------------- índice

test('el índice separa ejes y no colapsa en un solo número', () => {
  const interpretation = interpret({ lab: LAB_AGO, previous: LAB_JUN, profile: PROFILE, ageMonths: AGE_MONTHS });
  const map = axes({ lab: LAB_AGO, profile: PROFILE, ageMonths: AGE_MONTHS, interpretation });

  assert.ok(map.reservas.score < 40, 'las reservas deberían puntuar bajo con ferritina 8');
  assert.ok(map.disponibilidad.score < 40, 'la disponibilidad debería puntuar bajo con saturación 5.62 %');
  assert.ok(map.hemograma.score > map.reservas.score, 'el hemograma va mejor que las reservas: ese es el punto');

  const total = overall(map);
  assert.ok(total.value > 0 && total.value < 100);
  assert.equal(total.basis.length, 3);
  assert.ok(total.basis.every((b) => b.detail));
});

// ---------------------------------------------------------------- absorción

test('el hierro hemo se absorbe mucho mejor que el vegetal', () => {
  const ctx = { ferritin: 8 };
  const higado = absorbFromMeal([{ food: byId('higado_pollo'), grams: 80 }], ctx);
  const lentejas = absorbFromMeal([{ food: byId('lentejas'), grams: 140 }], ctx);
  assert.ok(higado.yield > lentejas.yield * 2, 'el rendimiento del hemo debe superar ampliamente al vegetal');
});

test('la vitamina C sube la absorción del hierro vegetal', () => {
  const ctx = { ferritin: 8 };
  const solo = absorbFromMeal([{ food: byId('lentejas'), grams: 140 }], ctx);
  const conLimon = absorbFromMeal([
    { food: byId('lentejas'), grams: 140 },
    { food: byId('limon'), grams: 15 },
    { food: byId('pimiento'), grams: 60 },
  ], ctx);
  assert.ok(conLimon.absorbed > solo.absorbed * 1.5,
    `esperaba un salto claro, obtuve ${solo.absorbed} → ${conLimon.absorbed}`);
});

test('el té frena la absorción de forma marcada', () => {
  const ctx = { ferritin: 8 };
  const base = [{ food: byId('lentejas'), grams: 140 }, { food: byId('limon'), grams: 15 }];
  const conTe = absorbFromMeal([...base, { food: byId('te'), grams: 200 }], ctx);
  const sinTe = absorbFromMeal(base, ctx);
  assert.ok(conTe.absorbed < sinTe.absorbed * 0.6,
    `el té debería recortar la absorción, ${sinTe.absorbed} → ${conTe.absorbed}`);
});

test('con reservas vacías el intestino absorbe más de la misma comida', () => {
  const meal = [{ food: byId('lentejas'), grams: 140 }];
  const bajo = absorbFromMeal(meal, { ferritin: 8 });
  const normal = absorbFromMeal(meal, { ferritin: 60 });
  assert.ok(bajo.absorbed > normal.absorbed);
});

test('la compatibilidad puntúa la combinación y explica el porqué', () => {
  const buena = compatibility([
    { food: byId('lentejas'), grams: 140 },
    { food: byId('carne_res'), grams: 60 },
    { food: byId('pimiento'), grams: 60 },
    { food: byId('limon'), grams: 15 },
  ], { ferritin: 8 });
  const mala = compatibility([
    { food: byId('lentejas'), grams: 140 },
    { food: byId('te'), grams: 200 },
    { food: byId('leche'), grams: 200 },
  ], { ferritin: 8 });

  assert.ok(buena.score > mala.score + 25, `${buena.score} vs ${mala.score}`);
  assert.ok(buena.notes.length > 0 && mala.notes.length > 0);
});

// ---------------------------------------------------------------- horario

test('el horario escolar genera los momentos de comida esperados', () => {
  const { slots } = deriveSlots(DEFAULT_SCHEDULE);
  const ids = slots.map((s) => s.id);
  assert.deepEqual(ids, ['desayuno', 'recreo1', 'recreo2', 'almuerzo', 'merienda', 'cena']);
  assert.equal(slots.find((s) => s.id === 'recreo1').portable, true);
  assert.ok(Math.abs(slots.reduce((a, s) => a + s.weight, 0) - 1) < 0.01);
});

test('el desayuno se adelanta si no entra antes de la hora de entrada', () => {
  const { slots } = deriveSlots({
    ...DEFAULT_SCHEDULE,
    meals: { ...DEFAULT_SCHEDULE.meals, desayuno: { ...DEFAULT_SCHEDULE.meals.desayuno, time: '07:10' } },
  });
  const desayuno = slots.find((s) => s.id === 'desayuno');
  assert.equal(desayuno.time, '06:40'); // 07:20 − 25 min de traslado − 15 min
  assert.ok(desayuno.warning);
});

test('en modo ayuno la primera comida pasa a ser el primer recreo', () => {
  const { slots } = deriveSlots({ ...DEFAULT_SCHEDULE, breakfastMode: 'ayuno' });
  assert.ok(!slots.some((s) => s.id === 'desayuno'));
  const first = slots[0];
  assert.equal(first.id, 'recreo1');
  assert.equal(first.tag, 'desayuno');
  assert.ok(first.weight > 0.15, 'el recreo que rompe el ayuno debe cargar más');
});

test('el horario es configurable en entrada, salida y recreos', () => {
  const custom = {
    ...DEFAULT_SCHEDULE,
    school: { ...DEFAULT_SCHEDULE.school, start: '08:00', end: '13:00' },
    breaks: [{ id: 'unico', label: 'Recreo', start: '10:15', minutes: 30 }],
  };
  const { slots } = deriveSlots(custom);
  assert.equal(slots.filter((s) => s.tag === 'recreo').length, 1);
  assert.equal(slots.find((s) => s.id === 'unico').minutes, 30);
});

// ---------------------------------------------------------------- planificador

test('el plan diario cubre todos los momentos del horario', () => {
  const day = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: '2026-08-17' });
  assert.equal(day.meals.length, day.slots.length);
  assert.ok(day.meals.every((m) => m.items.length > 0), 'ninguna comida puede quedar vacía');
  assert.ok(day.absorbed > 0);
});

test('el plan es determinista para la misma fecha y varía entre fechas', () => {
  const a = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: '2026-08-17' });
  const b = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: '2026-08-17' });
  const c = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: '2026-08-18' });

  const ids = (d) => d.meals.flatMap((m) => m.items.map((i) => i.food.id)).join('|');
  assert.equal(ids(a), ids(b));
  assert.notEqual(ids(a), ids(c));
});

test('el recreo solo lleva cosas que caben en una lonchera', () => {
  const day = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: '2026-09-01' });
  for (const meal of day.meals.filter((m) => m.slot.portable)) {
    for (const item of meal.items) {
      assert.ok(item.food.tags.includes('lonchera') || item.food.tags.includes('recreo'),
        `${item.food.n} no es apto para lonchera`);
    }
  }
});

test('el té y el café nunca caen en una comida cargada de hierro', () => {
  for (let i = 0; i < 20; i += 1) {
    const day = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: `2026-10-${String(i + 1).padStart(2, '0')}` });
    for (const meal of day.meals) {
      const hasInhibitor = meal.items.some((it) => it.food.tags.includes('evitar_con_hierro'));
      if (hasInhibitor) {
        assert.ok(meal.slot.preferInhibitors === true,
          `${meal.slot.label} no debería llevar inhibidores fuertes`);
      }
    }
  }
});

test('el plan vegano no incluye productos animales', () => {
  const vegan = { ...PROFILE, diet: 'vegana' };
  const day = planDay({ foods: FOODS, profile: vegan, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: '2026-08-20' });
  for (const meal of day.meals) {
    for (const item of meal.items) {
      assert.ok(item.food.tags.includes('vegano'), `${item.food.n} no es vegano`);
    }
  }
});

test('el presupuesto limita el catálogo', () => {
  const cheap = eligibleFoods(FOODS, { ...PROFILE, budget: 1 });
  assert.ok(cheap.every((f) => (f.cost || 1) <= 1));
  assert.ok(cheap.length > 20, 'con presupuesto ajustado todavía debe quedar catálogo suficiente');
});

test('los rechazos del usuario se respetan', () => {
  const day = planDay({
    foods: FOODS, profile: { ...PROFILE, dislikes: ['lentejas', 'higado_pollo', 'sangrecita'] },
    schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: '2026-08-21',
  });
  const used = day.meals.flatMap((m) => m.items.map((i) => i.food.id));
  assert.ok(!used.includes('lentejas'));
  assert.ok(!used.includes('higado_pollo'));
});

test('a una menestra no la acompaña otro alimento cargado de fitatos', () => {
  for (let i = 1; i <= 25; i += 1) {
    const day = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: `2026-11-${String(i).padStart(2, '0')}` });
    for (const meal of day.meals) {
      const core = meal.items.find((it) => it.role === 'hierro');
      if (core?.food.g !== 'menestras') continue;
      const side = meal.items.find((it) => it.role === 'acompanamiento');
      if (!side) continue;
      assert.ok((side.food.phy || 0) < 120,
        `${core.food.n} acompañada de ${side.food.n} (${side.food.phy} mg de fitatos) frena la absorción`);
    }
  }
});

test('los lácteos solo aparecen en el momento reservado para ellos', () => {
  for (let i = 1; i <= 25; i += 1) {
    const day = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: `2026-12-${String(i).padStart(2, '0')}` });
    for (const meal of day.meals) {
      const dairy = meal.items.find((it) => it.food.g === 'lacteos');
      if (dairy) {
        assert.equal(meal.slot.preferInhibitors, true,
          `${dairy.food.n} en ${meal.slot.label} compite con el hierro de ese plato`);
      }
    }
  }
});

test('el corrector busca el arreglo mínimo, no el máximo', () => {
  // Ningún día debería resolverse a fuerza de vísceras en cada plato.
  for (let i = 1; i <= 20; i += 1) {
    const day = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: `2027-01-${String(i).padStart(2, '0')}` });
    assert.ok(day.totals.ironTotal < 45,
      `el día ${i} acumula ${day.totals.ironTotal.toFixed(1)} mg de hierro en la dieta: el plan dejó de ser comida real`);
    const refuerzos = day.meals.flatMap((m) => m.items.filter((it) => it.role === 'refuerzo'));
    assert.ok(refuerzos.length <= 3, 'demasiados refuerzos: el armado base está mal');
  }
});

test('la semana varía bastante y no repite el mismo día siete veces', () => {
  const week = planWeek({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, startDate: new Date('2026-08-17T00:00:00Z') });
  assert.equal(week.days.length, 7);
  assert.ok(week.variety >= 20, `variedad insuficiente: ${week.variety} alimentos distintos`);
  const signatures = new Set(week.days.map((d) => d.meals.flatMap((m) => m.items.map((i) => i.food.id)).join('|')));
  assert.equal(signatures.size, 7, 'los siete días deben ser distintos entre sí');
});

// ---------------------------------------------------------------- proyección

test('la necesidad diaria incluye pérdidas basales y menstruales', () => {
  const need = maintenanceRequirement(PROFILE);
  assert.ok(need.total > need.basal);
  assert.equal(need.menstrual, 0.45);
  assert.ok(need.explain.length >= 2);
});

test('un plan por debajo de las pérdidas no promete mejorías', () => {
  const p = project({ profile: PROFILE, absorbedPerDay: 0.4, hemoglobin: 12.8, hemoglobinTarget: 12, ferritin: 8 });
  assert.equal(p.sufficient, false);
  assert.equal(p.verdict.tone, 'insuficiente');
  assert.equal(p.monthsToRepletion, null);
  assert.ok(p.horizons.every((h) => h.feeling.title.includes('igual')));
});

test('un plan con excedente proyecta ferritina y hemoglobina en los tres plazos', () => {
  const p = project({ profile: PROFILE, absorbedPerDay: 2.4, hemoglobin: 12.8, hemoglobinTarget: 12, ferritin: 8 });
  assert.equal(p.sufficient, true);
  assert.equal(p.horizons.length, 3);
  const [corto, mediano, largo] = p.horizons;
  assert.ok(largo.ferritin > mediano.ferritin && mediano.ferritin > corto.ferritin);
  assert.ok(largo.range.ferritin[0] < largo.ferritin && largo.ferritin < largo.range.ferritin[1]);
  assert.ok(p.monthsToRepletion > 0);
  assert.ok(p.horizons.every((h) => h.feeling.text.length > 40), 'cada plazo debe explicar cómo se sentiría');
});

test('el plan generado se conecta con la proyección', () => {
  const day = planDay({ foods: FOODS, profile: PROFILE, schedule: DEFAULT_SCHEDULE, ferritin: 8, dateKey: '2026-08-17' });
  const p = project({ profile: PROFILE, absorbedPerDay: day.absorbed, hemoglobin: 12.8, hemoglobinTarget: 12, ferritin: 8 });
  assert.equal(p.absorbedPerDay, day.absorbed);
  assert.ok(p.horizons[2].ferritin != null);
});
