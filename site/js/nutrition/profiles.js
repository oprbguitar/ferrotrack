/**
 * Perfiles rápidos por rango.
 *
 * En vez de pedir datos exactos, la persona elige un rango de edad, un rango de
 * peso y qué tipo de día tiene (colegio, trabajo, casa). De ahí sale un perfil
 * promedio con el que ya se puede generar el plan, y un horario que encaja con
 * ese tipo de día.
 */

import { DEFAULT_SCHEDULE } from './schedule.js';

/** Rangos de edad. `mid` es el promedio con el que se calcula todo. */
export const AGE_RANGES = [
  { id: '6-9', label: '6 a 9 años', min: 6, max: 9, mid: 7, emoji: '🧒', tag: 'Niñez' },
  { id: '10-13', label: '10 a 13 años', min: 10, max: 13, mid: 11, emoji: '🎒', tag: 'Escolar' },
  { id: '14-17', label: '14 a 17 años', min: 14, max: 17, mid: 15, emoji: '📚', tag: 'Adolescencia' },
  { id: '18-30', label: '18 a 30 años', min: 18, max: 30, mid: 24, emoji: '💼', tag: 'Joven adulto' },
  { id: '31-50', label: '31 a 50 años', min: 31, max: 50, mid: 40, emoji: '🧑', tag: 'Adulto' },
  { id: '51+', label: '51 años a más', min: 51, max: 80, mid: 58, emoji: '👵', tag: 'Adulto mayor' },
];

/** Rangos de peso. `mid` es el promedio con el que se calcula el déficit. */
export const WEIGHT_RANGES = [
  { id: '20-30', label: '20 a 30 kg', min: 20, max: 30, mid: 25 },
  { id: '30-40', label: '30 a 40 kg', min: 30, max: 40, mid: 35 },
  { id: '40-50', label: '40 a 50 kg', min: 40, max: 50, mid: 45 },
  { id: '50-60', label: '50 a 60 kg', min: 50, max: 60, mid: 55 },
  { id: '60-70', label: '60 a 70 kg', min: 60, max: 70, mid: 65 },
  { id: '70-85', label: '70 a 85 kg', min: 70, max: 85, mid: 77 },
  { id: '85-100', label: '85 a 100 kg', min: 85, max: 100, mid: 92 },
];

/** Tipo de día: cambia el horario y el gasto de energía. */
export const OCCUPATIONS = [
  {
    id: 'colegio', label: 'Voy al colegio', emoji: '🏫',
    desc: 'Clases en la mañana, recreos y lonchera.',
    activity: 1.5,
  },
  {
    id: 'trabajo', label: 'Trabajo', emoji: '💼',
    desc: 'Jornada laboral, almuerzo fuera de casa.',
    activity: 1.4,
  },
  {
    id: 'trabajo_fisico', label: 'Trabajo de fuerza', emoji: '🧱',
    desc: 'Construcción, campo, carga: mucho gasto físico.',
    activity: 1.75,
  },
  {
    id: 'casa', label: 'En casa / estudio en casa', emoji: '🏠',
    desc: 'Horario flexible, comidas en casa.',
    activity: 1.35,
  },
];

export const DIETS = [
  { id: 'mixta', label: 'Como de todo', emoji: '🍗' },
  { id: 'vegetariana', label: 'Vegetariana', emoji: '🥗' },
  { id: 'vegana', label: 'Vegana', emoji: '🌱' },
];

export const findAge = (id) => AGE_RANGES.find((r) => r.id === id) || AGE_RANGES[1];
export const findWeight = (id) => WEIGHT_RANGES.find((r) => r.id === id) || WEIGHT_RANGES[3];
export const findOccupation = (id) => OCCUPATIONS.find((r) => r.id === id) || OCCUPATIONS[0];

/** Horario que encaja con el tipo de día elegido. */
export function scheduleFor(occupationId) {
  const s = structuredClone(DEFAULT_SCHEDULE);
  if (occupationId === 'trabajo' || occupationId === 'trabajo_fisico') {
    s.school = { ...s.school, enabled: false };
    s.breaks = [{ id: 'pausa', label: 'Pausa de media mañana', start: '10:30', minutes: 15 }];
    s.breakfastMode = 'rapido';
    s.meals = {
      desayuno: { label: 'Desayuno', time: '06:45', minutes: 20, mode: 'rapido', enabled: true },
      almuerzo: { label: 'Almuerzo', time: '13:00', minutes: 45, mode: 'completo', enabled: true },
      merienda: { label: 'Lonche', time: '17:00', minutes: 15, mode: 'rapido', enabled: true },
      cena: { label: 'Cena', time: '20:30', minutes: 35, mode: 'completo', enabled: true },
    };
  } else if (occupationId === 'casa') {
    s.school = { ...s.school, enabled: false };
    s.breaks = [];
    s.breakfastMode = 'completo';
    s.meals = {
      desayuno: { label: 'Desayuno', time: '08:00', minutes: 30, mode: 'completo', enabled: true },
      almuerzo: { label: 'Almuerzo', time: '13:30', minutes: 45, mode: 'completo', enabled: true },
      merienda: { label: 'Lonche', time: '17:30', minutes: 20, mode: 'rapido', enabled: true },
      cena: { label: 'Cena', time: '20:30', minutes: 35, mode: 'completo', enabled: true },
    };
  }
  return s;
}

/**
 * Arma un perfil promedio a partir de los rangos elegidos.
 * Conserva lo que ya estuviera puesto (dieta, presupuesto, sexo) si viene.
 */
export function profileFromRanges({ ageId, weightId, occupationId, diet, budget, sex, base = {} }) {
  const age = findAge(ageId);
  const weight = findWeight(weightId);
  const occ = findOccupation(occupationId);

  return {
    ...base,
    ageYears: age.mid,
    ageAsOf: new Date().toISOString().slice(0, 10),
    ageRange: age.id,
    weightKg: weight.mid,
    weightRange: weight.id,
    occupation: occ.id,
    diet: diet || base.diet || 'mixta',
    budget: budget || base.budget || 2,
    sex: sex || base.sex || 'no_declara',
    // Menores en crecimiento: se marca para que la proyección sume la demanda.
    menstruates: base.menstruates ?? false,
  };
}

/**
 * Traduce el plan a energía y a lo que se puede hacer con ella. Es lo que hace
 * que comer bien deje de ser una obligación abstracta: si comes así, esto es lo
 * que tu cuerpo va a poder hacer.
 */
export function energyReport(plan, profile) {
  const kcal = plan.totals.kcal || 0;
  const occ = findOccupation(profile.occupation);
  const weight = profile.weightKg || 60;

  // Gasto estimado del día: metabolismo basal (Mifflin simplificado) × actividad.
  const bmr = 10 * weight + 6.25 * 165 - 5 * (profile.ageYears || 25) + (profile.sex === 'male' ? 5 : -161);
  const need = Math.round(bmr * (occ.activity || 1.4));
  const ratio = need > 0 ? kcal / need : 1;

  // Horas de tareas mentales sostenidas que cubre la energía del plan
  // (el cerebro gasta ~0.3 kcal/min en concentración sostenida).
  const studyHours = Math.max(0, Math.round((kcal * 0.2) / 18));
  // Kilómetros de caminata (~0.5 kcal/kg/km) y de trote (~1 kcal/kg/km).
  const walkKm = Math.round((kcal * 0.25) / (0.5 * weight));
  const runKm = Math.max(1, Math.round((kcal * 0.18) / (1 * weight)));

  const level = ratio >= 0.95 ? 'alto' : ratio >= 0.7 ? 'medio' : 'bajo';

  const headline = {
    alto: 'Energía de sobra para todo el día',
    medio: 'Alcanza para el día, sin excesos',
    bajo: 'Se queda algo corto para un día activo',
  }[level];

  const abilities = [
    { emoji: '📚', text: `Estudiar o concentrarte unas ${studyHours} h seguidas`, ok: studyHours >= 3 },
    { emoji: '🚶', text: `Caminar cerca de ${walkKm} km sin quedarte sin fuerzas`, ok: walkKm >= 3 },
    { emoji: '🏃', text: `Trotar o jugar unos ${runKm} km`, ok: runKm >= 2 },
    { emoji: '⚡', text: occ.id === 'trabajo_fisico'
      ? 'Aguantar una jornada de carga física'
      : occ.id === 'colegio'
        ? 'Rendir en clase y en el recreo'
        : 'Sostener la jornada sin bajones', ok: level !== 'bajo' },
  ];

  return { kcal: Math.round(kcal), need, ratio: +ratio.toFixed(2), level, headline, studyHours, walkKm, runKm, abilities };
}
