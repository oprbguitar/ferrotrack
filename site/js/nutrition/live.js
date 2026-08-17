/**
 * Datos de nutrición en vivo.
 *
 * El catálogo que viene con el sitio se regenera periódicamente desde un flujo
 * automático del repositorio (.github/workflows/nutricion.yml), que consulta
 * USDA FoodData Central y vuelve a publicar data/foods.json. Ese es el camino
 * fiable, porque corre con red abierta y deja el resultado versionado.
 *
 * Este módulo es el camino complementario: consultar la API desde el propio
 * navegador de la persona, en el momento, si tiene una clave. Sirve para
 * comprobar un alimento puntual sin esperar al siguiente ciclo del flujo.
 *
 * Lo que nunca se sobrescribe son los factores de absorción — hemo, fitatos y
 * polifenoles — porque ninguna API los publica y son los que deciden cuánto
 * hierro entra de verdad.
 */

const FDC_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';

const NUTRIENT_MAP = {
  1089: 'fe', 1162: 'c', 1087: 'ca', 1003: 'pro',
  1008: 'kcal', 1178: 'b12', 1177: 'fol', 1095: 'zn',
};

/** Campos que el seed local siempre gana: no existen en ninguna API pública. */
const PROTECTED = new Set(['heme', 'phy', 'pol']);

const state = {
  lastCheck: null,
  message: 'sin consultas todavía',
  updated: 0,
  available: null,
};

export function refreshStatus() {
  return { ...state };
}

async function fetchFood(query, apiKey, signal) {
  const params = new URLSearchParams({
    query, api_key: apiKey || 'DEMO_KEY', pageSize: '1', dataType: 'SR Legacy,Foundation',
  });

  const res = await fetch(`${FDC_SEARCH}?${params}`, { signal });
  if (!res.ok) throw new Error(`la API respondió ${res.status}`);

  const payload = await res.json();
  const food = payload.foods?.[0];
  if (!food) return null;

  const values = {};
  for (const nutrient of food.foodNutrients || []) {
    const key = NUTRIENT_MAP[Number(nutrient.nutrientId ?? nutrient.nutrientNumber)];
    if (key && nutrient.value != null && !PROTECTED.has(key)) {
      values[key] = Math.round(Number(nutrient.value) * 100) / 100;
    }
  }
  return Object.keys(values).length ? { values, description: food.description, fdcId: food.fdcId } : null;
}

/**
 * Refresca en vivo los alimentos que declaran una consulta FDC.
 * Modifica el catálogo en memoria; el archivo publicado no se toca.
 */
export async function refreshFromLive(foods, apiKey, { limit = 12, timeoutMs = 12000 } = {}) {
  if (!foods?.length) {
    state.message = 'no hay catálogo cargado';
    return { ok: false, message: state.message };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const targets = foods.filter((f) => f.fdcQuery || f.fdcDesc).slice(0, limit);

  if (!targets.length) {
    state.lastCheck = new Date().toLocaleString('es-PE');
    state.message = 'ningún alimento del catálogo declara consulta en línea; el flujo del repositorio es el que mantiene estos datos al día';
    clearTimeout(timer);
    return { ok: true, message: state.message, updated: 0 };
  }

  let updated = 0;
  let failed = 0;

  for (const food of targets) {
    try {
      const hit = await fetchFood(food.fdcQuery || food.fdcDesc, apiKey, controller.signal);
      if (!hit) continue;
      Object.assign(food, hit.values);
      food.src = 'en vivo (USDA FDC)';
      food.fdcId = hit.fdcId;
      updated += 1;
    } catch (err) {
      failed += 1;
      // Un fallo de CORS o de red aquí no es un problema: el catálogo publicado
      // sigue siendo válido y es el que usa la aplicación por defecto.
      if (failed >= 3) {
        state.available = false;
        break;
      }
    }
  }

  clearTimeout(timer);

  state.lastCheck = new Date().toLocaleString('es-PE');
  state.updated = updated;
  state.available = updated > 0;
  state.message = updated
    ? `${updated} alimentos actualizados desde USDA FoodData Central`
    : 'no se pudo consultar la API desde el navegador; se mantiene el catálogo publicado con el sitio';

  return { ok: updated > 0, message: state.message, updated };
}

/** Carga el catálogo publicado junto al sitio. */
export async function loadFoods(base = '') {
  const res = await fetch(`${base}data/foods.json`);
  if (!res.ok) throw new Error('No se pudo cargar la base de alimentos.');
  return res.json();
}
