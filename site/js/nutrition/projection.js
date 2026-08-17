/**
 * Necesidades de hierro y proyección a corto, mediano y largo plazo.
 *
 * Responde a la pregunta que casi nadie contesta: si como así todos los días,
 * ¿qué pasa en dos semanas, en dos meses y en seis meses? Y sobre todo, ¿cómo
 * me voy a sentir?
 *
 * Todo lo que sale de aquí son estimaciones. La velocidad real de recuperación
 * depende de la causa del déficit, de si hay pérdidas activas y del tratamiento
 * que indique el profesional. Sirve para entender el orden de magnitud del
 * esfuerzo, no para reemplazar un control de laboratorio.
 */

/** Pérdidas basales de hierro por día, en mg, sin contar menstruación. */
function basalLosses(profile) {
  const { ageYears, weightKg } = profile;
  const weight = weightKg || estimateWeight(profile);
  // ~0.014 mg/kg/día en adultos; algo más en crecimiento.
  const growth = ageYears != null && ageYears < 18 ? 0.25 : 0;
  return +(weight * 0.014 + growth).toFixed(3);
}

function estimateWeight(profile) {
  if (profile.weightKg) return profile.weightKg;
  const a = profile.ageYears;
  if (a == null) return 60;
  if (a < 1) return 8;
  if (a < 18) return Math.round(2.5 * a + 8); // aproximación pediátrica
  return profile.sex === 'male' ? 70 : 60;
}

/** Pérdida diaria promedio por menstruación, en mg de hierro. */
function menstrualLosses(profile) {
  if (!profile.menstruates) return 0;
  const byFlow = { ligero: 0.25, moderado: 0.45, abundante: 0.9 };
  return byFlow[profile.menstrualFlow] ?? 0.45;
}

/**
 * Hierro absorbido que este perfil necesita por día solo para no perder terreno.
 */
export function maintenanceRequirement(profile) {
  const basal = basalLosses(profile);
  const menstrual = menstrualLosses(profile);
  const pregnancy = profile.pregnant ? 2.7 : 0;
  return {
    basal,
    menstrual,
    pregnancy,
    total: +(basal + menstrual + pregnancy).toFixed(3),
    explain: [
      `Pérdidas basales estimadas: ${basal} mg/día`,
      menstrual ? `Pérdida menstrual promediada: ${menstrual} mg/día` : null,
      pregnancy ? `Demanda adicional de la gestación: ${pregnancy} mg/día` : null,
    ].filter(Boolean),
  };
}

/**
 * Déficit total de hierro del organismo, en mg (fórmula de Ganzoni, de uso
 * clínico habitual para estimar la dosis total de reposición).
 *
 *   déficit = peso × (Hb objetivo − Hb actual) × 2.4 + hierro de depósito
 */
export function ironDeficit({ profile, hemoglobin, hemoglobinTarget, ferritin, ferritinTarget = 30 }) {
  const weight = estimateWeight(profile);
  const storeTarget = weight < 35 ? 15 * weight : 500;

  let hbGap = 0;
  if (hemoglobin != null && hemoglobinTarget != null && hemoglobin < hemoglobinTarget) {
    hbGap = weight * (hemoglobinTarget - hemoglobin) * 2.4;
  }

  // Fracción de depósito que falta, estimada desde la ferritina.
  let storeGap = storeTarget;
  if (ferritin != null && ferritinTarget > 0) {
    storeGap = storeTarget * Math.max(0, 1 - ferritin / ferritinTarget);
  }

  return {
    weightKg: weight,
    hemoglobinDeficitMg: Math.round(hbGap),
    storeDeficitMg: Math.round(storeGap),
    totalMg: Math.round(hbGap + storeGap),
    note: 'Estimación por fórmula de Ganzoni. Es el hierro que faltaría acumular en total, no una dosis a tomar.',
  };
}

const HORIZONS = [
  { key: 'corto', days: 14, label: 'Corto plazo', sub: '2 semanas' },
  { key: 'mediano', days: 60, label: 'Mediano plazo', sub: '2 meses' },
  { key: 'largo', days: 180, label: 'Largo plazo', sub: '6 meses' },
];

/**
 * Proyecta qué ocurre si se sostiene un plan que aporta `absorbedPerDay` mg de
 * hierro absorbido al día.
 */
export function project({ profile, absorbedPerDay, hemoglobin, hemoglobinTarget, ferritin, ferritinTarget = 30 }) {
  const need = maintenanceRequirement(profile);
  const surplus = +(absorbedPerDay - need.total).toFixed(3);
  const deficit = ironDeficit({ profile, hemoglobin, hemoglobinTarget, ferritin, ferritinTarget });
  const weight = deficit.weightKg;

  const horizons = HORIZONS.map((h) => {
    // Una vez cubierto el déficit el intestino baja su eficiencia y el excedente
    // deja de acumularse: por eso la proyección se detiene ahí en lugar de
    // seguir subiendo en línea recta.
    const raw = surplus * h.days;
    const accumulated = surplus > 0 ? Math.min(raw, deficit.totalMg) : raw;
    const capped = surplus > 0 && raw > deficit.totalMg;

    // Reparto fisiológico: primero se repone la hemoglobina, después el depósito.
    const toHb = Math.max(0, Math.min(accumulated, deficit.hemoglobinDeficitMg));
    const toStores = Math.max(0, accumulated - toHb);

    // 2.4 mg de hierro por cada g/dL de hemoglobina y kg de peso.
    const hbGain = weight > 0 ? toHb / (weight * 2.4) : 0;
    // Aproximadamente 8-10 mg de hierro de depósito por cada ng/mL de ferritina
    // en una persona de talla media; se escala por peso.
    const mgPerFerritinPoint = Math.max(4, (weight / 60) * 8);
    const ferritinGain = toStores / mgPerFerritinPoint;

    const projectedHb = hemoglobin != null ? +(hemoglobin + hbGain).toFixed(2) : null;
    const projectedFerritin = ferritin != null ? +(ferritin + ferritinGain).toFixed(1) : null;

    return {
      ...h,
      accumulatedMg: +accumulated.toFixed(1),
      capped,
      hemoglobin: projectedHb,
      hemoglobinGain: +hbGain.toFixed(2),
      ferritin: projectedFerritin,
      ferritinGain: +ferritinGain.toFixed(1),
      // Rango honesto: la absorción real varía bastante día a día.
      range: {
        ferritin: projectedFerritin == null ? null : [
          +(ferritin + ferritinGain * 0.6).toFixed(1),
          +(ferritin + ferritinGain * 1.4).toFixed(1),
        ],
      },
      feeling: feelingAt(h.key, surplus, projectedHb, hemoglobinTarget, projectedFerritin, ferritinTarget),
    };
  });

  let monthsToRepletion = null;
  if (surplus > 0.02 && deficit.totalMg > 0) {
    monthsToRepletion = +(deficit.totalMg / (surplus * 30.44)).toFixed(1);
    if (monthsToRepletion > 48) monthsToRepletion = null;
  }

  return {
    requirement: need,
    absorbedPerDay: +absorbedPerDay.toFixed(3),
    surplus,
    sufficient: surplus > 0,
    deficit,
    horizons,
    monthsToRepletion,
    verdict: verdict(surplus, need.total, absorbedPerDay),
  };
}

function verdict(surplus, requirement, absorbed) {
  const ratio = requirement > 0 ? absorbed / requirement : 1;
  if (surplus <= 0) {
    return {
      tone: 'insuficiente',
      text: `Este plan cubre alrededor del ${Math.round(ratio * 100)} % de lo que el cuerpo pierde cada día. Con este aporte las reservas no suben: se mantienen o siguen bajando.`,
    };
  }
  if (ratio < 1.4) {
    return {
      tone: 'justo',
      text: `El plan cubre las pérdidas y deja un margen pequeño (${surplus.toFixed(2)} mg/día). La recuperación es posible, pero lenta.`,
    };
  }
  if (ratio < 2.5) {
    return {
      tone: 'bueno',
      text: `El plan deja un excedente de ${surplus.toFixed(2)} mg/día para reponer reservas. Es un ritmo sostenible.`,
    };
  }
  return {
    tone: 'muy_bueno',
    text: `El plan deja un excedente amplio de ${surplus.toFixed(2)} mg/día. Es un buen techo, difícil de sostener todos los días: si se cumple aunque sea a medias, ya alcanza para recuperar reservas.`,
  };
}

/**
 * Traduce los números a experiencia. Es lo que la gente realmente quiere saber.
 * Las descripciones son cualitativas y prudentes: nadie puede prometer cómo se
 * va a sentir otra persona.
 */
function feelingAt(horizon, surplus, hb, hbTarget, ferritin, ferritinTarget) {
  if (surplus <= 0) {
    return {
      icon: '😐',
      title: 'Probablemente igual que hoy',
      text: 'Si el aporte no supera lo que se pierde, el cansancio y la falta de concentración tienden a quedarse donde están.',
    };
  }

  const hbOk = hb == null || hbTarget == null || hb >= hbTarget;
  const storesOk = ferritin == null || ferritin >= ferritinTarget;

  if (horizon === 'corto') {
    return {
      icon: '🌱',
      title: 'Todavía sin cambios notorios',
      text: 'En dos semanas la médula ya empezó a fabricar glóbulos rojos nuevos, pero el cuerpo aún no lo nota. Es la etapa en la que hay que confiar en el proceso: los análisis cambian antes que las sensaciones.',
    };
  }

  if (horizon === 'mediano') {
    if (hbOk && !storesOk) {
      return {
        icon: '🙂',
        title: 'Con más energía, pero sin colchón',
        text: 'Suele ser el momento en que vuelve la energía para el día normal: menos sueño en clase, mejor concentración. Las reservas todavía están bajas, así que un resfrío o unos días de mala alimentación se sienten rápido.',
      };
    }
    return {
      icon: '🙂',
      title: 'Empieza a notarse',
      text: 'Alrededor de los dos meses aparecen los primeros cambios perceptibles: menos cansancio al subir escaleras, mejor ánimo, menos dolor de cabeza al final del día.',
    };
  }

  if (hbOk && storesOk) {
    return {
      icon: '💪',
      title: 'Con reservas otra vez',
      text: 'A los seis meses de aporte sostenido lo esperable es tener la energía del día resuelta y además un colchón guardado. Es el punto en que se puede correr en el recreo sin quedarse sin aire y aguantar una semana de exámenes.',
    };
  }
  return {
    icon: '📈',
    title: 'En camino, aún sin llegar',
    text: 'A este ritmo la mejoría es real pero el depósito todavía no se llena. Conviene revisar con el profesional si conviene reforzar el plan.',
  };
}

/** Qué aportaría un solo plato, expresado en días de necesidad cubierta. */
export function mealContribution(absorbedMg, profile) {
  const need = maintenanceRequirement(profile);
  const pct = need.total > 0 ? (absorbedMg / need.total) * 100 : 0;
  return {
    mg: +absorbedMg.toFixed(2),
    pctOfDailyNeed: Math.round(pct),
    text: pct >= 100
      ? `Este plato solo cubre el ${Math.round(pct)} % de la necesidad diaria de hierro absorbido.`
      : `Este plato aporta el ${Math.round(pct)} % de la necesidad diaria de hierro absorbido.`,
  };
}
