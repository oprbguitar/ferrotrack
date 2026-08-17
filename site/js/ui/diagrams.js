/**
 * Diagramas editoriales en SVG.
 *
 * Reglas heredadas del sistema de diagramas de cathrynlavery/diagram-design:
 * todas las coordenadas, anchos y separaciones son múltiplos de 4; filete de
 * 1 px y nada de sombras; radio máximo de 10 px; un solo color de acento por
 * pieza, reservado para uno o dos elementos focales. Y la regla que más pesa:
 * cada nodo se tiene que ganar su lugar. Si un cuadro no cambia lo que la
 * persona entiende, se borra.
 *
 * Estos diagramas no son ilustración: leen el estado real del caso y colorean
 * según lo que dicen los datos.
 */

import { el } from './charts.js';

const HAIR = 'var(--hairline-strong)';
const INK = 'var(--ink)';
const INK2 = 'var(--ink-2)';
const INK3 = 'var(--ink-3)';
const SURFACE = 'var(--surface)';

const STATUS_COLOR = {
  bajo: 'var(--red)',
  alto: 'var(--amber)',
  normal: 'var(--green)',
  sin: 'var(--ink-3)',
};

/** Caja con filete, texto y valor. La unidad básica de todos los diagramas. */
function box({ x, y, w, h, title, value, unit, status = 'sin', focal = false }) {
  const g = el('g', {});
  const color = STATUS_COLOR[status] || STATUS_COLOR.sin;

  g.append(el('rect', {
    x, y, width: w, height: h, rx: 10,
    fill: focal ? 'var(--accent-soft)' : SURFACE,
    stroke: focal ? 'var(--accent)' : HAIR,
    'stroke-width': 1,
  }));

  g.append(el('text', {
    x: x + w / 2, y: y + 20, 'text-anchor': 'middle',
    'font-size': 11, 'font-weight': 700, fill: INK2,
    'letter-spacing': '.04em',
  }, title));

  if (value != null) {
    g.append(el('text', {
      x: x + w / 2, y: y + 44, 'text-anchor': 'middle',
      'font-size': 20, 'font-weight': 700, fill: color,
      'font-family': 'var(--mono)',
    }, value));
    if (unit) {
      g.append(el('text', {
        x: x + w / 2, y: y + 60, 'text-anchor': 'middle',
        'font-size': 10, fill: INK3,
      }, unit));
    }
  } else {
    g.append(el('text', {
      x: x + w / 2, y: y + 44, 'text-anchor': 'middle',
      'font-size': 13, fill: INK3,
    }, 'sin dato'));
  }

  return g;
}

function arrow({ x1, y1, x2, y2, dashed = false, color = HAIR, label = null }) {
  const g = el('g', {});
  g.append(el('line', {
    x1, y1, x2, y2, stroke: color, 'stroke-width': 1,
    'stroke-dasharray': dashed ? '4 4' : null,
    'marker-end': 'url(#ft-arrow)',
  }));
  if (label) {
    g.append(el('text', {
      x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6, 'text-anchor': 'middle',
      'font-size': 10, fill: INK3,
    }, label));
  }
  return g;
}

function defs() {
  const d = el('defs', {});
  const marker = el('marker', {
    id: 'ft-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4,
    markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
  });
  marker.append(el('path', { d: 'M0 0 L8 4 L0 8 z', fill: HAIR }));
  d.append(marker);
  return d;
}

function statusOf(result, def) {
  if (!result || result.value == null) return 'sin';
  const range = result.labRange;
  if (!range) return 'normal';
  if (range.low != null && result.value < range.low) return 'bajo';
  if (range.high != null && result.value > range.high) return 'alto';
  return 'normal';
}

/**
 * Mapa del hierro: cómo se conectan los compartimentos.
 *
 * Es la pieza que explica de un vistazo por qué mirar solo la hemoglobina
 * engaña: reservas, transporte y hematología son tres cosas distintas que se
 * mueven a distinta velocidad.
 */
export function ironMap(lab, { width = 720 } = {}) {
  const height = 452;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img' });
  svg.append(el('title', {}, 'Mapa del estado del hierro'));
  svg.append(defs());

  const r = (id) => lab?.results?.[id] || null;
  const val = (id, decimals = 1) => {
    const x = r(id);
    return x?.value == null ? null : String(+x.value.toFixed(decimals)).replace('.', ',');
  };

  const cx = width / 2;
  const boxW = 176;
  const boxH = 76;

  // --- Reservas, arriba y al centro: es donde empieza todo ---
  svg.append(box({
    x: cx - boxW / 2, y: 16, w: boxW, h: boxH,
    title: 'RESERVAS', value: val('ferritina'), unit: 'Ferritina · ng/mL',
    status: statusOf(r('ferritina')), focal: true,
  }));

  // --- Transporte a la izquierda, hematología a la derecha ---
  const sideY = 168;
  const leftX = cx - 296;
  const rightX = cx + 120;

  const transport = el('g', {});
  transport.append(el('rect', {
    x: leftX, y: sideY, width: boxW, height: 132, rx: 10,
    fill: SURFACE, stroke: HAIR, 'stroke-width': 1,
  }));
  transport.append(el('text', {
    x: leftX + boxW / 2, y: sideY + 20, 'text-anchor': 'middle',
    'font-size': 11, 'font-weight': 700, fill: INK2, 'letter-spacing': '.04em',
  }, 'TRANSPORTE'));
  [
    ['Saturación', val('sat_transferrina', 2), '%', statusOf(r('sat_transferrina'))],
    ['Hierro sérico', val('hierro_serico', 1), 'µg/dL', statusOf(r('hierro_serico'))],
    ['Transferrina', val('transferrina', 0), 'mg/dL', statusOf(r('transferrina'))],
  ].forEach(([name, value, unit, status], i) => {
    const y = sideY + 44 + i * 28;
    transport.append(el('text', { x: leftX + 16, y, 'font-size': 11, fill: INK3 }, name));
    transport.append(el('text', {
      x: leftX + boxW - 16, y, 'text-anchor': 'end',
      'font-size': 12, 'font-weight': 700, fill: STATUS_COLOR[status],
      'font-family': 'var(--mono)',
    }, value == null ? '—' : `${value} ${unit}`));
  });
  svg.append(transport);

  const hema = el('g', {});
  hema.append(el('rect', {
    x: rightX, y: sideY, width: boxW, height: 132, rx: 10,
    fill: SURFACE, stroke: HAIR, 'stroke-width': 1,
  }));
  hema.append(el('text', {
    x: rightX + boxW / 2, y: sideY + 20, 'text-anchor': 'middle',
    'font-size': 11, 'font-weight': 700, fill: INK2, 'letter-spacing': '.04em',
  }, 'HEMATOLOGÍA'));
  [
    ['Hemoglobina', val('hemoglobina', 1), 'g/dL', statusOf(r('hemoglobina'))],
    ['VCM', val('vcm', 1), 'fL', statusOf(r('vcm'))],
    ['RDW-CV', val('rdw_cv', 1), '%', statusOf(r('rdw_cv'))],
  ].forEach(([name, value, unit, status], i) => {
    const y = sideY + 44 + i * 28;
    hema.append(el('text', { x: rightX + 16, y, 'font-size': 11, fill: INK3 }, name));
    hema.append(el('text', {
      x: rightX + boxW - 16, y, 'text-anchor': 'end',
      'font-size': 12, 'font-weight': 700, fill: STATUS_COLOR[status],
      'font-family': 'var(--mono)',
    }, value == null ? '—' : `${value} ${unit}`));
  });
  svg.append(hema);

  // --- Cofactores abajo ---
  const cofY = 348;
  const cof = el('g', {});
  cof.append(el('rect', {
    x: cx - boxW / 2, y: cofY, width: boxW, height: 84, rx: 10,
    fill: SURFACE, stroke: HAIR, 'stroke-width': 1,
  }));
  cof.append(el('text', {
    x: cx, y: cofY + 20, 'text-anchor': 'middle',
    'font-size': 11, 'font-weight': 700, fill: INK2, 'letter-spacing': '.04em',
  }, 'COFACTORES'));
  [
    ['B12', val('vitamina_b12', 0), 'pg/mL', statusOf(r('vitamina_b12'))],
    ['Folato', val('acido_folico', 1), 'ng/mL', statusOf(r('acido_folico'))],
  ].forEach(([name, value, unit, status], i) => {
    const y = cofY + 44 + i * 24;
    cof.append(el('text', { x: cx - boxW / 2 + 16, y, 'font-size': 11, fill: INK3 }, name));
    cof.append(el('text', {
      x: cx + boxW / 2 - 16, y, 'text-anchor': 'end',
      'font-size': 12, 'font-weight': 700, fill: STATUS_COLOR[status],
      'font-family': 'var(--mono)',
    }, value == null ? '—' : `${value} ${unit}`));
  });
  svg.append(cof);

  // --- Conexiones ---
  svg.append(arrow({ x1: cx - 28, y1: 96, x2: leftX + boxW, y2: sideY + 8, label: 'sale al transporte' }));
  svg.append(arrow({ x1: leftX + boxW + 8, y1: sideY + 66, x2: rightX - 8, y2: sideY + 66, label: 'alimenta la producción' }));
  svg.append(arrow({ x1: cx, y1: cofY - 8, x2: cx + 96, y2: sideY + 140, dashed: true, label: 'habilitan' }));

  // Nota al pie: la única frase del diagrama, y la que justifica su existencia.
  svg.append(el('text', {
    x: cx, y: height - 4, 'text-anchor': 'middle', 'font-size': 11, fill: INK3,
  }, 'Las reservas se vacían mucho antes de que la hemoglobina se mueva.'));

  return svg;
}

/**
 * Recorrido de un informe desde el PDF hasta el historial.
 * Sirve para que se vea dónde ocurre la anonimización: antes de todo lo demás.
 */
export function pipelineDiagram({ width = 720 } = {}) {
  const steps = [
    ['Informe', 'PDF, foto o texto'],
    ['Anonimización', 'se remueven los datos personales'],
    ['Extracción', 'se leen los analitos'],
    ['LOINC + UCUM', 'código y unidad canónica'],
    ['Validación', 'la persona confirma'],
    ['Historial', 'línea de tiempo del caso'],
  ];

  const boxW = 148;
  const boxH = 56;
  const gapY = 20;
  const height = steps.length * (boxH + gapY) + 16;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img' });
  svg.append(el('title', {}, 'Recorrido de un informe de laboratorio dentro del sistema'));
  svg.append(defs());

  const x = 24;
  steps.forEach(([title, sub], i) => {
    const y = 8 + i * (boxH + gapY);
    const focal = i === 1; // la anonimización es el nodo que importa
    svg.append(el('rect', {
      x, y, width: boxW, height: boxH, rx: 10,
      fill: focal ? 'var(--accent-soft)' : SURFACE,
      stroke: focal ? 'var(--accent)' : HAIR, 'stroke-width': 1,
    }));
    svg.append(el('text', {
      x: x + boxW / 2, y: y + 24, 'text-anchor': 'middle',
      'font-size': 13, 'font-weight': 700, fill: focal ? 'var(--accent)' : INK,
    }, title));
    svg.append(el('text', {
      x: x + boxW / 2, y: y + 42, 'text-anchor': 'middle',
      'font-size': 10, fill: INK3,
    }, sub));

    if (i < steps.length - 1) {
      svg.append(arrow({ x1: x + boxW / 2, y1: y + boxH + 2, x2: x + boxW / 2, y2: y + boxH + gapY - 4 }));
    }

    // Anotación a la derecha del nodo focal.
    if (focal) {
      svg.append(el('line', {
        x1: x + boxW + 8, y1: y + boxH / 2, x2: x + boxW + 40, y2: y + boxH / 2,
        stroke: 'var(--accent)', 'stroke-width': 1,
      }));
      svg.append(el('text', {
        x: x + boxW + 48, y: y + boxH / 2 - 4, 'font-size': 12, 'font-weight': 700, fill: 'var(--accent)',
      }, 'Nada pasa de aquí sin anonimizar.'));
      svg.append(el('text', {
        x: x + boxW + 48, y: y + boxH / 2 + 12, 'font-size': 11, fill: INK3,
      }, 'Nombre, documento, teléfono y dirección se remueven antes'));
      svg.append(el('text', {
        x: x + boxW + 48, y: y + boxH / 2 + 26, 'font-size': 11, fill: INK3,
      }, 'de que el lector de resultados vea el texto.'));
    }
  });

  return svg;
}

/** El día completo en una regla de tiempo: colegio, recreos y comidas. */
export function dayTimeline({ slots, schedule, width = 720 }) {
  // Las etiquetas se alternan arriba y abajo del eje; la altura y las bandas
  // están calculadas para que ninguna pise a la franja del colegio.
  const height = 188;
  const AXIS = 112;
  const BAND_TOP = 60;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img' });
  svg.append(el('title', {}, 'Distribución de las comidas en el día'));

  const pad = 32;
  const trackW = width - pad * 2;
  const startMin = 5 * 60;   // 05:00
  const endMin = 23 * 60;    // 23:00
  const toX = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const t = Math.max(startMin, Math.min(endMin, h * 60 + m));
    return pad + ((t - startMin) / (endMin - startMin)) * trackW;
  };

  // Franja del colegio: el bloque que condiciona todo el resto del día.
  if (schedule?.school?.enabled) {
    const x1 = toX(schedule.school.start);
    const x2 = toX(schedule.school.end);
    svg.append(el('rect', {
      x: x1, y: BAND_TOP, width: Math.max(4, x2 - x1), height: 28, rx: 8,
      fill: 'var(--accent)', opacity: 0.10,
    }));
    svg.append(el('text', {
      x: (x1 + x2) / 2, y: BAND_TOP + 18, 'text-anchor': 'middle',
      'font-size': 11, 'font-weight': 700, fill: 'var(--accent)',
    }, 'COLEGIO'));
  }

  // Eje horario.
  svg.append(el('line', { x1: pad, y1: AXIS, x2: width - pad, y2: AXIS, stroke: HAIR, 'stroke-width': 1 }));
  for (let hour = 6; hour <= 22; hour += 2) {
    const x = toX(`${String(hour).padStart(2, '0')}:00`);
    svg.append(el('line', { x1: x, y1: AXIS - 4, x2: x, y2: AXIS + 4, stroke: HAIR, 'stroke-width': 1 }));
    svg.append(el('text', { x, y: AXIS + 20, 'text-anchor': 'middle', 'font-size': 10, fill: INK3 }, `${hour}h`));
  }

  // Cada comida como una marca proporcional a su peso en el aporte del día.
  slots.forEach((slot, i) => {
    const x = toX(slot.time);
    const size = 8 + slot.weight * 40;
    const color = slot.portable ? 'var(--amber)' : 'var(--blood)';
    const above = i % 2 === 0;

    // La guía sale del punto hacia el lado donde está su etiqueta, no siempre
    // hacia arriba: así nunca cruza la franja del colegio.
    svg.append(el('line', {
      x1: x, y1: AXIS + (above ? -size / 2 : size / 2),
      x2: x, y2: above ? 40 : 152,
      stroke: color, 'stroke-width': 1, opacity: 0.45,
    }));
    svg.append(el('circle', { cx: x, cy: AXIS, r: size / 2, fill: color, opacity: 0.9 }));
    svg.append(el('title', {}, `${slot.label} · ${slot.time} · ${Math.round(slot.weight * 100)} % del aporte del día`));

    svg.append(el('text', {
      x, y: above ? 20 : 166, 'text-anchor': 'middle',
      'font-size': 11, 'font-weight': 700, fill: INK,
    }, slot.label));
    svg.append(el('text', {
      x, y: above ? 34 : 180, 'text-anchor': 'middle',
      'font-size': 10, fill: INK3, 'font-family': 'var(--mono)',
    }, slot.time));
  });

  return svg;
}

/** Los cinco ejes del índice, cada uno con su barra. Sin adornos. */
export function axesDiagram(axisMap, { width = 340 } = {}) {
  const entries = Object.entries(axisMap);
  const rowH = 40;
  const height = entries.length * rowH + 8;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img' });

  const labelW = 120;
  const trackW = width - labelW - 48;

  entries.forEach(([key, axis], i) => {
    const y = i * rowH + 12;
    const color = axis.score >= 70 ? 'var(--green)' : axis.score >= 40 ? 'var(--amber)' : 'var(--red)';

    svg.append(el('text', { x: 0, y: y + 12, 'font-size': 12, fill: INK2 }, axis.label));
    svg.append(el('rect', { x: labelW, y: y + 2, width: trackW, height: 8, rx: 4, fill: HAIR, opacity: 0.5 }));

    const w = Math.max(2, (axis.score / 100) * trackW);
    const bar = el('rect', { x: labelW, y: y + 2, width: 0, height: 8, rx: 4, fill: color });
    svg.append(bar);
    requestAnimationFrame(() => {
      bar.style.transition = `width .7s cubic-bezier(.3,.7,.3,1) ${i * 80}ms`;
      bar.setAttribute('width', String(w));
    });

    svg.append(el('text', {
      x: width, y: y + 12, 'text-anchor': 'end',
      'font-size': 12, 'font-weight': 700, fill: color, 'font-family': 'var(--mono)',
    }, `${axis.score}%`));

    svg.append(el('title', {}, `${axis.label}: ${axis.detail}`));
    void key;
  });

  return svg;
}

/**
 * El personaje: una gota de sangre. Se dibuja en SVG para que escale y cambie
 * de expresión según cómo va el caso.
 */
export function bloodDrop({ size = 96, mood = 'feliz' } = {}) {
  const svg = el('svg', { viewBox: '0 0 96 112', width: size, height: size * (112 / 96), 'aria-hidden': 'true' });
  const g = el('g', {});

  // Cuerpo: gota clásica, punta arriba.
  g.append(el('path', {
    d: 'M48 6 C48 6 14 48 14 70 a34 34 0 0 0 68 0 C82 48 48 6 48 6 Z',
    fill: 'var(--blood)',
  }));
  // Brillo.
  g.append(el('ellipse', { cx: 34, cy: 62, rx: 8, ry: 12, fill: '#fff', opacity: 0.22 }));

  // Ojos.
  const eyeY = mood === 'triste' ? 70 : 68;
  g.append(el('circle', { cx: 37, cy: eyeY, r: 5, fill: '#22131a' }));
  g.append(el('circle', { cx: 59, cy: eyeY, r: 5, fill: '#22131a' }));
  g.append(el('circle', { cx: 38.6, cy: eyeY - 1.6, r: 1.6, fill: '#fff' }));
  g.append(el('circle', { cx: 60.6, cy: eyeY - 1.6, r: 1.6, fill: '#fff' }));

  // Boca, según el ánimo.
  const mouths = {
    feliz: 'M40 82 Q48 90 56 82',
    celebra: 'M39 80 Q48 94 57 80 Z',
    animo: 'M40 84 Q48 88 56 84',
    triste: 'M40 88 Q48 81 56 88',
    pensativo: 'M41 85 L55 85',
  };
  g.append(el('path', {
    d: mouths[mood] || mouths.feliz,
    fill: mood === 'celebra' ? '#7d1f2c' : 'none',
    stroke: '#22131a', 'stroke-width': 2.5, 'stroke-linecap': 'round',
  }));

  // Brazos y piernas: dos trazos, nada más.
  g.append(el('path', {
    d: mood === 'celebra' ? 'M16 66 L4 50 M80 66 L92 50' : 'M15 74 L3 82 M81 74 L93 82',
    stroke: '#22131a', 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none',
  }));
  g.append(el('path', {
    d: 'M38 102 L34 110 M58 102 L62 110',
    stroke: '#22131a', 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none',
  }));

  svg.append(g);
  return svg;
}
