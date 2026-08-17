/**
 * Modelo de absorción de hierro.
 *
 * Contar los miligramos de hierro de un plato no dice casi nada: de las lentejas
 * se absorbe un 2 % y del hígado un 25 %, y un vaso de té al lado puede borrar
 * la mitad de lo que se comió. Lo que importa es el hierro que efectivamente
 * entra al cuerpo.
 *
 * Este módulo implementa una aproximación del algoritmo de Hallberg y Hulthén
 * (Am J Clin Nutr 2000;71:1147-60), que calcula la absorción comida por comida a
 * partir del hierro hemo y no hemo y de los factores que la modifican: fitatos,
 * polifenoles, calcio, vitamina C, proteína animal y estado de las reservas.
 *
 * Es una aproximación con fines educativos y de planificación. Las cifras que
 * produce son estimaciones, no mediciones.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Absorción base del hierro no hemo, en %, para reservas de referencia. */
const BASE_NONHEME = 15;
/** Absorción base del hierro hemo, en %. */
const BASE_HEME = 25;
/** Ferritina de referencia del modelo (ng/mL). */
const REF_FERRITIN = 15;

/**
 * Cuanto más vacías las reservas, más eficiente se vuelve el intestino.
 * Es la razón por la que una misma comida rinde distinto en dos personas.
 */
export function statusFactor(ferritin, { heme = false } = {}) {
  if (ferritin == null || ferritin <= 0) return 1;
  const exponent = heme ? 0.30 : 0.55; // el hemo se regula menos
  return clamp((REF_FERRITIN / ferritin) ** exponent, 0.35, 3.5);
}

/**
 * Suma los nutrientes de una comida.
 * @param {Array<{food: Object, grams: number}>} items
 */
export function mealTotals(items) {
  const t = {
    grams: 0, kcal: 0, protein: 0, ironTotal: 0, ironHeme: 0, ironNonHeme: 0,
    vitC: 0, calcium: 0, phytate: 0, polyphenol: 0, b12: 0, folate: 0, zinc: 0,
    animalProteinGrams: 0,
  };

  for (const { food, grams } of items) {
    if (!food || !grams) continue;
    const k = grams / 100;
    const iron = (food.fe || 0) * k;
    const heme = iron * (food.heme || 0);

    t.grams += grams;
    t.kcal += (food.kcal || 0) * k;
    t.protein += (food.pro || 0) * k;
    t.ironTotal += iron;
    t.ironHeme += heme;
    t.ironNonHeme += iron - heme;
    t.vitC += (food.c || 0) * k;
    t.calcium += (food.ca || 0) * k;
    t.phytate += (food.phy || 0) * k;
    t.polyphenol += (food.pol || 0) * k;
    t.b12 += (food.b12 || 0) * k;
    t.folate += (food.fol || 0) * k;
    t.zinc += (food.zn || 0) * k;

    // "Factor cárnico": el tejido animal muscular potencia el hierro vegetal
    // del mismo plato. Los lácteos y el huevo no cuentan para esto.
    if (['carnes', 'pescados', 'mariscos', 'visceras'].includes(food.g)) {
      t.animalProteinGrams += grams;
    }
  }

  return t;
}

/**
 * Factores que modifican la absorción del hierro NO hemo en una comida.
 * Cada uno se devuelve por separado para poder explicarlo en pantalla.
 */
export function modifiers(totals) {
  const { phytate, polyphenol, calcium, vitC, animalProteinGrams } = totals;

  // Fitatos: el freno principal de las menestras y los cereales integrales.
  const phy = 1 / (1 + 0.0059 * phytate);

  // Polifenoles y taninos: té, café, chicha morada, algunas verduras de hoja.
  const pol = 1 / (1 + 0.0022 * polyphenol);

  // Vitamina C: el potenciador más accesible. Su efecto es proporcionalmente
  // mayor cuando hay muchos fitatos que contrarrestar.
  const phytatePressure = clamp(1 + phytate / 400, 1, 2.2);
  const vitCRaw = 1 + 0.6 * Math.log(1 + vitC / 25) * phytatePressure;
  const asc = clamp(vitCRaw, 1, 5);

  // Proteína animal muscular: unos 90 g duplican la absorción del hierro vegetal.
  const meat = clamp(1 + animalProteinGrams / 90, 1, 2.5);

  // Calcio: compite con el hierro en el mismo transportador intestinal.
  const ca = clamp(1 - 0.45 * (calcium / (calcium + 200)), 0.55, 1);

  return {
    phytate: phy,
    polyphenol: pol,
    vitC: asc,
    meat,
    calcium: ca,
    total: phy * pol * asc * meat * ca,
  };
}

/**
 * Calcula el hierro absorbido de una comida.
 * @param {Array} items  [{food, grams}]
 * @param {Object} ctx   { ferritin }
 */
export function absorbFromMeal(items, ctx = {}) {
  const totals = mealTotals(items);
  const mods = modifiers(totals);
  const ferritin = ctx.ferritin ?? REF_FERRITIN;

  // No hemo
  const nonHemeRate = clamp(
    BASE_NONHEME * statusFactor(ferritin) * mods.total,
    0.3, 40,
  );

  // Hemo: solo lo frena el calcio de forma apreciable.
  const hemeRate = clamp(
    BASE_HEME * statusFactor(ferritin, { heme: true }) * mods.calcium,
    5, 45,
  );

  const absorbedNonHeme = totals.ironNonHeme * (nonHemeRate / 100);
  const absorbedHeme = totals.ironHeme * (hemeRate / 100);
  const absorbed = absorbedNonHeme + absorbedHeme;

  return {
    totals,
    modifiers: mods,
    nonHemeRate: +nonHemeRate.toFixed(2),
    hemeRate: +hemeRate.toFixed(2),
    absorbedNonHeme: +absorbedNonHeme.toFixed(3),
    absorbedHeme: +absorbedHeme.toFixed(3),
    absorbed: +absorbed.toFixed(3),
    // Rendimiento global de la comida: del hierro que entró por la boca,
    // qué fracción llega realmente a la sangre.
    yield: totals.ironTotal > 0 ? +((absorbed / totals.ironTotal) * 100).toFixed(1) : 0,
  };
}

/**
 * Puntuación de compatibilidad de una combinación: 0 a 100.
 * No mide cuánto hierro trae el plato, sino qué tan bien está armado para que
 * ese hierro se aproveche. Un plato con poco hierro bien combinado puede rendir
 * más que uno con mucho hierro mal combinado.
 */
export function compatibility(items, ctx = {}) {
  const result = absorbFromMeal(items, ctx);
  const { modifiers: m, totals } = result;

  if (totals.ironTotal <= 0.05) {
    return { score: null, label: 'Sin hierro apreciable', notes: ['Esta combinación no aporta hierro para evaluar.'], result };
  }

  // El rendimiento de referencia de una comida bien armada ronda el 20 %.
  const score = clamp(Math.round((result.yield / 20) * 100), 0, 100);

  const notes = [];
  if (m.vitC > 1.5) notes.push(`La vitamina C (${Math.round(totals.vitC)} mg) multiplica por ${m.vitC.toFixed(1)} el hierro vegetal.`);
  else if (totals.ironNonHeme > 0.5) notes.push('Falta vitamina C: un chorro de limón o una fruta cítrica cambiaría bastante el resultado.');

  if (m.meat > 1.2) notes.push(`La proteína animal del plato (${Math.round(totals.animalProteinGrams)} g) ayuda a absorber el hierro vegetal.`);
  if (m.phytate < 0.6) notes.push(`Los fitatos (${Math.round(totals.phytate)} mg) retienen parte del hierro; remojar las menestras la noche anterior reduce este efecto.`);
  if (m.polyphenol < 0.7) notes.push(`Los polifenoles (${Math.round(totals.polyphenol)} mg) frenan la absorción. Si vienen de té, café o infusión, conviene tomarlos una o dos horas después.`);
  if (m.calcium < 0.8) notes.push(`El calcio (${Math.round(totals.calcium)} mg) compite con el hierro. Los lácteos rinden mejor en otro momento del día.`);
  if (totals.ironHeme > 0.3) notes.push(`Trae ${totals.ironHeme.toFixed(1)} mg de hierro hemo, que se absorbe casi sin obstáculos.`);

  let label = 'Regular';
  if (score >= 80) label = 'Excelente';
  else if (score >= 60) label = 'Buena';
  else if (score >= 35) label = 'Mejorable';
  else label = 'Poco eficiente';

  return { score, label, notes, result };
}

/**
 * Sugerencias concretas para mejorar una combinación, ordenadas por el impacto
 * que tendrían. Se calculan probando el cambio, no adivinando.
 */
export function suggestions(items, foods, ctx = {}) {
  const baseline = absorbFromMeal(items, ctx).absorbed;
  if (baseline <= 0) return [];

  const candidates = foods.filter((f) => f.tags?.includes('potenciador') && !items.some((i) => i.food.id === f.id));
  const out = [];

  for (const food of candidates) {
    const grams = food.porc || 100;
    const test = absorbFromMeal([...items, { food, grams }], ctx).absorbed;
    const gain = test - baseline;
    if (gain > 0.05) {
      out.push({
        food,
        grams,
        gain: +gain.toFixed(3),
        pct: Math.round((gain / baseline) * 100),
        text: `Añadir ${food.n.toLowerCase()} (${food.pu}) sumaría ${gain.toFixed(2)} mg de hierro absorbido, un ${Math.round((gain / baseline) * 100)} % más.`,
      });
    }
  }

  // Retirar inhibidores también es una sugerencia válida.
  for (const item of items) {
    if (!item.food.tags?.includes('evitar_con_hierro')) continue;
    const without = items.filter((i) => i !== item);
    const test = absorbFromMeal(without, ctx).absorbed;
    const gain = test - baseline;
    if (gain > 0.05) {
      out.push({
        food: item.food,
        remove: true,
        gain: +gain.toFixed(3),
        pct: Math.round((gain / baseline) * 100),
        text: `Mover ${item.food.n.toLowerCase()} a otro momento del día recuperaría ${gain.toFixed(2)} mg, un ${Math.round((gain / baseline) * 100)} % más.`,
      });
    }
  }

  return out.sort((a, b) => b.gain - a.gain).slice(0, 5);
}
