/**
 * Parser universal de informes de laboratorio.
 *
 * Recibe texto plano (pegado desde un PDF, copiado de un portal o tipeado) y
 * devuelve resultados estructurados y normalizados: cada uno con su código
 * LOINC, su valor convertido a la unidad canónica UCUM del analito, el rango
 * que informó el laboratorio y, si el informe lo trae, el resultado anterior.
 *
 * Nunca infiere: lo que no reconoce, lo reporta como "no interpretado" para
 * que la persona lo complete a mano.
 */

import { anonymizeText, extractSafeProfileHints } from './anonymize.js';

let DICT = null;

export async function loadDictionary(base = '') {
  if (DICT) return DICT;
  const res = await fetch(`${base}data/analytes.json`);
  if (!res.ok) throw new Error('No se pudo cargar el diccionario de analitos.');
  DICT = await res.json();
  DICT.byId = Object.fromEntries(DICT.analytes.map((a) => [a.id, a]));
  DICT.index = buildAliasIndex(DICT.analytes);
  return DICT;
}

export function dictionary() { return DICT; }
export function analyte(id) { return DICT?.byId?.[id] || null; }

function fold(s) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%^/+.\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAliasIndex(analytes) {
  const entries = [];
  for (const a of analytes) {
    const names = new Set([a.label, a.short, ...(a.aliases || [])]);
    for (const name of names) {
      const folded = fold(name);
      if (folded.length >= 2) entries.push({ id: a.id, alias: folded, len: folded.length });
    }
  }
  // Alias más largos primero: "rdw-sd" debe ganarle a "rdw".
  return entries.sort((x, y) => y.len - x.len);
}

const NUMBER = /-?\d+(?:[.,]\d+)?/g;
const RANGE = /(-?\d+(?:[.,]\d+)?)\s*(?:[-–]|\sa\s)\s*(-?\d+(?:[.,]\d+)?)/g;
const DATE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const SCI_UNIT = /x?\s*10\s*\^?\s*\d+\s*(?:cel)?\s*\/\s*[uµm]?l/gi;
const ISO_NOISE = /\bISO\s*\d+[:\d]*\b/gi;

function num(raw) {
  if (raw == null) return null;
  const v = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Detecta la unidad escrita en un fragmento y devuelve su factor de conversión. */
function detectUnit(segment, def) {
  const aliases = def.unitAliases || {};
  const foldedSeg = fold(segment);
  let best = null;
  for (const [unit, factor] of Object.entries(aliases)) {
    const foldedUnit = fold(unit);
    if (!foldedUnit) continue;
    if (foldedSeg.includes(foldedUnit)) {
      if (!best || foldedUnit.length > best.len) best = { unit, factor, len: foldedUnit.length };
    }
  }
  return best;
}

/** Localiza en qué posiciones del texto aparece cada analito. */
function locate(foldedText) {
  const hits = [];
  const taken = [];
  const overlaps = (start, end) => taken.some(([s, e]) => start < e && end > s);

  for (const entry of DICT.index) {
    let from = 0;
    for (;;) {
      const at = foldedText.indexOf(entry.alias, from);
      if (at === -1) break;
      const end = at + entry.alias.length;
      const before = at === 0 ? ' ' : foldedText[at - 1];
      const after = end >= foldedText.length ? ' ' : foldedText[end];
      const isWord = /[a-z0-9]/.test(before) === false && /[a-z0-9]/.test(after) === false;
      if (isWord && !overlaps(at, end)) {
        hits.push({ id: entry.id, start: at, end });
        taken.push([at, end]);
      }
      from = at + 1;
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/**
 * Parsea el texto de un informe.
 * @returns {{results: Object, unmatched: string[], privacy: Object, hints: Object, dates: Object}}
 */
export function parseLabText(rawText) {
  if (!DICT) throw new Error('Diccionario no cargado.');

  const hints = extractSafeProfileHints(rawText);
  const privacy = anonymizeText(rawText);
  const text = privacy.text;

  const dates = extractDates(text);

  const folded = fold(text);
  const hits = locate(folded);

  // El texto plegado conserva las posiciones relativas, pero no los caracteres
  // originales; trabajamos directamente sobre el texto plegado para los valores,
  // que son números y unidades ASCII en su mayoría.
  const results = {};
  const unmatched = [];

  hits.forEach((hit, i) => {
    const def = DICT.byId[hit.id];
    if (!def || results[hit.id]) return; // el primer hallazgo manda

    const nextStart = hits[i + 1]?.start ?? folded.length;
    let segment = folded.slice(hit.end, Math.min(nextStart, hit.end + 220));

    const unit = detectUnit(segment, def);

    // Limpiamos ruido que contiene dígitos y confundiría la lectura.
    let clean = segment
      .replace(DATE, ' ').replace(TIME, ' ')
      .replace(SCI_UNIT, ' ').replace(ISO_NOISE, ' ')
      .replace(/\b(?:b\s*-?\s*12|b12)\b/g, ' ');
    if (unit) clean = clean.split(fold(unit.unit)).join(' ');

    // El rango de referencia es el primer "A - B" del fragmento: los informes
    // suelen imprimirlo antes de cualquier tabla de rangos por edad.
    RANGE.lastIndex = 0;
    const refMatch = RANGE.exec(clean);

    let ref = null;
    if (refMatch) {
      ref = { low: num(refMatch[1]), high: num(refMatch[2]) };
      clean = clean.slice(0, refMatch.index) + ' ' + clean.slice(refMatch.index + refMatch[0].length);
    }

    NUMBER.lastIndex = 0;
    const numbers = (clean.match(NUMBER) || []).map(num).filter((v) => v != null);
    if (!numbers.length) { unmatched.push(def.label); return; }

    const factor = unit ? unit.factor : 1;
    const value = round(numbers[0] * factor, def.decimals);
    if (!plausible(value, def)) { unmatched.push(`${def.label} (valor fuera de lo posible)`); return; }

    // Muchos informes imprimen el resultado anterior justo después del método.
    let previous = null;
    for (let k = 1; k < numbers.length; k += 1) {
      const candidate = round(numbers[k] * factor, def.decimals);
      if (plausible(candidate, def)) { previous = candidate; break; }
    }

    results[hit.id] = {
      analyte: hit.id,
      loinc: def.loinc,
      value,
      unit: def.displayUnit,
      ucum: def.ucum,
      reportedUnit: unit ? unit.unit : null,
      converted: factor !== 1,
      labRange: ref,
      previousInReport: previous,
    };
  });

  return { results, unmatched, privacy, hints, dates };
}

function round(v, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function plausible(value, def) {
  const [lo, hi] = def.plausible || [-Infinity, Infinity];
  return value >= lo && value <= hi;
}

/** Busca la fecha de toma de muestra y la del resultado anterior. */
function extractDates(text) {
  const out = { sample: null, previous: null, all: [] };

  const iso = (s) => {
    const m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (!m) return null;
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    const dt = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return Number.isNaN(Date.parse(dt)) ? null : dt;
  };

  const sample = text.match(/Fecha\s+de\s+Toma\s+de\s+Muestras?\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  if (sample) out.sample = iso(sample[1]);

  const prev = text.match(/Resultado\s+Anterior\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  if (prev) out.previous = iso(prev[1]);

  out.all = [...new Set((text.match(DATE) || []).map(iso).filter(Boolean))].sort();
  if (!out.sample && out.all.length) out.sample = out.all[out.all.length - 1];

  return out;
}

/** Convierte un valor tipeado a mano a la unidad canónica del analito. */
export function normalizeManual(analyteId, value, unit) {
  const def = DICT.byId[analyteId];
  if (!def) throw new Error(`Analito desconocido: ${analyteId}`);
  const factor = def.unitAliases?.[unit] ?? 1;
  return {
    analyte: analyteId,
    loinc: def.loinc,
    value: round(Number(value) * factor, def.decimals),
    unit: def.displayUnit,
    ucum: def.ucum,
    reportedUnit: unit || def.displayUnit,
    converted: factor !== 1,
    labRange: null,
    previousInReport: null,
  };
}
