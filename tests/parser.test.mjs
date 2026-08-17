/**
 * Pruebas del parser y del anonimizador.
 * Ejecutar con:  node --test tests/
 *
 * El texto de prueba reproduce el formato de un informe real de laboratorio
 * peruano, incluidos los datos personales, para verificar que el anonimizador
 * los elimina antes de que el parser vea nada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..', 'site');

// El parser carga su diccionario con fetch(); en Node lo servimos del disco.
globalThis.fetch = async (url) => {
  const path = join(SITE, String(url).replace(/^\.?\//, ''));
  const body = await readFile(path, 'utf8');
  return { ok: true, json: async () => JSON.parse(body), text: async () => body };
};

const { loadDictionary, parseLabText } = await import('../site/js/core/parser.js');
const { anonymizeText } = await import('../site/js/core/anonymize.js');

await loadDictionary('');

const REPORT = `CLINICA INTERNACIONAL Unidad de Laboratorio Clínico Telefono: (01) 6196161 Paciente CAROLINA ANALY REYES MORENO 03/07/2026 16:55 Fecha/Hora Ingreso : : 15/11/2013 Edad:  12  Años F.Nacimiento : Solicitud : 22098709 Femenino Sexo : 78334836 : DNI Prioridad : Rutina SAENZ LLANOS LUCERO Solicitante : CMP : 061457 Tipo de Muestra: SUERO Fecha de Toma de Muestras: 15/08/2026  09:25 Examen Resultado U.M. Valores de Referencia Método Resultado  Anterior 27/06/2026 HIERRO SERICO 25.5 µg/dL Colorimétrico < 32.2 33.00 - 193.00 TRANSFERRINA 324 mg/dL Inmunoturbidimetría 319 200.00 - 360.00 SATURACION DE TRANSFERRINA% 5.62 % Inmunoturbidimetría < 7.21 20.00 - 50.00
RECUENTO DE LEUCOCITOS ** 7.27 x 10^3 cel/µL Citometría de Flujo 7.25 3.67 - 10.09   RECUENTO DE HEMATIES ** 4.56 x 10^6 cel/µL Corriente continua 4.50 4.41 - 5.69   RECUENTO DE PLAQUETAS ** 290 x 10^3 cel/µL Corriente continua 364 182.00 - 369.00 HEMOGLOBINA Y HEMATOCRITO   HEMOGLOBINA ** 12.8 g/dL Fotometría 12.1 11.50 - 16.10   HEMATOCRITO 38.5 % Enfoque Hidrodinámico 37.7 34.50 - 48.30 CONSTANTES CORPUSCULARES   VCM 84.4 fL 83.8 79.00 - 92.90   HCM 28.1 pg 26.9 25.60 - 32.20   CHCM 33.2 g/dL 32.1 32.20 - 35.50   RDW-CV 17.2 % > 15.6 11.70 - 14.40   RDW-SD 53.1 fL > 47.4 36.40 - 46.30
FERRITINA 8 ng/mL ECLIA < 7 13 - 68 MASCULINO < 1 año: 12-327 ng/mL 7- 12 años: 14 -124 ng/mL FEMENINO 7- 12 años: 7-84 ng/mL VITAMINA B-12 642 pg/mL Electroquimioluminiscencia 501 197 - 771 ACIDO FOLICO 36.5 ng/mL Electroquimioluminiscencia 14.2 4.80 - 37.30`;

test('el anonimizador borra nombre, DNI, teléfono y colegiatura', () => {
  const { text, found } = anonymizeText(REPORT);
  assert.ok(!text.includes('CAROLINA'), 'el nombre del paciente sigue presente');
  assert.ok(!text.includes('SAENZ LLANOS'), 'el nombre del solicitante sigue presente');
  assert.ok(!text.includes('78334836'), 'el DNI sigue presente');
  assert.ok(!text.includes('061457'), 'la colegiatura sigue presente');
  assert.ok(found.length >= 3, 'debería reportar varios hallazgos');
});

test('extrae los valores actuales normalizados', () => {
  const { results } = parseLabText(REPORT);
  const expected = {
    hierro_serico: 25.5,
    transferrina: 324,
    sat_transferrina: 5.62,
    hemoglobina: 12.8,
    hematocrito: 38.5,
    hematies: 4.56,
    plaquetas: 290,
    leucocitos: 7.27,
    vcm: 84.4,
    hcm: 28.1,
    chcm: 33.2,
    rdw_cv: 17.2,
    rdw_sd: 53.1,
    ferritina: 8,
    vitamina_b12: 642,
    acido_folico: 36.5,
  };
  for (const [id, value] of Object.entries(expected)) {
    assert.ok(results[id], `no se reconoció ${id}`);
    assert.equal(results[id].value, value, `valor incorrecto en ${id}`);
  }
});

test('recupera el resultado anterior que imprime el informe', () => {
  const { results } = parseLabText(REPORT);
  const expected = {
    hierro_serico: 32.2,
    sat_transferrina: 7.21,
    hemoglobina: 12.1,
    ferritina: 7,
    vitamina_b12: 501,
    acido_folico: 14.2,
    rdw_cv: 15.6,
  };
  for (const [id, value] of Object.entries(expected)) {
    assert.equal(results[id].previousInReport, value, `anterior incorrecto en ${id}`);
  }
});

test('lee el rango informado por el laboratorio', () => {
  const { results } = parseLabText(REPORT);
  assert.deepEqual(results.ferritina.labRange, { low: 13, high: 68 });
  assert.deepEqual(results.hemoglobina.labRange, { low: 11.5, high: 16.1 });
  assert.deepEqual(results.sat_transferrina.labRange, { low: 20, high: 50 });
});

test('detecta fecha de muestra y fecha del resultado anterior', () => {
  const { dates } = parseLabText(REPORT);
  assert.equal(dates.sample, '2026-08-15');
  assert.equal(dates.previous, '2026-06-27');
});

test('extrae edad y sexo, que sí son datos clínicos', () => {
  const { hints } = parseLabText(REPORT);
  assert.equal(hints.ageYears, 12);
  assert.equal(hints.sex, 'female');
});

test('convierte unidades alternativas a la unidad canónica', () => {
  const { results } = parseLabText('HEMOGLOBINA 128 g/L\nFERRITINA 8 ug/L');
  assert.equal(results.hemoglobina.value, 12.8);
  assert.equal(results.hemoglobina.converted, true);
  assert.equal(results.ferritina.value, 8);
});

test('descarta valores fisiológicamente imposibles', () => {
  const { results, unmatched } = parseLabText('HEMOGLOBINA 999 g/dL');
  assert.equal(results.hemoglobina, undefined);
  assert.ok(unmatched.some((u) => u.includes('Hemoglobina')));
});
