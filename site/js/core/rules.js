/**
 * Motor de reglas clínicas.
 *
 * Determinista y auditable: cada conclusión sale de una regla identificable de
 * data/rules.YYYY-MM.json, con su fuente y su versión. Ninguna interpretación se
 * inventa aquí, y toda salida puede rastrearse hasta la regla que la produjo.
 *
 * El motor NO diagnostica. Describe patrones y dice en qué se basó.
 */

import { analyte } from './parser.js';
import { compare } from './longitudinal.js';

let RULES = null;

export async function loadRules(base = '', version = '2026-08') {
  if (RULES && RULES.version === version) return RULES;
  const res = await fetch(`${base}data/rules.${version}.json`);
  if (!res.ok) throw new Error('No se pudo cargar la base de reglas clínicas.');
  RULES = await res.json();
  return RULES;
}

export function rules() { return RULES; }

/** Punto de corte de hemoglobina aplicable a este perfil, ya ajustado por altitud. */
export function hemoglobinCutoff(profile, ageMonths) {
  const cfg = RULES.hemoglobin_cutoffs;
  const sexKey = profile.pregnant ? 'pregnant' : profile.sex;

  const match = cfg.rules.find((r) => {
    const inAge = ageMonths == null ? false : ageMonths >= r.minMonths && ageMonths <= r.maxMonths;
    const sexOk = r.sex === 'any' || r.sex === sexKey;
    return inAge && sexOk;
  }) || (profile.pregnant ? cfg.rules.find((r) => r.sex === 'pregnant') : null);

  if (!match) return null;

  let adjust = 0;
  for (const step of cfg.altitudeAdjustment.steps) {
    if ((profile.altitude || 0) >= step.meters) adjust = step.add;
  }

  return {
    value: +(match.cutoff + adjust).toFixed(2),
    base: match.cutoff,
    adjust,
    label: match.label,
    source: cfg.source,
  };
}

/** Umbral de ferritina aplicable, según edad y si hay inflamación documentada. */
export function ferritinCutoff(ageMonths, inflammation) {
  const cfg = RULES.ferritin_cutoffs;
  const table = inflammation ? cfg.depletedWithInflammation : cfg.depleted;
  const match = table.find((r) => ageMonths != null && ageMonths >= r.minMonths && ageMonths <= r.maxMonths)
    || table[table.length - 1];
  return { value: match.cutoff, label: match.label, inflammation: !!inflammation, source: cfg.source };
}

/**
 * Deriva las banderas booleanas que las reglas consultan. Cada bandera guarda
 * también el porqué, para poder mostrarlo en la interfaz.
 */
export function deriveFlags(lab, previous, profile, ageMonths) {
  const flags = {};
  const why = {};
  const v = (id) => lab?.results?.[id]?.value ?? null;

  const set = (name, value, reason) => { flags[name] = value; if (value) why[name] = reason; };

  // ---- Inflamación ----
  const pcr = v('pcr');
  const agp = v('agp');
  const gc = RULES.generic_cutoffs;
  const inflammation = (pcr != null && pcr > gc.pcr.inflammation) || (agp != null && agp > gc.agp.inflammation);
  set('inflamacion_presente', inflammation,
    pcr != null ? `PCR ${pcr} mg/L supera ${gc.pcr.inflammation} mg/L` : `AGP ${agp} g/L supera ${gc.agp.inflammation} g/L`);
  set('inflamacion_desconocida', pcr == null && agp == null, 'No hay PCR ni AGP en este control');

  // ---- Reservas ----
  const ferritina = v('ferritina');
  const fCut = ferritinCutoff(ageMonths, inflammation);
  if (ferritina != null) {
    set('ferritina_baja', ferritina < fCut.value,
      `Ferritina ${ferritina} ng/mL por debajo de ${fCut.value} ng/mL (${fCut.label})`);
    set('ferritina_no_baja', ferritina >= fCut.value, `Ferritina ${ferritina} ng/mL alcanza el umbral de ${fCut.value}`);
    set('ferritina_normal', ferritina >= fCut.value && ferritina <= RULES.ferritin_cutoffs.riskOfOverload.cutoff,
      `Ferritina ${ferritina} ng/mL dentro del rango aplicado`);
    set('ferritina_muy_alta', ferritina > RULES.ferritin_cutoffs.riskOfOverload.cutoff,
      `Ferritina ${ferritina} ng/mL por encima de ${RULES.ferritin_cutoffs.riskOfOverload.cutoff}`);
  }

  // ---- Disponibilidad ----
  const sat = v('sat_transferrina');
  if (sat != null) {
    set('saturacion_baja', sat < gc.sat_transferrina.low, `Saturación ${sat}% por debajo de ${gc.sat_transferrina.low}%`);
    set('saturacion_muy_baja', sat < gc.sat_transferrina.veryLow, `Saturación ${sat}% por debajo de ${gc.sat_transferrina.veryLow}%`);
    set('saturacion_normal', sat >= gc.sat_transferrina.low && sat <= gc.sat_transferrina.high, `Saturación ${sat}% dentro de rango`);
    set('saturacion_alta', sat > gc.sat_transferrina.high, `Saturación ${sat}% por encima de ${gc.sat_transferrina.high}%`);
  }

  const hierro = lab?.results?.hierro_serico;
  if (hierro?.value != null) {
    const low = hierro.labRange?.low ?? 33;
    set('hierro_bajo', hierro.value < low, `Hierro sérico ${hierro.value} µg/dL por debajo de ${low} µg/dL`);
  }

  // ---- Hemograma ----
  const hb = v('hemoglobina');
  const hbCut = hemoglobinCutoff(profile, ageMonths);
  if (hb != null && hbCut) {
    set('hemoglobina_baja', hb < hbCut.value,
      `Hemoglobina ${hb} g/dL por debajo de ${hbCut.value} g/dL (${hbCut.label}${hbCut.adjust ? `, ajustado +${hbCut.adjust} por altitud` : ''})`);
    set('hemoglobina_normal', hb >= hbCut.value, `Hemoglobina ${hb} g/dL alcanza el punto de corte de ${hbCut.value} g/dL`);
  }

  const vcmResult = lab?.results?.vcm;
  if (vcmResult?.value != null) {
    const low = vcmResult.labRange?.low ?? 79;
    set('vcm_bajo', vcmResult.value < low, `VCM ${vcmResult.value} fL por debajo de ${low} fL`);
  }

  const rdw = lab?.results?.rdw_cv;
  if (rdw?.value != null) {
    const high = rdw.labRange?.high ?? gc.rdw_cv.high;
    set('rdw_alto', rdw.value > high, `RDW-CV ${rdw.value}% por encima de ${high}%`);
  }

  // ---- Cofactores ----
  for (const [id, flag] of [['vitamina_b12', 'b12_baja'], ['acido_folico', 'folato_bajo']]) {
    const r = lab?.results?.[id];
    if (r?.value != null && r.labRange?.low != null) {
      set(flag, r.value < r.labRange.low, `${analyte(id).label} ${r.value} ${r.unit} por debajo de ${r.labRange.low}`);
    }
  }

  return { flags, why, cutoffs: { hemoglobina: hbCut, ferritina: fCut } };
}

/** Evalúa la condición de una regla contra banderas y tendencias. */
function matches(condition, flags, deltas) {
  if (condition.flag) return !!flags[condition.flag];
  if (condition.trend) {
    const d = deltas[condition.trend];
    if (!d || d.isNew) return false;
    return condition.dir === 'up' ? d.direction === 'sube' : d.direction === 'baja';
  }
  return false;
}

function evaluateWhen(when, flags, deltas) {
  const evidence = [];
  if (when.all) {
    for (const c of when.all) {
      if (!matches(c, flags, deltas)) return null;
      evidence.push(c);
    }
  }
  if (when.any) {
    const hit = when.any.filter((c) => matches(c, flags, deltas));
    if (!hit.length) return null;
    evidence.push(...hit);
  }
  if (!when.all && !when.any) return null;
  return evidence;
}

const LEVEL_ORDER = { rojo: 0, naranja: 1, amarillo: 2, verde: 3 };

/**
 * Interpreta un análisis completo.
 * @returns patrones detectados, alertas de seguridad, datos faltantes y el nivel global.
 */
export function interpret({ lab, previous, profile, ageMonths, interventionActive = false, symptoms = [] }) {
  if (!RULES) throw new Error('Base de reglas no cargada.');

  const { flags, why, cutoffs } = deriveFlags(lab, previous, profile, ageMonths);
  flags.intervencion_activa = interventionActive;

  const deltas = compare(lab, previous);

  const patterns = [];
  for (const rule of RULES.patterns) {
    const evidence = evaluateWhen(rule.when, flags, deltas);
    if (!evidence) continue;
    patterns.push({
      id: rule.id,
      title: rule.title,
      level: rule.level,
      priority: rule.priority,
      says: rule.says,
      watch: rule.watch,
      ask: rule.ask || [],
      because: evidence.map((c) => (c.flag ? why[c.flag] : trendReason(c, deltas))).filter(Boolean),
    });
  }
  patterns.sort((a, b) => a.priority - b.priority);

  // Alertas de seguridad: se evalúan aparte y siempre pesan más.
  const alerts = [];
  for (const s of RULES.safety.urgent) {
    const value = lab?.results?.[s.when.analyte]?.value;
    if (value == null) continue;
    const hit = s.when.op === '<' ? value < s.when.value : value > s.when.value;
    if (hit) alerts.push({ id: s.id, says: s.says, analyte: s.when.analyte, value });
  }
  for (const s of RULES.safety.symptomFlags) {
    if (symptoms.includes(s.symptom) && (flags.hemoglobina_baja || flags.ferritina_baja)) {
      alerts.push({ id: `sym-${s.symptom}`, says: s.says, symptom: s.symptom });
    }
  }

  // Datos que mejorarían la interpretación.
  const missing = [];
  for (const m of RULES.missingData) {
    const absent = lab?.results?.[m.needs]?.value == null;
    if (absent && flags[m.whenFlag]) {
      missing.push({ id: m.id, needs: m.needs, label: analyte(m.needs)?.label || m.needs, says: m.says });
    }
  }

  // Nivel global: el más severo de los patrones, elevado a rojo si hay alerta.
  let level = patterns.length ? patterns.reduce((worst, p) => (LEVEL_ORDER[p.level] < LEVEL_ORDER[worst] ? p.level : worst), 'verde') : 'amarillo';
  if (alerts.length) level = 'rojo';
  if (!patterns.length && !alerts.length && !Object.keys(lab?.results || {}).length) level = 'amarillo';

  return {
    level,
    levelLabel: LEVEL_LABEL[level],
    patterns,
    alerts,
    missing,
    flags,
    why,
    cutoffs,
    deltas,
    ruleset: { version: RULES.version, revised: RULES.revised },
    sources: RULES.sources,
  };
}

function trendReason(condition, deltas) {
  const d = deltas[condition.trend];
  if (!d) return null;
  return `${d.def.short}: ${d.previous} → ${d.value} ${d.def.displayUnit} (${d.pct > 0 ? '+' : ''}${d.pct}%)`;
}

export const LEVEL_LABEL = {
  verde: 'Estable',
  amarillo: 'Seguimiento recomendado',
  naranja: 'Alteración relevante',
  rojo: 'Atención médica prioritaria',
};

/** Preguntas para llevar a la consulta, sin repetir. */
export function questionsFor(interpretation) {
  const seen = new Set();
  const out = [];
  for (const p of interpretation.patterns) {
    for (const q of p.ask) {
      if (seen.has(q)) continue;
      seen.add(q);
      out.push({ text: q, from: p.title });
    }
  }
  for (const m of interpretation.missing) {
    const q = `¿Corresponde solicitar ${m.label} en el próximo control?`;
    if (!seen.has(q)) { seen.add(q); out.push({ text: q, from: 'Datos faltantes' }); }
  }
  return out;
}
