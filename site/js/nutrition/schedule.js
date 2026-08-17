/**
 * Horario del día y momentos de comida.
 *
 * Todo es configurable: hora de entrada y salida del colegio, cuántos recreos
 * hay y cuánto duran, y a qué hora cae cada comida. El resto del sistema se
 * adapta solo a lo que diga este horario: si el día escolar es largo aparece una
 * comida más, si el desayuno es en modo ayuno la primera comida se corre al
 * primer recreo, y si dos comidas quedan muy juntas se reparte la carga.
 */

export const DEFAULT_SCHEDULE = {
  school: {
    enabled: true,
    start: '07:20',
    end: '14:45',
    days: [1, 2, 3, 4, 5], // lunes a viernes
    travelMinutes: 25,     // tiempo de traslado antes de entrar
  },
  breaks: [
    { id: 'recreo1', label: 'Primer recreo', start: '09:30', minutes: 15 },
    { id: 'recreo2', label: 'Segundo recreo', start: '11:45', minutes: 15 },
  ],
  meals: {
    desayuno: { label: 'Desayuno', time: '06:35', minutes: 15, mode: 'rapido', enabled: true },
    almuerzo: { label: 'Almuerzo', time: '15:30', minutes: 40, mode: 'completo', enabled: true },
    merienda: { label: 'Entre comida', time: '18:15', minutes: 15, mode: 'rapido', enabled: true },
    cena: { label: 'Cena', time: '20:30', minutes: 30, mode: 'completo', enabled: true },
  },
  // 'rapido'  = desayuno corto antes de salir
  // 'ayuno'   = no se desayuna en casa; la primera comida es el primer recreo
  // 'completo'= hay tiempo para cocinar en la mañana
  breakfastMode: 'rapido',
  wakeUp: '06:20',
  bedTime: '22:00',
};

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

const toClock = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const clock = { toMinutes, toClock };

/** Formato legible en 12 horas, como se lee un horario escolar. */
export function pretty(hhmm) {
  const total = toMinutes(hhmm);
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? 'a. m.' : 'p. m.';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Construye la lista ordenada de momentos de comida a partir del horario.
 * Cada momento declara cuánto tiempo hay, si tiene que ser portátil (lonchera),
 * y qué peso debería tener en el aporte de hierro del día.
 */
export function deriveSlots(schedule = DEFAULT_SCHEDULE) {
  const s = { ...DEFAULT_SCHEDULE, ...schedule };
  const meals = { ...DEFAULT_SCHEDULE.meals, ...(schedule.meals || {}) };
  const school = { ...DEFAULT_SCHEDULE.school, ...(schedule.school || {}) };
  const breaks = schedule.breaks || DEFAULT_SCHEDULE.breaks;

  const slots = [];
  const fasting = s.breakfastMode === 'ayuno';

  // ---- Desayuno ----
  if (meals.desayuno?.enabled && !fasting) {
    const latest = school.enabled ? toMinutes(school.start) - school.travelMinutes - (meals.desayuno.minutes || 15) : null;
    let time = toMinutes(meals.desayuno.time);
    let warning = null;
    if (latest != null && time > latest) {
      time = latest;
      warning = `Con entrada ${pretty(school.start)} y ${school.travelMinutes} min de traslado, el desayuno tiene que empezar a las ${pretty(toClock(latest))} como máximo.`;
    }
    slots.push({
      id: 'desayuno',
      label: meals.desayuno.label,
      time: toClock(time),
      minutes: meals.desayuno.minutes || 15,
      portable: false,
      quick: s.breakfastMode === 'rapido',
      tag: 'desayuno',
      weight: s.breakfastMode === 'rapido' ? 0.18 : 0.25,
      warning,
      note: s.breakfastMode === 'rapido'
        ? 'Modo rápido: solo preparaciones que se arman en pocos minutos.'
        : 'Hay tiempo para cocinar.',
    });
  }

  // ---- Recreos ----
  breaks.forEach((br, i) => {
    const isFirst = i === 0;
    slots.push({
      id: br.id || `recreo${i + 1}`,
      label: br.label || `Recreo ${i + 1}`,
      time: br.start,
      minutes: br.minutes || 15,
      portable: true,   // tiene que caber en la lonchera y comerse con la mano
      quick: true,
      tag: fasting && isFirst ? 'desayuno' : 'recreo',
      weight: fasting && isFirst ? 0.22 : 0.10,
      note: fasting && isFirst
        ? 'Primera comida del día: en modo ayuno esta es la que rompe el ayuno, así que carga más que un recreo normal.'
        : `${br.minutes || 15} minutos, de pie y sin cubiertos: tiene que ser algo que se coma rápido.`,
    });
  });

  // ---- Almuerzo ----
  if (meals.almuerzo?.enabled) {
    let time = toMinutes(meals.almuerzo.time);
    let warning = null;
    if (school.enabled && time < toMinutes(school.end) + 15) {
      warning = `El almuerzo cae antes de salir del colegio (${pretty(school.end)}). Conviene moverlo o marcarlo como lonchera.`;
    }
    slots.push({
      id: 'almuerzo',
      label: meals.almuerzo.label,
      time: toClock(time),
      minutes: meals.almuerzo.minutes || 40,
      portable: false,
      quick: false,
      tag: 'almuerzo',
      weight: 0.36,
      warning,
      note: 'La comida principal del día y la que más puede aportar en hierro absorbido.',
    });
  }

  // ---- Entre comida ----
  if (meals.merienda?.enabled) {
    slots.push({
      id: 'merienda',
      label: meals.merienda.label,
      time: meals.merienda.time,
      minutes: meals.merienda.minutes || 15,
      portable: false,
      quick: true,
      tag: 'merienda',
      weight: 0.10,
      note: 'Buen momento para los lácteos, el té o el café: lejos de las comidas con hierro no compiten con nada.',
      preferInhibitors: true,
    });
  }

  // ---- Cena ----
  if (meals.cena?.enabled) {
    slots.push({
      id: 'cena',
      label: meals.cena.label,
      time: meals.cena.time,
      minutes: meals.cena.minutes || 30,
      portable: false,
      quick: false,
      tag: 'cena',
      weight: 0.24,
      note: 'Segunda oportunidad del día para sumar hierro bien combinado.',
    });
  }

  slots.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));

  // ---- Adaptaciones automáticas ----
  const adaptations = [];

  // Hueco largo: si entre dos comidas pasan más de 5 horas despiertos, avisa.
  for (let i = 0; i < slots.length - 1; i += 1) {
    const gap = toMinutes(slots[i + 1].time) - toMinutes(slots[i].time);
    if (gap > 300) {
      adaptations.push({
        kind: 'hueco',
        text: `Hay ${Math.floor(gap / 60)} h ${gap % 60} min entre ${slots[i].label} y ${slots[i + 1].label}. Es un tramo largo: conviene reforzar el momento anterior o sumar algo intermedio.`,
      });
    }
  }

  // Si el almuerzo cae muy tarde, la cena debe ser más liviana.
  const lunch = slots.find((x) => x.id === 'almuerzo');
  const dinner = slots.find((x) => x.id === 'cena');
  if (lunch && dinner && toMinutes(dinner.time) - toMinutes(lunch.time) < 240) {
    dinner.weight = 0.16;
    lunch.weight += 0.08;
    adaptations.push({
      kind: 'reparto',
      text: `Entre almuerzo (${pretty(lunch.time)}) y cena (${pretty(dinner.time)}) hay menos de 4 horas, así que el plan carga más el almuerzo y aliviana la cena.`,
    });
  }

  // Jornada escolar larga sin recreos suficientes.
  if (school.enabled) {
    const schoolHours = (toMinutes(school.end) - toMinutes(school.start)) / 60;
    if (schoolHours > 6 && breaks.length < 2) {
      adaptations.push({
        kind: 'recreos',
        text: `La jornada dura ${schoolHours.toFixed(1)} h con un solo recreo. Vale la pena que la lonchera de ese recreo sea más sustanciosa.`,
      });
      const only = slots.find((x) => x.tag === 'recreo');
      if (only) only.weight = 0.18;
    }
  }

  // Normaliza los pesos para que sumen 1.
  const total = slots.reduce((acc, x) => acc + x.weight, 0);
  slots.forEach((x) => { x.weight = +(x.weight / total).toFixed(4); });

  return { slots, adaptations, schedule: { ...s, school, meals, breaks } };
}

/** Descripción corta del día, para mostrar arriba del plan. */
export function summarize(schedule = DEFAULT_SCHEDULE) {
  const { slots, schedule: s } = deriveSlots(schedule);
  const parts = [];
  if (s.school.enabled) {
    parts.push(`Colegio de ${pretty(s.school.start)} a ${pretty(s.school.end)}`);
    parts.push(`${s.breaks.length} ${s.breaks.length === 1 ? 'recreo' : 'recreos'} de ${s.breaks.map((b) => b.minutes).join(' y ')} min`);
  }
  parts.push(`${slots.length} momentos de comida`);
  if (s.breakfastMode === 'ayuno') parts.push('desayuno en modo ayuno');
  return parts.join(' · ');
}
