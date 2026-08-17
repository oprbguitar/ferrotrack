/**
 * Ferrín, el consejero.
 *
 * Una gota de sangre con opiniones. Aparece en la esquina, dice una cosa corta
 * y se va. Existe porque un tablero de indicadores no acompaña a nadie durante
 * seis meses, y este seguimiento dura eso.
 *
 * Dos reglas que no se rompen:
 *  1. Ferrín nunca da indicaciones médicas ni habla de dosis. Anima, celebra,
 *     explica trucos de cocina y recuerda controles.
 *  2. Nunca miente para motivar. Si un indicador bajó, lo dice.
 */

import { bloodDrop } from './diagrams.js';

const MOODS = ['feliz', 'celebra', 'animo', 'pensativo', 'triste'];

/** Guion por situación. Se elige una frase al azar para que no se vuelva monótono. */
const LINES = {
  bienvenida: [
    { mood: 'feliz', text: '¡Hola! Soy <b>Ferrín</b>. Vivo en tu sangre y me tomo muy en serio mi trabajo. Sube un análisis y te cuento todo lo que veo.' },
    { mood: 'feliz', text: 'Buenas. Soy <b>Ferrín</b>, tu gota de confianza. No guardo tu nombre, no sé quién eres, y así está perfecto. Empecemos.' },
  ],
  primer_analisis: [
    { mood: 'pensativo', text: 'Primer análisis guardado. Todavía no puedo comparar nada, así que este queda como <b>punto de partida</b>. El siguiente es donde empieza lo bueno.' },
  ],
  mejora: [
    { mood: 'celebra', text: '¡Eso! <b>{{label}}</b> subió de {{from}} a {{to}}. Pequeño pero real, y lo real cuenta.' },
    { mood: 'celebra', text: 'Mira esto: <b>{{label}}</b> pasó de {{from}} a {{to}}. Voy a estar insoportable el resto del día.' },
    { mood: 'celebra', text: '<b>{{label}}</b>: {{from}} → {{to}}. Alguien está haciendo las cosas bien y creo que sé quién.' },
  ],
  retroceso: [
    { mood: 'animo', text: '<b>{{label}}</b> bajó de {{from}} a {{to}}. No es para asustarse, pero sí para anotarlo y preguntarlo en el control.' },
    { mood: 'pensativo', text: 'Ojo con <b>{{label}}</b>: {{from}} → {{to}}. Prefiero decírtelo a que te enteres después.' },
  ],
  divergencia: [
    { mood: 'pensativo', text: 'Pasa algo interesante: la <b>hemoglobina subió</b> pero la <b>saturación bajó</b>. La fábrica está trabajando más rápido de lo que llega el material. Por eso no basta con mirar la hemoglobina.' },
  ],
  reservas_bajas: [
    { mood: 'animo', text: 'Tus <b>reservas</b> siguen bajas. Es como tener el tanque de reserva vacío: el auto anda, pero sin margen para un imprevisto.' },
  ],
  plan_listo: [
    { mood: 'feliz', text: 'Plan del día listo: <b>{{mg}} mg</b> de hierro absorbido. Eso es {{pct}} % de lo que necesitas hoy.' },
    { mood: 'celebra', text: 'Armé tu día. Aporta <b>{{mg}} mg</b> de hierro que sí entra al cuerpo, no el que se queda en la etiqueta.' },
  ],
  truco_vitc: [
    { mood: 'feliz', text: 'Truco gratis: exprimir <b>limón</b> sobre las menestras puede duplicar el hierro que aprovechas. Cero soles, dos segundos.' },
    { mood: 'feliz', text: 'El <b>camu camu</b> tiene más vitamina C que cualquier otra fruta del planeta. Una cucharadita convierte un plato común en uno que rinde.' },
    { mood: 'pensativo', text: '¿Sabías que el <b>pimiento rojo crudo</b> tiene más vitamina C que la naranja? Y va bien en cualquier ensalada.' },
  ],
  truco_te: [
    { mood: 'animo', text: 'El <b>té y el café</b> con la comida pueden borrar hasta tres cuartas partes del hierro vegetal del plato. Ricos, sí, pero una hora después.' },
    { mood: 'pensativo', text: 'La <b>leche</b> es buenísima, pero su calcio se pelea con el hierro por la misma puerta de entrada. Mejor en otro momento del día.' },
  ],
  truco_remojo: [
    { mood: 'feliz', text: 'Dejar las <b>menestras en remojo</b> desde la noche anterior reduce los fitatos y libera parte del hierro que se quedaría preso.' },
  ],
  recreo: [
    { mood: 'feliz', text: 'Quince minutos de recreo dan para poco: por eso el plan solo pone ahí cosas que se comen <b>de pie y con la mano</b>.' },
  ],
  control_cerca: [
    { mood: 'pensativo', text: 'Se acerca tu control del <b>{{fecha}}</b>. Buen momento para anotar las preguntas antes de que se te olviden en la consulta.' },
  ],
  animo_general: [
    { mood: 'animo', text: 'Esto va de <b>meses</b>, no de días. Los análisis cambian antes que las sensaciones, así que no te fíes solo de cómo te sientes.' },
    { mood: 'feliz', text: 'Cada plato bien combinado suma. No hace falta que todos salgan perfectos: hacen falta muchos que salgan bien.' },
    { mood: 'celebra', text: 'Dato inútil pero lindo: en este momento tienes unos <b>25 billones</b> de glóbulos rojos trabajando. Yo soy uno de ellos y estoy dando lo mejor.' },
    { mood: 'pensativo', text: 'Un glóbulo rojo vive unos <b>120 días</b> y da unas 170 000 vueltas al cuerpo. Por eso lo que comes hoy se ve en el análisis de dentro de dos meses.' },
  ],
  nivel_rojo: [
    { mood: 'triste', text: 'Este resultado merece que lo vea <b>un profesional pronto</b>. Yo acompaño, pero acá no me toca a mí. De verdad: pide la cita.' },
  ],
  privacidad: [
    { mood: 'feliz', text: 'Revisé el informe y saqué <b>{{n}}</b> datos personales antes de guardarlo. Ni tu nombre ni tu documento entran aquí.' },
  ],
};

let host = null;
let timer = null;
let enabled = true;
let lastKey = null;

function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement('div');
  host.id = 'ferrin-host';
  document.body.append(host);
  return host;
}

function fill(text, vars = {}) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] ?? ''));
}

/**
 * Muestra a Ferrín.
 * @param {String} key       situación (una clave de LINES)
 * @param {Object} vars      variables para la frase
 * @param {Object} options   { sticky, ms, actions }
 */
export function say(key, vars = {}, options = {}) {
  if (!enabled) return;
  const pool = LINES[key];
  if (!pool || !pool.length) return;
  // No repetir la misma situación dos veces seguidas.
  if (key === lastKey && !options.force) return;
  lastKey = key;

  const line = pool[Math.floor(Math.random() * pool.length)];
  render(line, vars, options);
}

/** Frase suelta, para casos que no están en el guion. */
export function sayRaw(text, mood = 'feliz', options = {}) {
  if (!enabled) return;
  render({ mood, text }, {}, options);
}

function render(line, vars, options) {
  const root = ensureHost();
  root.innerHTML = '';

  const card = document.createElement('aside');
  card.className = 'coach';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');

  const head = document.createElement('div');
  head.className = 'coach-head';

  const avatar = document.createElement('div');
  avatar.className = `drop ${line.mood === 'celebra' ? 'cheer' : 'bounce'}`;
  avatar.append(bloodDrop({ size: 40, mood: line.mood }));

  const names = document.createElement('div');
  names.innerHTML = `<div class="coach-name">Ferrín</div><div class="coach-mood">${moodLabel(line.mood)}</div>`;

  const close = document.createElement('button');
  close.className = 'coach-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar el consejo');
  close.textContent = '×';
  close.onclick = () => dismiss();

  head.append(avatar, names, close);

  const body = document.createElement('div');
  body.className = 'coach-body';
  body.innerHTML = fill(line.text, vars);

  card.append(head, body);

  if (options.actions?.length) {
    const row = document.createElement('div');
    row.className = 'coach-actions';
    for (const action of options.actions) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-primary';
      btn.type = 'button';
      btn.textContent = action.label;
      btn.onclick = () => { dismiss(); action.run?.(); };
      row.append(btn);
    }
    card.append(row);
  }

  root.append(card);

  clearTimeout(timer);
  if (!options.sticky) {
    timer = setTimeout(dismiss, options.ms ?? 9000);
  }
}

function moodLabel(mood) {
  return {
    feliz: 'tu consejero de guardia',
    celebra: '¡celebrando!',
    animo: 'dándote ánimo',
    pensativo: 'pensando en voz alta',
    triste: 'preocupado, pero contigo',
  }[mood] || 'tu consejero de guardia';
}

export function dismiss() {
  clearTimeout(timer);
  const card = host?.querySelector('.coach');
  if (!card) return;
  card.classList.add('leaving');
  setTimeout(() => { if (host) host.innerHTML = ''; }, 220);
}

export function setEnabled(value) {
  enabled = !!value;
  if (!enabled) dismiss();
}

export function isEnabled() { return enabled; }

/**
 * Elige qué decir a partir del estado del caso. Concentrar la decisión aquí
 * evita que cada vista tenga que acordarse de invocar al consejero.
 */
export function reactTo(context) {
  const { interpretation, deltas, isFirstLab, plan, privacyCount } = context;

  if (privacyCount) { say('privacidad', { n: privacyCount }); return; }
  if (isFirstLab) { say('primer_analisis'); return; }
  if (interpretation?.level === 'rojo') { say('nivel_rojo', {}, { sticky: true }); return; }

  if (interpretation?.patterns?.some((p) => p.id === 'P03_divergencia')) {
    say('divergencia', {}, { ms: 12000 });
    return;
  }

  if (plan) {
    say('plan_listo', { mg: plan.absorbed.toFixed(2), pct: plan.coverage });
    return;
  }

  const improved = Object.values(deltas || {}).filter((d) => d.quality === 'mejora');
  if (improved.length) {
    const best = improved.sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0))[0];
    say('mejora', { label: best.def.short, from: best.previous, to: best.value });
    return;
  }

  const worse = Object.values(deltas || {}).filter((d) => d.quality === 'empeora');
  if (worse.length) {
    const worst = worse.sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0))[0];
    say('retroceso', { label: worst.def.short, from: worst.previous, to: worst.value });
    return;
  }

  say('animo_general', {}, { force: true });
}

/** Un consejo suelto, para el botón "dime algo". */
export function randomTip() {
  const keys = ['truco_vitc', 'truco_te', 'truco_remojo', 'animo_general', 'recreo'];
  say(keys[Math.floor(Math.random() * keys.length)], {}, { force: true });
}

export { MOODS };
