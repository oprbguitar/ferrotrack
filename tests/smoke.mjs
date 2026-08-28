/**
 * Prueba de humo con navegador real.
 *
 * Recorre la aplicación de nutrición: arranque por rangos, visor del plan del
 * día, reproducción de la semana, compra semanal, constructor de platos y
 * horario. Falla si aparece cualquier error de consola, si una sección no se
 * dibuja, o si la página desborda horizontalmente en móvil.
 *
 * Uso:  node tests/smoke.mjs [url] [--shots carpeta]
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:8099/';
const shotsIndex = process.argv.indexOf('--shots');
const SHOTS = shotsIndex > 0 ? process.argv[shotsIndex + 1] : null;

const problems = [];

const run = async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1280, height: 1500 } });

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
    await page.waitForTimeout(400);
    const added = problems.slice(before);
    console.log(`${added.length ? '✗' : '✓'} ${label}${added.length ? ` — ${added.join(' | ')}` : ''}`);
  };

  await step('carga inicial: portada de arranque por rangos', async () => {
    await page.goto(URL_BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.sidebar');
    await page.waitForSelector('text=Arma tu plan de nutrición');
  });
  await shot('01-arranque');

  await step('elegir rangos de edad, peso, día y dieta', async () => {
    await page.click('text=10 a 13 años');
    await page.click('text=50 a 60 kg');
    await page.click('text=Voy al colegio');
    await page.click('text=Como de todo');
  });

  await step('generar el plan de nutrición', async () => {
    await page.click('text=Generar mi plan de nutrición');
    await page.waitForSelector('text=Tu menú de hoy', { timeout: 6000 });
  });
  await shot('02-plan-hoy');

  await step('el plan del día muestra tarjetas de comida de colores', async () => {
    const cards = await page.locator('.mealx').count();
    if (cards < 3) problems.push(`se esperaban varias tarjetas de comida, hay ${cards}`);
  });

  await step('el plan muestra costo aproximado en soles', async () => {
    const body = await page.textContent('body');
    if (!/S\/\s?\d/.test(body)) problems.push('no aparece un costo en soles');
  });

  await step('panel de energía: qué vas a poder hacer', async () => {
    await page.waitForSelector('text=Con esta comida vas a poder', { timeout: 4000 })
      .catch(() => problems.push('no apareció el panel de energía'));
  });

  await step('reproducir el visor de la semana y pausar', async () => {
    await page.click('text=Reproducir semana');
    await page.waitForTimeout(600);
    await page.click('text=Pausar visor');
  });
  await shot('03-visor');

  await step('cambiar el plan al azar', async () => {
    await page.click('text=Cambiar al azar');
    await page.waitForSelector('text=Tu menú de hoy');
  });

  for (const [route, marker, name] of [
    ['semana', 'Tu semana completa', '04-semana'],
    ['compra', 'Tu compra de la semana', '05-compra'],
    ['plato', 'Constructor de platos', '06-plato'],
    ['horario', 'Horario del día', '07-horario'],
    ['perfil', 'Mi perfil', '08-perfil'],
    ['config', 'Privacidad', '09-config'],
  ]) {
    await step(`sección ${route}`, async () => {
      await page.goto(`${URL_BASE}#/${route}`);
      await page.waitForTimeout(300);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector(`text=${marker}`, { timeout: 6000 })
        .catch(() => problems.push(`no apareció "${marker}" en ${route}`));
    });
    await shot(name);
  }

  await step('la compra semanal suma un total en soles', async () => {
    await page.goto(`${URL_BASE}#/compra`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Tu compra de la semana');
    const body = await page.textContent('body');
    if (!/por día/.test(body)) problems.push('no se calculó el costo por día de la compra');
  });

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
  await shot('10-plato-calculado');

  await step('editar el perfil cambia el plan', async () => {
    await page.goto(`${URL_BASE}#/perfil`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Mi perfil');
    await page.click('text=Trabajo', { timeout: 4000 });
    await page.click('text=Guardar y rehacer el plan');
    await page.waitForSelector('text=Tu menú de hoy');
  });
  await shot('11-perfil-trabajo');

  await step('modo oscuro', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${URL_BASE}#/nutricion`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.mealx');
  });
  await shot('12-oscuro');

  await step('vista angosta (móvil) sin desborde horizontal', async () => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${URL_BASE}#/nutricion`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.mealx');
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
  await shot('13-movil');

  await step('la parte clínica sigue accesible por enlace directo', async () => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto(`${URL_BASE}#/subir`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Subir un nuevo análisis', { timeout: 6000 })
      .catch(() => problems.push('la sección clínica de subir análisis dejó de cargar'));
  });

  await browser.close();

  console.log(`\n${problems.length ? `✗ ${problems.length} problemas` : '✓ sin problemas'}`);
  if (problems.length) {
    for (const p of [...new Set(problems)]) console.log(`  · ${p}`);
    process.exit(1);
  }
};

run().catch((err) => { console.error(err); process.exit(1); });
