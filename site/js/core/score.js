/**
 * Índice de Recuperación del Hierro.
 *
 * Deliberadamente NO es "el nivel de hierro". Un solo número sobre un
 * metabolismo con varios compartimentos sería falso: se puede tener la
 * hemoglobina en rango y las reservas vacías al mismo tiempo, que es
 * exactamente el caso que este sistema existe para no pasar por alto.
 *
 * Por eso se calculan cinco ejes por separado, cada uno con su fórmula visible,
 * y el número global solo resume esos ejes para poder seguir su movimiento en el
 * tiempo. Sirve para mirar la evolución, no para diagnosticar.
 */

import { ferritinCutoff, hemoglobinCutoff, rules } from './rules.js';

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const r0 = (v) => Math.round(v);

/**
 * Curva por tramos: por debajo del umbral clínico el eje se mueve entre 0 y 50,
 * entre el umbral y el objetivo entre 50 y 80, y por encima del objetivo entre
 * 80 y 100. Así el salto visual coincide con el salto clínico.
 */
function piecewise(value, cutoff, target) {
  if (value == null) return null;
  if (value < cutoff) return clamp((value / cutoff) * 50);
  if (value < target) return clamp(50 + ((value - cutoff) / (target - cutoff)) * 30);
  return clamp(80 + ((value - target) / target) * 20);
}

export function axes({ lab, profile, ageMonths, interpretation, nutrition = null, adherence = null }) {
  const cfg = rules();
  const v = (id) => lab?.results?.[id]?.value ?? null;
  const out = {};

  // ---------------- Reservas ----------------
  const ferritina = v('ferritina');
  if (ferritina != null) {
    const cut = ferritinCutoff(ageMonths, interpretation?.flags?.inflamacion_presente);
    const target = Math.max(cfg.ferritin_cutoffs.target.min, cut.value + 5);
    out.reservas = {
      label: 'Reservas',
      score: r0(piecewise(ferritina, cut.value, target)),
      detail: `Ferritina ${ferritina} ng/mL frente al umbral de ${cut.value} y al objetivo de seguimiento de ${target} ng/mL.`,
      driver: 'ferritina',
    };
  }

  // ---------------- Disponibilidad ----------------
  const sat = v('sat_transferrina');
  const hierro = lab?.results?.hierro_serico;
  if (sat != null) {
    const low = cfg.generic_cutoffs.sat_transferrina.low;
    let score = piecewise(sat, low, low * 1.5);
    // El hierro sérico corrige un poco: la saturación sola oscila mucho.
    if (hierro?.value != null && hierro.labRange?.low) {
      const ratio = clamp((hierro.value / hierro.labRange.low) * 100, 0, 120);
      score = score * 0.75 + Math.min(100, ratio) * 0.25;
    }
    out.disponibilidad = {
      label: 'Disponibilidad',
      score: r0(score),
      detail: `Saturación de transferrina ${sat}% frente al mínimo de ${low}%`
        + (hierro?.value != null ? `, con hierro sérico ${hierro.value} µg/dL.` : '.'),
      driver: 'sat_transferrina',
    };
  }

  // ---------------- Hemograma ----------------
  const hb = v('hemoglobina');
  const hbCut = hemoglobinCutoff(profile, ageMonths);
  if (hb != null && hbCut) {
    let score = hb < hbCut.value
      ? clamp((hb / hbCut.value) * 60)
      : clamp(60 + ((hb - hbCut.value) / (hbCut.value * 0.25)) * 40);

    const notes = [`Hemoglobina ${hb} g/dL frente al punto de corte de ${hbCut.value} g/dL`];

    // La morfología descuenta: glóbulos pequeños o desiguales indican que la
    // hemoglobina normal se está sosteniendo con esfuerzo.
    const rdw = lab?.results?.rdw_cv;
    if (rdw?.value != null) {
      const high = rdw.labRange?.high ?? cfg.generic_cutoffs.rdw_cv.high;
      if (rdw.value > high) {
        const penalty = Math.min(20, ((rdw.value - high) / high) * 100 * 0.6);
        score -= penalty;
        notes.push(`descuento de ${r0(penalty)} puntos por RDW-CV ${rdw.value}% (sobre ${high}%)`);
      }
    }
    const vcm = lab?.results?.vcm;
    if (vcm?.value != null && vcm.labRange?.low && vcm.value < vcm.labRange.low) {
      const penalty = Math.min(15, ((vcm.labRange.low - vcm.value) / vcm.labRange.low) * 100);
      score -= penalty;
      notes.push(`descuento de ${r0(penalty)} puntos por VCM ${vcm.value} fL`);
    }

    out.hemograma = { label: 'Hemograma', score: r0(clamp(score)), detail: `${notes.join(', ')}.`, driver: 'hemoglobina' };
  }

  // ---------------- Nutrición ----------------
  if (nutrition && nutrition.absorbedMg != null && nutrition.requirementMg) {
    const pct = (nutrition.absorbedMg / nutrition.requirementMg) * 100;
    out.nutricion = {
      label: 'Nutrición',
      score: r0(clamp(pct)),
      detail: `El plan actual aporta ${nutrition.absorbedMg.toFixed(2)} mg de hierro absorbido al día frente a los ${nutrition.requirementMg.toFixed(2)} mg que necesita este perfil.`,
      driver: 'plan',
    };
  }

  // ---------------- Adherencia ----------------
  if (adherence && adherence.total > 0) {
    out.adherencia = {
      label: 'Adherencia',
      score: r0(clamp((adherence.done / adherence.total) * 100)),
      detail: `${adherence.done} de ${adherence.total} registros completados en el periodo.`,
      driver: 'registro',
    };
  }

  return out;
}

const WEIGHTS = { reservas: 0.30, disponibilidad: 0.30, hemograma: 0.25, nutricion: 0.10, adherencia: 0.05 };

/** Resume los ejes disponibles en un solo número, renormalizando los pesos. */
export function overall(axisMap) {
  const present = Object.entries(axisMap).filter(([, a]) => a && a.score != null);
  if (!present.length) return { value: null, basis: [], coverage: 0 };

  const totalWeight = present.reduce((acc, [k]) => acc + (WEIGHTS[k] || 0), 0);
  if (totalWeight === 0) return { value: null, basis: [], coverage: 0 };

  const value = present.reduce((acc, [k, a]) => acc + a.score * ((WEIGHTS[k] || 0) / totalWeight), 0);

  return {
    value: r0(value),
    coverage: r0((totalWeight / Object.values(WEIGHTS).reduce((a, b) => a + b, 0)) * 100),
    basis: present.map(([k, a]) => ({
      key: k,
      label: a.label,
      score: a.score,
      weight: r0(((WEIGHTS[k] || 0) / totalWeight) * 100),
      detail: a.detail,
    })),
  };
}

/** Serie histórica del índice, para graficar su evolución. */
export function history(labs, context) {
  return labs.map((lab, i) => {
    const map = axes({ ...context, lab, interpretation: context.interpretations?.[i] || null });
    const total = overall(map);
    return { date: lab.date, value: total.value, axes: map };
  }).filter((p) => p.value != null);
}
