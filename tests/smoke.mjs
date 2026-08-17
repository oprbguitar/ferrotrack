/**
 * Prueba de humo con navegador real.
 *
 * Carga la aplicación, sube el informe de laboratorio de ejemplo, recorre todas
 * las secciones y falla si aparece cualquier error de consola. Sirve para
 * detectar lo que las pruebas unitarias no ven: un import mal escrito, un
 * atributo SVG inválido, una vista que revienta al dibujarse.
 *
 * Uso:  node tests/smoke.mjs [url] [--shots carpeta]
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:8099/';
const shotsIndex = process.argv.indexOf('--shots');
const SHOTS = shotsIndex > 0 ? process.argv[shotsIndex + 1] : null;

const REPORT = `CLINICA INTERNACIONAL Unidad de Laboratorio Clínico Telefono: (01) 6196161 Paciente CAROLINA ANALY REYES MORENO Edad:  12  Años Femenino Sexo : 78334836 : DNI Fecha de Toma de Muestras: 15/08/2026  09:25 Examen Resultado U.M. Valores de Referencia Método Resultado  Anterior 27/06/2026 HIERRO SERICO 25.5 µg/dL Colorimétrico < 32.2 33.00 - 193.00 TRANSFERRINA 324 mg/dL Inmunoturbidimetría 319 200.00 - 360.00 SATURACION DE TRANSFERRINA% 5.62 % Inmunoturbidimetría < 7.21 20.00 - 50.00
RECUENTO DE LEUCOCITOS ** 7.27 x 10^3 cel/µL Citometría de Flujo 7.25 3.67 - 10.09   RECUENTO DE HEMATIES ** 4.56 x 10^6 cel/µL Corriente continua 4.50 4.41 - 5.69   RECUENTO DE PLAQUETAS ** 290 x 10^3 cel/µL Corriente continua 364 182.00 - 369.00 HEMOGLOBINA ** 12.8 g/dL Fotometría 12.1 11.50 - 16.10   HEMATOCRITO 38.5 % Enfoque Hidrodinámico 37.7 34.50 - 48.30 VCM 84.4 fL 83.8 79.00 - 92.90   HCM 28.1 pg 26.9 25.60 - 32.20   CHCM 33.2 g/dL 32.1 32.20 - 35.50   RDW-CV 17.2 % > 15.6 11.70 - 14.40   RDW-SD 53.1 fL > 47.4 36.40 - 46.30
FERRITINA 8 ng/mL ECLIA < 7 13 - 68 VITAMINA B-12 642 pg/mL Electroquimioluminiscencia 501 197 - 771 ACIDO FOLICO 36.5 ng/mL Electroquimioluminiscencia 14.2 4.80 - 37.30`;

const problems = [];

const run = async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`consola: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`excepción: ${err.message}`));

  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  const shot = async (name) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  };

  const step = async (label, fn) => {
    const before = problems.length;
    await fn();
    await page.waitForTimeout(450);
    const added = problems.slice(before);
    console.log(`${added.length ? '✗' : '✓'} ${label}${added.length ? ` — ${added.join(' | ')}` : ''}`);
  };

  await step('carga inicial', async () => {
    await page.goto(URL_BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.sidebar');
  });
  await shot('01-inicio');

  await step('estado vacío muestra el diagrama del recorrido', async () => {
    const diagrams = await page.locator('.diagram svg').count();
    if (!diagrams) problems.push('no se dibujó el diagrama del recorrido');
  });

  await step('subir análisis: pegar informe', async () => {
    await page.click('text=Subir nuevo análisis');
    await page.waitForSelector('textarea');
    await page.fill('textarea', REPORT);
    await page.click('text=Leer el informe');
    await page.waitForSelector('text=Confirma los datos detectados');
  });
  await shot('02-confirmar');

  await step('el informe se anonimizó antes de guardarse', async () => {
    const body = await page.textContent('body');
    if (/CAROLINA|REYES MORENO|78334836/.test(body)) {
      problems.push('quedó un dato personal visible en pantalla');
    }
    const removed = await page.locator('text=/Se removieron \\d+ datos personales/').count();
    if (!removed) problems.push('no se reportó la remoción de datos personales');
  });

  await step('guardar el análisis', async () => {
    await page.click('text=Confirmar y guardar');
    await page.waitForSelector('text=Estado actual del hierro');
  });
  await shot('03-resumen');

  await step('el resumen muestra los valores del informe', async () => {
    const body = await page.textContent('body');
    for (const expected of ['5,62', '12,8', '17,2']) {
      if (!body.includes(expected)) problems.push(`falta el valor ${expected} en el resumen`);
    }
    if (!/Seguimiento recomendado|Alteración relevante/.test(body)) {
      problems.push('no se mostró el nivel de estado');
    }
  });

  await step('se importó el control anterior y hay dos puntos en los gráficos', async () => {
    const circles = await page.locator('.chart-card svg circle').count();
    if (circles < 4) problems.push(`se esperaban al menos 4 marcadores en las series, hay ${circles}`);
  });

  for (const [route, marker, name] of [
    ['historial', 'Antecedente anónimo generado', '04-historial'],
    ['graficos', 'Mapa del hierro', '05-graficos'],
    ['nutricion', 'Plan de hoy', '06-nutricion'],
    ['semana', 'Tu semana', '07-semana'],
    ['plato', 'Constructor de platos', '08-plato'],
    ['horario', 'Horario del colegio', '09-horario'],
    ['seguimiento', 'Patrones detectados', '10-seguimiento'],
    ['preguntas', 'Preguntas para llevar', '11-preguntas'],
    ['controles', 'Calendario de seguimiento', '12-controles'],
    ['perfil', 'Perfil anónimo', '13-perfil'],
    ['config', 'Privacidad', '14-config'],
  ]) {
    await step(`sección ${route}`, async () => {
      await page.goto(`${URL_BASE}#/${route}`);
      await page.waitForTimeout(350);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector(`text=${marker}`, { timeout: 6000 })
        .catch(() => problems.push(`no apareció "${marker}" en ${route}`));
    });
    await shot(name);
  }

  await step('el constructor de platos calcula una combinación', async () => {
    await page.goto(`${URL_BASE}#/plato`);
    await page.reload({ waitUntil: 'networkidle' });
    const select = page.locator('select').first();
    await select.selectOption('lentejas');
    await page.waitForTimeout(250);
    await select.selectOption('limon');
    await page.waitForTimeout(250);
    await page.waitForSelector('text=Análisis de la combinación');
    const body = await page.textContent('body');
    if (!/compatibilidad para absorber hierro/.test(body)) problems.push('no se calculó la compatibilidad');
  });
  await shot('15-plato-calculado');

  await step('el horario es editable y recalcula el día', async () => {
    await page.goto(`${URL_BASE}#/horario`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Horario del colegio');
    await page.locator('input[type=time]').first().fill('08:00');
    await page.waitForTimeout(400);
    await page.click('text=Ayuno (primera comida en el recreo)');
    await page.waitForTimeout(400);
    const body = await page.textContent('body');
    if (!/En modo ayuno no se desayuna en casa/.test(body)) problems.push('el modo ayuno no se aplicó');
  });
  await shot('16-horario-ayuno');

  await step('el consejero aparece y se puede cerrar', async () => {
    await page.goto(`${URL_BASE}#/resumen`);
    await page.reload({ waitUntil: 'networkidle' });
    // El personaje rebota sin parar; se fuerza el clic en vez de esperar a que
    // se quede quieto, que es justamente lo que no va a pasar.
    await page.locator('.sidebar-mascot .drop').click({ force: true });
    await page.waitForSelector('.coach', { timeout: 4000 });
    await page.click('.coach-close');
    await page.waitForTimeout(400);
    if (await page.locator('.coach').count()) problems.push('el consejero no se cerró');
  });

  await step('modo oscuro', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${URL_BASE}#/resumen`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.card');
  });
  await shot('17-oscuro');

  await step('vista angosta (móvil)', async () => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 420, height: 900 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.card');
    const overflow = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= limit + 2) return null;
      const guilty = [...document.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > limit + 1)
        .map((el) => `${el.tagName}.${String(el.className).split(' ')[0]}`);
      return [...new Set(guilty)].slice(0, 5).join(', ') || 'origen no identificado';
    });
    if (overflow) problems.push(`la página desborda horizontalmente en móvil (${overflow})`);
  });
  await shot('18-movil');

  await browser.close();

  console.log(`\n${problems.length ? `✗ ${problems.length} problemas` : '✓ sin problemas'}`);
  if (problems.length) {
    for (const p of [...new Set(problems)]) console.log(`  · ${p}`);
    process.exit(1);
  }
};

run().catch((err) => { console.error(err); process.exit(1); });
