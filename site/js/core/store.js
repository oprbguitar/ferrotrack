/**
 * Almacenamiento del caso anónimo.
 *
 * Todo vive en el navegador (localStorage). No hay servidor, no hay cuenta,
 * no hay envío de datos. El caso se identifica con un código generado al azar
 * (FE-AAAA-XXXXX) y nunca con el nombre de una persona.
 */

const KEY = 'ferrotrack.v1';
const CONSONANTS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1

function randomCode() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const tail = [...bytes].map((b) => CONSONANTS[b % CONSONANTS.length]).join('');
  return `FE-${new Date().getFullYear()}-${tail}`;
}

export function emptyCase() {
  return {
    schema: 1,
    caseId: randomCode(),
    createdAt: new Date().toISOString(),
    // Perfil: solo variables con valor clínico. Nada que identifique a nadie.
    profile: {
      birthMonthOffset: null, // meses de edad; se guarda la edad, no la fecha de nacimiento
      ageYears: null,
      sex: 'female',          // female | male | intersex | no_declara
      pregnant: false,
      menstruates: null,      // null | true | false
      menstrualFlow: null,    // ligero | moderado | abundante
      menstrualPattern: null, // regular | irregular
      altitude: 0,            // metros sobre el nivel del mar
      diet: 'mixta',          // mixta | vegetariana | vegana
      weightKg: null,
      heightCm: null,
      country: 'PE',
      region: 'costa',
      conditions: [],         // antecedentes seleccionados
      allergies: [],
      dislikes: [],
      budget: 2,              // 1 economico, 2 medio, 3 amplio
      notes: '',
    },
    schedule: null,           // lo llena schedule.js con los valores por defecto
    labs: [],                 // [{ id, date, source, results: { analyteId: {...} } }]
    interventions: [],        // [{ id, start, end, kind, label, detail }]
    symptoms: [],             // [{ date, items: [] }]
    plans: [],                // planes de comida guardados
    settings: {
      coach: true,
      liveNutrition: true,
      fdcApiKey: '',
      rulesetVersion: '2026-08',
    },
  };
}

let state = null;
const listeners = new Set();

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.schema === 1) {
        state = { ...emptyCase(), ...parsed, profile: { ...emptyCase().profile, ...parsed.profile } };
        return state;
      }
    }
  } catch (err) {
    console.warn('No se pudo leer el caso guardado, se empieza de cero.', err);
  }
  state = emptyCase();
  save();
  return state;
}

export function get() {
  return state || load();
}

export function save() {
  if (!state) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('No se pudo guardar en este navegador.', err);
  }
  listeners.forEach((fn) => fn(state));
}

/** Aplica una mutación al caso y notifica a la interfaz. */
export function update(mutator) {
  const current = get();
  mutator(current);
  save();
  return current;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetCase() {
  state = emptyCase();
  save();
  return state;
}

export function newCaseId() {
  return update((c) => { c.caseId = randomCode(); }).caseId;
}

/** Exporta el caso como JSON descargable. Ya viene anonimizado por construcción. */
export function exportCase() {
  const data = JSON.stringify(get(), null, 2);
  return new Blob([data], { type: 'application/json' });
}

export function importCase(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  if (!parsed || parsed.schema !== 1) throw new Error('El archivo no tiene el formato esperado.');
  state = { ...emptyCase(), ...parsed, profile: { ...emptyCase().profile, ...parsed.profile } };
  save();
  return state;
}

/** Ordena los análisis de más antiguo a más reciente. */
export function labsChrono(caseData = get()) {
  return [...caseData.labs].sort((a, b) => a.date.localeCompare(b.date));
}

export function latestLab(caseData = get()) {
  const list = labsChrono(caseData);
  return list[list.length - 1] || null;
}

export function previousLab(caseData = get()) {
  const list = labsChrono(caseData);
  return list[list.length - 2] || null;
}

/** Edad en meses en la fecha de un análisis, si el perfil la declara. */
export function ageMonthsAt(caseData, isoDate) {
  const { ageYears } = caseData.profile;
  if (ageYears == null) return null;
  const ref = caseData.profile.ageAsOf || caseData.createdAt;
  const months = Math.round((new Date(isoDate) - new Date(ref)) / (1000 * 60 * 60 * 24 * 30.4375));
  return Math.max(0, Math.round(ageYears * 12 + months));
}
