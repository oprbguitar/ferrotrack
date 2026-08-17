/** Vistas de entrada de datos y configuración: subir análisis, perfil y ajustes. */

import { h, card, field, num, download } from '../ui/dom.js';
import { pipelineDiagram } from '../ui/diagrams.js';
import { parseLabText, normalizeManual, dictionary, analyte } from '../core/parser.js';
import { anonymizeText } from '../core/anonymize.js';
import { formatDate } from '../core/longitudinal.js';
import { refreshStatus, refreshFromLive } from '../nutrition/live.js';

// =====================================================================
// SUBIR ANÁLISIS
// =====================================================================

export function subir(ctx) {
  const container = h('div', { class: 'stack' });
  let parsed = null;
  let mode = 'pegar';

  const render = () => {
    container.replaceChildren(
      card('Subir un nuevo análisis', [
        h('div', { class: 'chips', style: 'margin-bottom:16px' }, [
          ['pegar', 'Pegar el texto del informe'],
          ['manual', 'Escribir los valores a mano'],
        ].map(([value, label]) => h('button', {
          class: 'chip', 'aria-pressed': String(mode === value),
          onclick: () => { mode = value; parsed = null; render(); }, text: label,
        }))),

        h('div', { class: 'notice notice-info' }, [
          h('span', { class: 'ico', text: '🔒' }),
          h('div', { class: 'small' }, [
            h('b', { text: 'Nada de esto sale de tu navegador' }),
            'El texto se procesa aquí mismo, se le quitan los datos personales y solo se guardan los resultados numéricos. No hay servidor al que enviar nada.',
          ]),
        ]),

        mode === 'pegar' ? pasteForm() : manualForm(ctx),
      ]),
      parsed ? confirmCard(parsed, ctx) : null,
      card('Qué le pasa a tu informe', [
        h('div', { class: 'diagram' }, [pipelineDiagram()]),
      ]),
    );
  };

  function pasteForm() {
    let textarea;
    return h('div', {}, [
      h('div', { class: 'field' }, [
        h('label', { text: 'Texto del informe' }),
        (textarea = h('textarea', {
          placeholder: 'Abre el PDF del laboratorio, selecciona todo el texto (Ctrl+A), cópialo (Ctrl+C) y pégalo aquí.\n\nTambién sirve escribir línea por línea:\nHEMOGLOBINA 12.8 g/dL\nFERRITINA 8 ng/mL',
        })),
        h('div', { class: 'hint', text: 'Funciona con informes de cualquier laboratorio: el sistema reconoce cada examen por su nombre y normaliza las unidades.' }),
      ]),
      h('button', {
        class: 'btn btn-primary',
        onclick: () => {
          const raw = textarea.value.trim();
          if (!raw) return;
          try {
            parsed = parseLabText(raw);
            parsed.mode = 'pegar';
            render();
          } catch (err) {
            alert(`No se pudo leer el texto: ${err.message}`);
          }
        },
        text: 'Leer el informe',
      }),
    ]);
  }

  function manualForm() {
    const dict = dictionary();
    const values = {};
    let dateInput;

    return h('div', {}, [
      field('Fecha de la muestra', (dateInput = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) }))),
      h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(220px,1fr))' },
        dict.analytes.map((def) => h('div', { class: 'field' }, [
          h('label', {}, [def.label, ' ', h('span', { class: 'muted tiny', text: def.displayUnit })]),
          h('input', {
            type: 'number', step: 'any', placeholder: '—',
            oninput: (e) => {
              const v = e.target.value.trim();
              if (v === '') delete values[def.id];
              else values[def.id] = Number(v.replace(',', '.'));
            },
          }),
        ]))),
      h('button', {
        class: 'btn btn-primary',
        onclick: () => {
          const results = {};
          for (const [id, value] of Object.entries(values)) {
            if (!Number.isFinite(value)) continue;
            results[id] = normalizeManual(id, value, analyte(id).displayUnit);
          }
          if (!Object.keys(results).length) { alert('Escribe al menos un valor.'); return; }
          parsed = {
            results, unmatched: [], mode: 'manual',
            privacy: { found: [], clean: true },
            hints: {}, dates: { sample: dateInput.value, previous: null },
          };
          render();
        },
        text: 'Revisar los valores',
      }),
    ]);
  }

  function confirmCard(result, context) {
    const entries = Object.entries(result.results);
    let dateInput;

    return card('Confirma los datos detectados', [
      result.privacy.found.length ? h('div', { class: 'notice notice-good' }, [
        h('span', { class: 'ico', text: '🛡️' }),
        h('div', {}, [
          h('b', { text: `Se removieron ${result.privacy.found.reduce((a, f) => a + f.count, 0)} datos personales antes de guardar` }),
          h('ul', { class: 'tiny', style: 'padding-left:18px;margin:4px 0 0' },
            result.privacy.found.map((f) => h('li', { text: `${f.label} (${f.count}): ${f.samples.join(', ')}` }))),
        ]),
      ]) : null,

      result.hints.ageYears || result.hints.sex ? h('div', { class: 'notice notice-info' }, [
        h('span', { class: 'ico', text: '👤' }),
        h('div', { class: 'small' }, [
          h('b', { text: 'Datos clínicos detectados' }),
          `Edad: ${result.hints.ageYears ?? '—'} años · sexo: ${result.hints.sex === 'female' ? 'femenino' : result.hints.sex === 'male' ? 'masculino' : '—'}. `,
          'Estos sí se conservan porque cambian los umbrales que se aplican.',
        ]),
      ]) : null,

      field('Fecha de la muestra', (dateInput = h('input', {
        type: 'date', value: result.dates.sample || new Date().toISOString().slice(0, 10),
      })), 'Se detectó del informe cuando fue posible. Corrígela si hace falta.'),

      entries.length ? h('table', { class: 'table' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', { text: 'Examen' }), h('th', { class: 'right', text: 'Detectado' }),
          h('th', { text: 'Unidad' }), h('th', { class: 'right', text: 'Anterior' }),
          h('th', { text: 'Rango del laboratorio' }), h('th', { text: 'LOINC' }),
        ])]),
        h('tbody', {}, entries.map(([id, r]) => {
          const def = analyte(id);
          return h('tr', {}, [
            h('td', { text: def.label }),
            h('td', { class: 'right' }, [h('input', {
              type: 'number', step: 'any', value: String(r.value),
              style: 'width:96px;text-align:right',
              oninput: (e) => { r.value = Number(e.target.value); },
            })]),
            h('td', { class: 'tiny' }, [
              def.displayUnit,
              r.converted ? h('div', { class: 'muted', text: `convertido de ${r.reportedUnit}` }) : null,
            ]),
            h('td', { class: 'num muted', text: r.previousInReport != null ? num(r.previousInReport, def.decimals) : '—' }),
            h('td', { class: 'tiny muted', text: r.labRange ? `${r.labRange.low} – ${r.labRange.high}` : '—' }),
            h('td', { class: 'tiny mono muted', text: r.loinc }),
          ]);
        })),
      ]) : h('p', { class: 'muted', text: 'No se reconoció ningún examen en el texto.' }),

      result.unmatched.length ? h('div', { class: 'notice notice-warn' }, [
        h('span', { class: 'ico', text: '❓' }),
        h('div', { class: 'small' }, [
          h('b', { text: 'No se pudo interpretar' }),
          result.unmatched.join(', '),
          '. Puedes escribir esos valores a mano.',
        ]),
      ]) : null,

      result.dates.previous ? h('label', { class: 'check', style: 'margin:12px 0' }, [
        h('input', { type: 'checkbox', id: 'ft-import-prev', checked: true }),
        `El informe trae también los resultados del ${formatDate(result.dates.previous)}. Guardarlos como un control anterior.`,
      ]) : null,

      h('div', { class: 'btn-row' }, [
        h('button', {
          class: 'btn btn-accent',
          onclick: () => {
            const importPrevious = document.getElementById('ft-import-prev')?.checked;
            context.onSaveLab({
              date: dateInput.value,
              results: result.results,
              source: result.mode === 'manual' ? 'registro manual' : 'informe de laboratorio',
              privacyRemoved: result.privacy.found.reduce((a, f) => a + f.count, 0),
              hints: result.hints,
              previousDate: importPrevious ? result.dates.previous : null,
            });
          },
          text: 'Confirmar y guardar',
        }),
        h('button', { class: 'btn', onclick: () => { parsed = null; render(); }, text: 'Descartar' }),
      ]),
    ]);
  }

  render();
  return container;
}

// =====================================================================
// PERFIL
// =====================================================================

const CONDITIONS = [
  ['gastro', 'Problemas digestivos'],
  ['celiaquia', 'Celiaquía'],
  ['cirugia', 'Cirugía digestiva previa'],
  ['sangrado', 'Sangrados conocidos'],
  ['deporte', 'Deporte intenso'],
  ['deficit_previo', 'Déficit de hierro anterior'],
  ['suplemento', 'Toma suplemento indicado'],
  ['inflamacion', 'Inflamación o infección reciente'],
];

const SYMPTOMS = [
  ['cansancio', 'Cansancio'],
  ['somnolencia', 'Somnolencia'],
  ['concentracion', 'Cuesta concentrarse'],
  ['cefalea', 'Dolor de cabeza'],
  ['mareos', 'Mareos'],
  ['palidez', 'Palidez'],
  ['caida_cabello', 'Caída de cabello'],
  ['unas', 'Uñas frágiles'],
  ['ejercicio', 'Menos aguante al ejercicio'],
  ['palpitaciones', 'Palpitaciones'],
  ['disnea', 'Falta de aire'],
  ['pica', 'Antojo de hielo o tierra'],
];

export function perfil(ctx) {
  const { caseData, onSaveProfile, foods } = ctx;
  const p = structuredClone(caseData.profile);
  const symptoms = new Set(ctx.currentSymptoms || []);

  const container = h('div', { class: 'stack' });

  const render = () => {
    container.replaceChildren(
      card('Perfil anónimo', [
        h('div', { class: 'notice notice-good' }, [
          h('span', { class: 'ico', text: '🛡️' }),
          h('div', { class: 'small' }, [
            h('b', { text: 'Solo variables con valor clínico' }),
            'Aquí no hay nombre, documento, dirección ni contacto. Cada dato de esta página cambia algún umbral o alguna recomendación: si no lo hiciera, no estaría.',
          ]),
        ]),

        h('div', { class: 'grid grid-3' }, [
          field('Edad (años)', h('input', {
            type: 'number', min: '0', max: '120', value: p.ageYears ?? '',
            oninput: (e) => { p.ageYears = e.target.value === '' ? null : Number(e.target.value); },
          }), 'Define el punto de corte de hemoglobina y de ferritina'),

          field('Sexo fisiológico', h('select', {
            onchange: (e) => { p.sex = e.target.value; render(); },
          }, [['female', 'Femenino'], ['male', 'Masculino'], ['intersex', 'Intersexual'], ['no_declara', 'Prefiere no decir']]
            .map(([v, l]) => h('option', { value: v, selected: p.sex === v, text: l })))),

          field('Altitud de residencia (m)', h('input', {
            type: 'number', min: '0', max: '5500', step: '50', value: p.altitude ?? 0,
            oninput: (e) => { p.altitude = Number(e.target.value) || 0; },
          }), 'A más altura, la hemoglobina normal es más alta'),

          field('Peso (kg)', h('input', {
            type: 'number', min: '3', max: '250', value: p.weightKg ?? '',
            oninput: (e) => { p.weightKg = e.target.value === '' ? null : Number(e.target.value); },
          }), 'Opcional. Afina el cálculo del déficit'),

          field('Talla (cm)', h('input', {
            type: 'number', min: '30', max: '230', value: p.heightCm ?? '',
            oninput: (e) => { p.heightCm = e.target.value === '' ? null : Number(e.target.value); },
          }), 'Opcional'),

          field('Alimentación', h('select', {
            onchange: (e) => { p.diet = e.target.value; },
          }, [['mixta', 'Mixta'], ['vegetariana', 'Vegetariana'], ['vegana', 'Vegana']]
            .map(([v, l]) => h('option', { value: v, selected: p.diet === v, text: l })))),
        ]),
      ]),

      p.sex === 'female' ? card('Situación fisiológica', [
        h('label', { class: 'check', style: 'margin-bottom:12px' }, [
          h('input', {
            type: 'checkbox', checked: p.pregnant,
            onchange: (e) => { p.pregnant = e.target.checked; render(); },
          }),
          'Gestación en curso',
        ]),
        h('label', { class: 'check', style: 'margin-bottom:12px' }, [
          h('input', {
            type: 'checkbox', checked: !!p.menstruates,
            onchange: (e) => { p.menstruates = e.target.checked; render(); },
          }),
          'Presenta menstruación',
        ]),
        p.menstruates ? h('div', { class: 'grid grid-2' }, [
          field('Cantidad', h('select', {
            onchange: (e) => { p.menstrualFlow = e.target.value; },
          }, [['ligero', 'Ligera'], ['moderado', 'Moderada'], ['abundante', 'Abundante']]
            .map(([v, l]) => h('option', { value: v, selected: p.menstrualFlow === v, text: l }))),
          'Es un factor de pérdida de hierro que se suma a la necesidad diaria'),
          field('Patrón', h('select', {
            onchange: (e) => { p.menstrualPattern = e.target.value; },
          }, [['regular', 'Regular'], ['irregular', 'Irregular']]
            .map(([v, l]) => h('option', { value: v, selected: p.menstrualPattern === v, text: l })))),
        ]) : null,
        p.menstruates ? h('p', { class: 'tiny muted' }, [
          'El sistema registra esto como un factor que puede contribuir, y así lo comunica. No concluye por su cuenta que sea la causa del déficit: eso lo evalúa un profesional junto con el resto de antecedentes.',
        ]) : null,
      ]) : null,

      card('Antecedentes', [
        h('p', { class: 'small muted', text: 'Marca lo que corresponda. Sirve para que el sistema sepa qué factores mencionar cuando encuentre una alteración.' }),
        h('div', { class: 'chips' }, CONDITIONS.map(([value, label]) => h('button', {
          class: 'chip', 'aria-pressed': String(p.conditions.includes(value)),
          onclick: () => {
            const i = p.conditions.indexOf(value);
            if (i >= 0) p.conditions.splice(i, 1); else p.conditions.push(value);
            render();
          },
          text: label,
        }))),
      ]),

      card('Síntomas recientes', [
        h('p', { class: 'small muted', text: 'Se guardan aparte de los resultados: son datos que reportas tú, no medidos. El sistema los cruza pero nunca los mezcla.' }),
        h('div', { class: 'chips' }, SYMPTOMS.map(([value, label]) => h('button', {
          class: 'chip', 'aria-pressed': String(symptoms.has(value)),
          onclick: () => {
            if (symptoms.has(value)) symptoms.delete(value); else symptoms.add(value);
            render();
          },
          text: label,
        }))),
      ]),

      card('Preferencias de comida', [
        h('div', { class: 'grid grid-2' }, [
          field('Presupuesto', h('select', {
            onchange: (e) => { p.budget = Number(e.target.value); },
          }, [['1', 'Ajustado'], ['2', 'Medio'], ['3', 'Amplio']]
            .map(([v, l]) => h('option', { value: v, selected: String(p.budget) === v, text: l }))),
          'Limita el catálogo a lo que se puede comprar'),
          field('Región', h('select', {
            onchange: (e) => { p.region = e.target.value; },
          }, [['costa', 'Costa'], ['sierra', 'Sierra'], ['selva', 'Selva']]
            .map(([v, l]) => h('option', { value: v, selected: p.region === v, text: l })))),
        ]),
        field('Alergias', h('input', {
          type: 'text', value: (p.allergies || []).join(', '),
          placeholder: 'maní, mariscos…',
          oninput: (e) => { p.allergies = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); },
        }), 'Separadas por comas'),
        h('div', { class: 'field' }, [
          h('label', { text: 'Alimentos que no quiere comer' }),
          h('div', { class: 'chips', style: 'max-height:220px;overflow-y:auto' },
            (foods || []).map((f) => h('button', {
              class: 'chip', 'aria-pressed': String((p.dislikes || []).includes(f.id)),
              onclick: () => {
                p.dislikes = p.dislikes || [];
                const i = p.dislikes.indexOf(f.id);
                if (i >= 0) p.dislikes.splice(i, 1); else p.dislikes.push(f.id);
                render();
              },
              text: f.n,
            }))),
          h('div', { class: 'hint', text: 'El planificador no volverá a proponerlos.' }),
        ]),
      ]),

      h('div', { class: 'btn-row' }, [
        h('button', {
          class: 'btn btn-primary',
          onclick: () => onSaveProfile(structuredClone(p), [...symptoms]),
          text: 'Guardar perfil',
        }),
      ]),
    );
  };

  render();
  return container;
}

// =====================================================================
// CONFIGURACIÓN
// =====================================================================

export function config(ctx) {
  const { caseData, onSaveSettings, onReset, onNewCase, onImport } = ctx;
  const s = { ...caseData.settings };
  const container = h('div', { class: 'stack' });

  const render = () => {
    const live = refreshStatus();

    container.replaceChildren(
      card('Privacidad', [
        h('div', { class: 'notice notice-good' }, [
          h('span', { class: 'ico', text: '🛡️' }),
          h('div', { class: 'small' }, [
            h('b', { text: '100 % anónimo, y verificable' }),
            'Todo vive en el almacenamiento local de este navegador. No hay cuenta, no hay servidor, no hay analítica. Si borras los datos del sitio, desaparece todo.',
          ]),
        ]),
        h('div', { class: 'row', style: 'margin-top:12px' }, [
          h('span', { class: 'small' }, ['Código del caso: ', h('b', { class: 'mono', text: caseData.caseId })]),
          h('button', { class: 'btn btn-sm', onclick: onNewCase, text: 'Generar otro código' }),
        ]),
      ]),

      card('Tus datos', [
        h('div', { class: 'btn-row' }, [
          h('button', {
            class: 'btn',
            onclick: () => {
              const blob = new Blob([JSON.stringify(caseData, null, 2)], { type: 'application/json' });
              download(blob, `ferrotrack-${caseData.caseId}.json`);
            },
            text: '↓ Exportar el caso (JSON)',
          }),
          h('label', { class: 'btn' }, [
            '↑ Importar un caso',
            h('input', {
              type: 'file', accept: 'application/json', style: 'display:none',
              onchange: async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try { onImport(await file.text()); } catch (err) { alert(err.message); }
              },
            }),
          ]),
          h('button', {
            class: 'btn',
            onclick: () => { if (confirm('Esto borra todo el caso de este navegador. ¿Continuar?')) onReset(); },
            text: '🗑 Borrar todo',
          }),
        ]),
        h('p', { class: 'tiny muted', style: 'margin-top:12px', text: 'El archivo exportado ya viene anonimizado: es exactamente lo que guarda la aplicación.' }),
      ]),

      card('Datos de nutrición', [
        h('p', { class: 'small' }, [
          `Catálogo actual: `, h('b', { text: `${ctx.foods?.length || 0} alimentos` }),
          ` · versión ${ctx.foodsVersion || '—'}.`,
        ]),
        h('label', { class: 'check', style: 'margin:12px 0' }, [
          h('input', {
            type: 'checkbox', checked: s.liveNutrition,
            onchange: (e) => { s.liveNutrition = e.target.checked; render(); },
          }),
          'Buscar datos de composición actualizados al abrir la aplicación',
        ]),
        h('p', { class: 'tiny muted' }, [
          'El catálogo se regenera periódicamente desde USDA FoodData Central mediante un flujo automático del repositorio, y queda publicado junto al sitio. ',
          'Con una clave propia de la API, la aplicación además puede consultarla en vivo desde tu navegador.',
        ]),
        field('Clave de USDA FoodData Central (opcional)', h('input', {
          type: 'text', value: s.fdcApiKey || '', placeholder: 'DEMO_KEY',
          oninput: (e) => { s.fdcApiKey = e.target.value.trim(); },
        }), 'Se guarda solo en este navegador. Gratuita en api.data.gov/signup'),
        h('div', { class: 'btn-row' }, [
          h('button', {
            class: 'btn btn-sm',
            onclick: async (e) => {
              e.target.disabled = true;
              e.target.textContent = 'Consultando…';
              const result = await refreshFromLive(ctx.foods, s.fdcApiKey);
              e.target.disabled = false;
              e.target.textContent = 'Actualizar ahora';
              alert(result.message);
              render();
            },
            text: 'Actualizar ahora',
          }),
        ]),
        live.lastCheck ? h('p', { class: 'tiny muted', style: 'margin-top:8px',
          text: `Última consulta en vivo: ${live.lastCheck} · ${live.message}` }) : null,
      ]),

      card('Consejero', [
        h('label', { class: 'check' }, [
          h('input', {
            type: 'checkbox', checked: s.coach,
            onchange: (e) => { s.coach = e.target.checked; render(); },
          }),
          'Mostrar a Ferrín, el consejero',
        ]),
        h('p', { class: 'tiny muted', style: 'margin-top:8px', text: 'Ferrín anima, celebra y explica trucos de cocina. Nunca da indicaciones médicas ni habla de dosis.' }),
      ]),

      card('Apariencia', [
        h('div', { class: 'chips' }, [
          ['auto', 'Según el sistema'], ['light', 'Claro'], ['dark', 'Oscuro'],
        ].map(([value, label]) => h('button', {
          class: 'chip', 'aria-pressed': String((s.theme || 'auto') === value),
          onclick: () => {
            s.theme = value;
            if (value === 'auto') document.documentElement.removeAttribute('data-theme');
            else document.documentElement.setAttribute('data-theme', value);
            render();
          },
          text: label,
        }))),
      ]),

      card('Base de reglas clínicas', [
        h('p', { class: 'small' }, [
          'Conjunto activo: ', h('b', { class: 'mono', text: s.rulesetVersion }), '. ',
          'Cada análisis guarda con qué versión fue interpretado, de modo que un cambio futuro de guías no reescriba en silencio lo que se concluyó antes.',
        ]),
      ]),

      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn btn-primary', onclick: () => onSaveSettings({ ...s }), text: 'Guardar ajustes' }),
      ]),
    );
  };

  render();
  return container;
}
