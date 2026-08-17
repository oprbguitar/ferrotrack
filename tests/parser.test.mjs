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

/**
 * Regresión sobre el informe completo, con encabezados repetidos, pies de
 * página, comentarios de la OMS y la tabla de rangos por edad de la ferritina.
 * Es donde un anonimizador demasiado entusiasta rompe cosas: la prueba fija que
 * no se pierda ningún analito y que no sobreviva ningún dato personal.
 */
const FULL_REPORT = `CLINICA INTERNACIONAL Unidad de Laboratorio Clínico Telefono: (01) 6196161 www.clinicainternacional.com.pe Paciente CAROLINA ANALY REYES MORENO 03/07/2026 16:55 Fecha/Hora Ingreso : : 15/11/2013 Edad:  12  Años F.Nacimiento : Solicitud : 22098709 Femenino Sexo : 78334836 : DNI Prioridad : Rutina SBO - HEMATOLOGIA PEDIAT. CEX : Procedencia Prefactura : 30349571 SAENZ LLANOS LUCERO Solicitante : 4346339-01 Orden Externa : CMP : 061457 EXAMENES DE LABORATORIO Tipo de Muestra: SUERO Fecha de Toma de Muestras: 15/08/2026  09:25    - Fecha Recepción: 15/08/2026 11:52   - Lugar de Toma: SUR Examen Resultado U.M. Valores de Referencia Método Resultado  Anterior 27/06/2026 HIERRO SERICO 25.5 µg/dL Colorimétrico < 32.2 33.00 - 193.00 TRANSFERRINA 324 mg/dL Inmunoturbidimetría 319 200.00 - 360.00 SATURACION DE TRANSFERRINA% 5.62 % Inmunoturbidimetría < 7.21 20.00 - 50.00 Fecha/Hora Validación: 15/08/2026  19:31 * = Valor crítico Dr. Sergio Ronceros Medrano Director Médico de Laboratorio Clinico CMP: 15232 - RNE: 5799 Dr. Christian Blas La Rosa Fabian Patólogo Clínico CMP: 52128 - RNE: 24030 VALIDADO CLINICAMENTE POR Fecha de Impresión: 15/08/2026 19:32 1 / 6 CERTIFICACION ISO 9001:2015 - LABORATORIO CLINICO
HEMOGRAMA Tipo de Muestra: SANGRE TOTAL RECUENTO CELULAR   RECUENTO DE LEUCOCITOS ** 7.27 x 10^3 cel/µL Citometría de Flujo 7.25 3.67 - 10.09   RECUENTO DE HEMATIES ** 4.56 x 10^6 cel/µL Corriente continua de  enfoque  hidrodinámico(Impeda 4.50 4.41 - 5.69   RECUENTO DE PLAQUETAS ** 290 x 10^3 cel/µL Corriente continua de  enfoque  hidrodinámico(Impeda 364 182.00 - 369.00 HEMOGLOBINA Y HEMATOCRITO   HEMOGLOBINA ** 12.8 g/dL Fotometría 12.1 11.50 - 16.10   HEMATOCRITO 38.5 % Enfoque Hidrodinámico 37.7 34.50 - 48.30 CONSTANTES CORPUSCULARES   VCM 84.4 fL 83.8 79.00 - 92.90   HCM 28.1 pg 26.9 25.60 - 32.20   CHCM 33.2 g/dL 32.1 32.20 - 35.50   RDW-CV 17.2 % > 15.6 11.70 - 14.40   RDW-SD 53.1 fL > 47.4 36.40 - 46.30   VOLUMEN PLAQUETARIO MEDIO(MP 9.8 fL Impedancia 9.5 9.40 - 12.30
Comentario: Según la OMS, se considera sin anemia si: Hb>=11.00: En niños de 6 a 59 meses de edad. Hb>=11.50: En niños de 5 a 11 años de edad. Hb>=12.00: En niños de 12 a 14 años de edad.
INMUNOBIOQUIMICA FERRITINA 8 ng/mL ECLIA < 7 13 - 68 MASCULINO < 1 año: 12-327 ng/mL 1 - 3 años : 6-67 ng/mL 4 - 6 años : 4-67 ng/mL 7- 12 años: 14 -124 ng/mL 13 - 17 años: 14-152 ng/mL >18 años: 30-400 ng/mL FEMENINO < 1 año: 12-327 ng/mL 1 - 3 años : 6-67 ng/mL 4 - 6 años : 4-67 ng/mL 7- 12 años: 7-84 ng/mL 13 - 17 años: 13-68 ng/mL >18 años: 13-150 ng/mL VITAMINA B-12 642 pg/mL Electroquimioluminiscencia 501 197 - 771 ACIDO FOLICO 36.5 ng/mL Electroquimioluminiscencia 14.2 4.80 - 37.30`;

test('el informe completo no pierde ningún analito al anonimizarse', () => {
  const { results, privacy } = parseLabText(FULL_REPORT);

  const required = [
    'hierro_serico', 'transferrina', 'sat_transferrina', 'leucocitos', 'hematies',
    'plaquetas', 'hemoglobina', 'hematocrito', 'vcm', 'hcm', 'chcm', 'rdw_cv',
    'rdw_sd', 'ferritina', 'vitamina_b12', 'acido_folico',
  ];
  for (const id of required) {
    assert.ok(results[id], `se perdió ${id} en el informe completo`);
  }
  assert.equal(results.hemoglobina.value, 12.8);
  assert.equal(results.ferritina.value, 8);
  assert.equal(results.rdw_cv.value, 17.2);
  assert.ok(privacy.found.length >= 4);
});

test('el informe completo no deja ningún dato personal', () => {
  const { text } = anonymizeText(FULL_REPORT);
  for (const leak of ['CAROLINA', 'ANALY', 'REYES', 'MORENO', 'SAENZ', 'LLANOS',
    '78334836', '22098709', '30349571', '061457', '15232', '52128', '15/11/2013']) {
    assert.ok(!text.includes(leak), `sobrevivió el dato personal "${leak}"`);
  }
});

test('descarta valores fisiológicamente imposibles', () => {
  const { results, unmatched } = parseLabText('HEMOGLOBINA 999 g/dL');
  assert.equal(results.hemoglobina, undefined);
  assert.ok(unmatched.some((u) => u.includes('Hemoglobina')));
});
