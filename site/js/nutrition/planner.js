/**
 * Generador de planes de comida.
 *
 * Arma un plan semanal que encaja en el horario real de la persona y que apunta
 * a una meta de hierro absorbido por día, no de hierro en la etiqueta. Después
 * de armar cada día comprueba cuánto hierro se absorbería de verdad y, si se
 * queda corto, corrige: mete un potenciador, cambia la base por una de mayor
 * rendimiento o mueve los lácteos a otro momento.
 *
 * Varía de un día a otro a propósito: un plan que repite el mismo almuerzo cinco
 * veces no lo sigue nadie.
 */

import { absorbFromMeal, compatibility } from './absorption.js';
import { deriveSlots } from './schedule.js';
import { maintenanceRequirement } from './projection.js';

/** Generador pseudoaleatorio con semilla: el mismo día siempre da el mismo plan. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const hashString = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/**
 * Arquetipos de comida: qué componentes lleva cada momento del día.
 * `groups` son grupos de alimentos candidatos, en orden de preferencia.
 */
const ARCHETYPES = {
  desayuno: [
    { role: 'base', groups: ['granos', 'cereales'], grams: 'porc', required: true },
    { role: 'proteina', groups: ['huevos', 'preparados', 'lacteos'], grams: 'porc' },
    { role: 'potenciador', groups: ['frutas'], grams: 'porc', enhancer: true, required: true },
    { role: 'extra', groups: ['otros', 'semillas'], grams: 0.6, optional: true },
  ],
  recreo: [
    { role: 'principal', groups: ['frutas'], grams: 'porc', enhancer: true, required: true },
    { role: 'acompanamiento', groups: ['semillas', 'cereales', 'huevos', 'tuberculos', 'granos'], grams: 'porc' },
    { role: 'bebida', groups: ['bebidas'], grams: 'porc', optional: true },
  ],
  almuerzo: [
    { role: 'hierro', groups: ['visceras', 'menestras', 'mariscos', 'pescados', 'carnes'], grams: 'porc', required: true, ironCore: true },
    { role: 'acompanamiento', groups: ['granos', 'tuberculos'], grams: 'porc', required: true },
    { role: 'verdura', groups: ['verduras'], grams: 'porc', enhancer: true, required: true },
    { role: 'potenciador', groups: ['frutas'], grams: 'porc', enhancer: true, required: true },
  ],
  merienda: [
    { role: 'principal', groups: ['lacteos', 'frutas', 'preparados'], grams: 'porc', required: true },
    { role: 'bebida', groups: ['bebidas'], grams: 'porc', optional: true },
  ],
  cena: [
    { role: 'hierro', groups: ['pescados', 'carnes', 'menestras', 'huevos', 'preparados'], grams: 'porc', required: true, ironCore: true },
    { role: 'verdura', groups: ['verduras'], grams: 'porc', enhancer: true, required: true },
    { role: 'acompanamiento', groups: ['tuberculos', 'granos'], grams: 0.8 },
  ],
};

const DIET_EXCLUDE = {
  vegana: ['visceras', 'carnes', 'pescados', 'mariscos', 'huevos', 'lacteos'],
  vegetariana: ['visceras', 'carnes', 'pescados', 'mariscos'],
  mixta: [],
};

/** Filtra el catálogo según el perfil: dieta, alergias, rechazos, bolsillo. */
export function eligibleFoods(foods, profile) {
  const excluded = DIET_EXCLUDE[profile.diet] || [];
  const allergies = (profile.allergies || []).map((a) => a.toLowerCase());
  const dislikes = new Set(profile.dislikes || []);
  const budget = profile.budget || 3;

  return foods.filter((f) => {
    if (excluded.includes(f.g)) return false;
    if (dislikes.has(f.id)) return false;
    if ((f.cost || 1) > budget) return false;
    if (allergies.some((a) => f.n.toLowerCase().includes(a) || f.id.includes(a))) return false;
    if (profile.diet === 'vegana' && !f.tags?.includes('vegano')) return false;
    if (profile.diet === 'vegetariana' && !(f.tags?.includes('vegano') || f.tags?.includes('vegetariano'))) return false;
    return true;
  });
}

function pick(candidates, random, penalties) {
  if (!candidates.length) return null;
  // Ponderación: mayor rendimiento potencial y menor uso reciente.
  const weights = candidates.map((f) => {
    const recency = penalties.get(f.id) || 0;
    const star = f.tags?.includes('estrella') ? 1.6 : 1;
    return Math.max(0.05, star * (1 / (1 + recency * 1.8)));
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < candidates.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function gramsFor(food, spec) {
  const base = food.porc || 100;
  if (spec.grams === 'porc') return base;
  if (typeof spec.grams === 'number') return Math.round(base * spec.grams);
  return base;
}

function buildMeal(slot, foods, random, penalties, opts) {
  const archetype = ARCHETYPES[slot.tag] || ARCHETYPES.merienda;
  const items = [];
  const used = new Set();
  let legumeCore = false;

  for (const spec of archetype) {
    if (spec.optional && random() > 0.45) continue;

    let pool = foods.filter((f) => spec.groups.includes(f.g) && !used.has(f.id));

    // Una menestra ya carga suficientes fitatos. Acompañarla con quinua o pan
    // integral duplica el freno; con papa o arroz, no. La elección del
    // acompañamiento cambia el rendimiento del plato más que el plato mismo.
    if (legumeCore && spec.role === 'acompanamiento') {
      const gentle = pool.filter((f) => (f.phy || 0) < 120);
      if (gentle.length) pool = gentle;
    }

    // El recreo tiene que caber en la lonchera y comerse de pie.
    if (slot.portable) pool = pool.filter((f) => f.tags?.includes('lonchera') || f.tags?.includes('recreo'));
    // El desayuno rápido no admite preparaciones largas.
    if (slot.quick && slot.tag === 'desayuno') pool = pool.filter((f) => f.tags?.includes('desayuno'));
    // Cada alimento declara en qué momentos del día tiene sentido.
    if (['almuerzo', 'cena', 'merienda'].includes(slot.tag)) {
      pool = pool.filter((f) => f.tags?.includes(slot.tag));
    }
    // Los inhibidores fuertes solo entran en el momento reservado para ellos.
    if (!slot.preferInhibitors) {
      pool = pool.filter((f) => !f.tags?.includes('evitar_con_hierro'));
    }
    // Los lácteos solo en el momento reservado para ellos: su calcio compite
    // con el hierro en cualquier comida donde haya hierro que absorber.
    if (!slot.preferInhibitors) {
      pool = pool.filter((f) => f.g !== 'lacteos');
    }
    if (spec.enhancer && opts.preferEnhancers) {
      const boosted = pool.filter((f) => f.tags?.includes('potenciador'));
      if (boosted.length) pool = boosted;
    }
    if (spec.ironCore && opts.preferHighIron) {
      const rich = pool.filter((f) => (f.fe || 0) * (1 + 3 * (f.heme || 0)) > 3);
      if (rich.length) pool = rich;
    }

    if (!pool.length) {
      if (spec.required) {
        // Sin candidatos con las restricciones estrictas, se relaja el filtro
        // de momento del día antes que dejar la comida incompleta.
        pool = foods.filter((f) => spec.groups.includes(f.g) && !used.has(f.id)
          && !f.tags?.includes('evitar_con_hierro')
          && (slot.preferInhibitors || f.g !== 'lacteos'));
      }
      if (!pool.length) continue;
    }

    const food = pick(pool, random, penalties);
    if (!food) continue;
    used.add(food.id);
    if (spec.ironCore && food.g === 'menestras') legumeCore = true;
    items.push({ food, grams: gramsFor(food, spec), role: spec.role });
  }

  return items;
}

/**
 * Genera el plan de un día.
 * @param {Object} args
 * @param {Array}  args.foods       catálogo completo
 * @param {Object} args.profile     perfil del caso
 * @param {Object} args.schedule    horario
 * @param {Number} args.ferritin    ferritina actual, para calibrar la absorción
 * @param {String} args.dateKey     semilla (una fecha) para que el plan sea estable
 * @param {Map}    args.penalties   uso reciente de cada alimento
 */
export function planDay({ foods, profile, schedule, ferritin, dateKey, penalties = new Map(), targetMg = null }) {
  const { slots, adaptations } = deriveSlots(schedule);
  const catalog = eligibleFoods(foods, profile);
  const random = rng(hashString(dateKey));
  const need = maintenanceRequirement(profile);
  const target = targetMg ?? +(need.total * 2.2).toFixed(2); // meta de recuperación

  const build = (opts) => slots.map((slot) => {
    const items = buildMeal(slot, catalog, random, penalties, opts);
    const analysis = absorbFromMeal(items, { ferritin });
    return { slot, items, analysis };
  });

  // Primera pasada, después dos correcciones si el día se queda corto.
  let meals = build({ preferEnhancers: true, preferHighIron: false });
  let absorbed = meals.reduce((a, m) => a + m.analysis.absorbed, 0);
  const corrections = [];

  if (absorbed < target) {
    corrections.push('El primer armado quedaba corto, así que se priorizaron alimentos de mayor rendimiento en hierro.');
    meals = build({ preferEnhancers: true, preferHighIron: true });
    absorbed = meals.reduce((a, m) => a + m.analysis.absorbed, 0);
  }

  // Corrección por comida: una comida cargada de hierro que rinde poco es el
  // peor error del plan, porque gasta el alimento sin que llegue nada. Se le
  // añade el potenciador disponible con más vitamina C.
  const MIN_YIELD = 12;
  const CEILING = target * 1.4; // por encima de esto el plan deja de ser comida real
  for (const meal of meals) {
    if (meal.analysis.totals.ironTotal < 1 || meal.analysis.yield >= MIN_YIELD) continue;

    const mealTag = meal.slot.tag === 'recreo' ? 'recreo' : meal.slot.tag;
    const already = new Set(meal.items.map((i) => i.food.id));

    // Un plato que rinde mal se arregla siempre: no es cuestión del total del
    // día, sino de no desperdiciar el alimento que ya está en la mesa. Lo que sí
    // depende del total es el tipo de arreglo — si el día ya va sobrado, solo se
    // permite subir la vitamina C, nunca añadir más hierro.
    const allowIronBoost = absorbed < CEILING && meal.analysis.totals.animalProteinGrams === 0;
    const candidates = catalog.filter((f) => !already.has(f.id) && f.tags?.includes(mealTag)
      && (f.tags?.includes('potenciador')
        || (allowIronBoost && ['carnes', 'pescados', 'visceras', 'mariscos'].includes(f.g))));

    const tried = [];
    for (const food of candidates) {
      const grams = ['carnes', 'pescados', 'visceras', 'mariscos'].includes(food.g)
        ? Math.round((food.porc || 100) * 0.6)   // una porción chica basta
        : (food.porc || 100);
      const test = absorbFromMeal([...meal.items, { food, grams }], { ferritin });
      if (test.absorbed <= meal.analysis.absorbed + 0.02) continue;
      tried.push({ food, grams, analysis: test, addedIron: test.totals.ironTotal - meal.analysis.totals.ironTotal });
    }
    if (!tried.length) continue;

    // Se busca el arreglo mínimo suficiente, no el máximo: entre los que llevan
    // la comida por encima del rendimiento mínimo, gana el que añade menos
    // hierro de dieta. Meter media libra de vísceras en cada plato subiría el
    // número y arruinaría el plan como comida real.
    const sufficient = tried.filter((t) => t.analysis.yield >= MIN_YIELD);
    const best = sufficient.length
      ? sufficient.sort((a, b) => a.addedIron - b.addedIron)[0]
      : tried.sort((a, b) => b.analysis.absorbed - a.analysis.absorbed)[0];

    const before = meal.analysis.yield;
    meal.items.push({ food: best.food, grams: best.grams, role: 'refuerzo' });
    meal.analysis = best.analysis;
    absorbed = meals.reduce((a, m) => a + m.analysis.absorbed, 0);
    corrections.push(`${meal.slot.label} rendía solo ${before} %: se le sumó ${best.food.n.toLowerCase()} y subió a ${meal.analysis.yield} %.`);
  }

  // Corrección fina: añadir un potenciador al momento que más pesa.
  if (absorbed < target) {
    const heaviest = [...meals].sort((a, b) => b.slot.weight - a.slot.weight)[0];
    const enhancers = catalog
      .filter((f) => f.tags?.includes('potenciador') && !heaviest.items.some((i) => i.food.id === f.id))
      .sort((a, b) => (b.c || 0) - (a.c || 0));
    if (enhancers.length) {
      const chosen = enhancers[0];
      heaviest.items.push({ food: chosen, grams: chosen.porc || 100, role: 'refuerzo' });
      heaviest.analysis = absorbFromMeal(heaviest.items, { ferritin });
      absorbed = meals.reduce((a, m) => a + m.analysis.absorbed, 0);
      corrections.push(`Se reforzó ${heaviest.slot.label.toLowerCase()} con ${chosen.n.toLowerCase()} para subir la absorción.`);
    }
  }

  const totals = meals.reduce((acc, m) => {
    for (const key of ['kcal', 'protein', 'ironTotal', 'vitC', 'calcium', 'b12', 'folate', 'zinc']) {
      acc[key] = (acc[key] || 0) + m.analysis.totals[key];
    }
    return acc;
  }, {});

  return {
    dateKey,
    slots,
    meals,
    adaptations,
    corrections,
    absorbed: +absorbed.toFixed(3),
    target,
    requirement: need,
    totals,
    coverage: Math.round((absorbed / target) * 100),
    diversity: new Set(meals.flatMap((m) => m.items.map((i) => i.food.id))).size,
  };
}

/** Genera un plan de varios días, evitando repeticiones entre ellos. */
export function planWeek({ foods, profile, schedule, ferritin, startDate = new Date(), days = 7 }) {
  const penalties = new Map();
  const out = [];

  for (let i = 0; i < days; i += 1) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateKey = date.toISOString().slice(0, 10);

    const day = planDay({ foods, profile, schedule, ferritin, dateKey, penalties });
    out.push({ ...day, date: dateKey, weekday: date.getDay() });

    // Envejece las penalizaciones y castiga lo que se acaba de usar.
    for (const [id, value] of penalties) {
      const next = value * 0.55;
      if (next < 0.1) penalties.delete(id); else penalties.set(id, next);
    }
    for (const meal of day.meals) {
      for (const item of meal.items) {
        penalties.set(item.food.id, (penalties.get(item.food.id) || 0) + 1);
      }
    }
  }

  const avg = out.reduce((a, d) => a + d.absorbed, 0) / out.length;
  const allFoods = new Set(out.flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.food.id))));

  return {
    days: out,
    averageAbsorbed: +avg.toFixed(3),
    target: out[0]?.target ?? 0,
    variety: allFoods.size,
  };
}

/** Analiza un plato armado a mano en el constructor de platos. */
export function analyzePlate(items, { ferritin, profile }) {
  const compat = compatibility(items, { ferritin });
  const need = maintenanceRequirement(profile);
  return {
    ...compat,
    dailyNeed: need.total,
    pctOfNeed: need.total > 0 ? Math.round((compat.result.absorbed / need.total) * 100) : 0,
  };
}
