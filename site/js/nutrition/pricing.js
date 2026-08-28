/**
 * Precios de mercado aproximados (Perú) y armado de la compra.
 *
 * Los valores son soles por kilo del alimento tal como se lista (listo para
 * comer), tomados de precios de mercado de barrio 2025-2026. Son referenciales:
 * cambian por temporada, región y dónde compres. Sirven para dar una idea del
 * orden de magnitud —«¿me alcanza?»— no para cuadrar el gasto al céntimo.
 */

// Soles por kilo, por alimento. Lo que no aparece cae al precio del grupo.
const PRICE_BY_ID = {
  // Vísceras: lo más barato con más hierro.
  sangrecita: 8, higado_pollo: 12, higado_res: 16, bazo: 12, mollejita: 13,
  // Carnes.
  carne_res: 30, carne_cordero: 32, alpaca: 24, cuy: 38, pollo_pechuga: 16,
  pollo_pierna: 11, cerdo: 20, pavita: 22,
  // Pescados y mariscos.
  anchoveta: 8, bonito: 14, jurel: 10, trucha: 22,
  conchas_negras: 28, almejas: 20, choros: 12,
  // Huevos.
  huevo: 9, huevo_codorniz: 28,
  // Menestras (precio del cocido servido).
  lentejas: 6, frejol_negro: 7, frejol_canario: 8, garbanzo: 9, pallar: 9,
  arveja_seca: 6, tarwi: 9, soya: 8,
  // Granos y andinos.
  quinua: 11, kiwicha: 13, canihua: 15, avena: 5, arroz: 4, choclo: 5, mote: 6,
  // Panes y cereales.
  pan_integral: 9, pan_frances: 7, cereal_fortificado: 22,
  // Tubérculos.
  papa: 3, camote: 3, olluco: 5, yuca: 3,
  // Verduras.
  espinaca: 6, acelga: 5, brocoli: 7, tomate: 4, pimiento: 8, rocoto: 8,
  zapallo: 3, zanahoria: 3, beterraga: 4, col: 3, coliflor: 6,
  // Frutas.
  naranja: 4, mandarina: 5, camu_camu: 16, aguaymanto: 14, papaya: 4, fresa: 9,
  kiwi: 14, mango: 4, limon: 5, platano: 3, manzana: 6, pasas: 20,
  // Semillas y frutos secos.
  mani: 12, semilla_zapallo: 22, ajonjoli: 16, chia: 26, nuez: 48, castana: 60,
  // Lácteos.
  leche: 5, yogurt: 9, queso_fresco: 22,
  // Bebidas (agua e infusiones cuestan casi nada por vaso).
  te: 3, cafe: 8, chicha_morada: 3, refresco_maracuya: 3, agua: 0,
  // Otros y preparados.
  aceituna: 18, palta: 8, humita: 10, tortilla_verduras: 11,
};

const PRICE_BY_GROUP = {
  visceras: 12, carnes: 24, pescados: 12, mariscos: 20, huevos: 10,
  menestras: 8, granos: 8, cereales: 8, tuberculos: 3, verduras: 5,
  frutas: 5, semillas: 20, lacteos: 8, bebidas: 3, otros: 12, preparados: 10,
};

/** Soles por kilo del alimento. */
export function pricePerKg(food) {
  return PRICE_BY_ID[food.id] ?? PRICE_BY_GROUP[food.g] ?? 8;
}

/** Costo en soles de una cantidad concreta de un alimento. */
export function foodCost(food, grams) {
  return (pricePerKg(food) * grams) / 1000;
}

/** Costo de una comida (lista de ítems {food, grams}). */
export function mealCost(items) {
  return items.reduce((acc, it) => acc + foodCost(it.food, it.grams), 0);
}

/** Costo total de un plan de un día. */
export function dayCost(plan) {
  return plan.meals.reduce((acc, m) => acc + mealCost(m.items), 0);
}

/**
 * Arma la lista de compra a partir de un plan semanal: junta los gramos de cada
 * alimento en toda la semana, los redondea a una cantidad de compra sensata y
 * les pone precio.
 */
export function shoppingList(week) {
  const acc = new Map();

  for (const day of week.days) {
    for (const meal of day.meals) {
      for (const it of meal.items) {
        const prev = acc.get(it.food.id) || { food: it.food, grams: 0 };
        prev.grams += it.grams;
        acc.set(it.food.id, prev);
      }
    }
  }

  const items = [...acc.values()].map((row) => {
    const kg = row.grams / 1000;
    const buyKg = roundBuy(kg);
    const soles = pricePerKg(row.food) * buyKg;
    return {
      food: row.food,
      grams: Math.round(row.grams),
      kg: +kg.toFixed(2),
      buyKg,
      buyLabel: buyLabel(buyKg, row.food),
      pricePerKg: pricePerKg(row.food),
      soles: +soles.toFixed(2),
    };
  });

  // Agrupadas por categoría y ordenadas de mayor a menor gasto dentro de cada una.
  items.sort((a, b) => a.food.g.localeCompare(b.food.g) || b.soles - a.soles);

  const total = items.reduce((a, x) => a + x.soles, 0);
  const byGroup = new Map();
  for (const it of items) {
    const list = byGroup.get(it.food.g) || [];
    list.push(it);
    byGroup.set(it.food.g, list);
  }

  return {
    items,
    groups: [...byGroup.entries()].map(([g, list]) => ({
      group: g,
      label: list[0].food.gLabel || g,
      items: list,
      soles: +list.reduce((a, x) => a + x.soles, 0).toFixed(2),
    })),
    total: +total.toFixed(2),
    perDay: +(total / (week.days.length || 7)).toFixed(2),
    days: week.days.length,
  };
}

/** Redondea los kilos a una cantidad de compra realista de mercado. */
function roundBuy(kg) {
  if (kg <= 0.06) return 0.05;
  if (kg <= 0.12) return 0.1;
  if (kg <= 0.3) return 0.25;
  if (kg <= 0.6) return 0.5;
  if (kg <= 1.2) return 1;
  return Math.round(kg * 2) / 2; // al medio kilo
}

function buyLabel(kg, food) {
  // Huevos y panes se compran por unidad; el resto por peso.
  if (food.id === 'huevo') return `${Math.max(1, Math.round((kg * 1000) / 55))} huevos (≈${kg} kg)`;
  if (food.id === 'huevo_codorniz') return `≈${Math.round((kg * 1000) / 12)} huevitos`;
  if (food.g === 'cereales') return kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg} kg`;
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  return `${kg} kg`;
}

/** Soles con formato peruano: S/ 12,50. */
export function soles(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `S/ ${Number(value).toFixed(2).replace('.', ',')}`;
}
