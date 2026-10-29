// Prueba de interfaz: errores de consola, desbordamiento horizontal y capturas
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2] || 'shots';
require('fs').mkdirSync(OUT, { recursive: true });
const url = 'file://' + path.join(__dirname, '..', 'index.html');

// Práctica Nº 7 en rata, con las dosis de la guía
const SEQ = [['adr', 0.3, 'µg/kg'], ['adr', 1, 'µg/kg'], ['adr', 10, 'µg/kg'], ['pro', 1000, 'µg/kg'], ['adr', 10, 'µg/kg'], ['iso', 3, 'µg/kg'], ['ate', 1000, 'µg/kg'], ['iso', 3, 'µg/kg'], ['prz', 1, 'mg/kg'], ['adr', 10, 'µg/kg'], ['phe', 100, 'µg/kg'], ['nor', 10, 'µg/kg']];

async function pickDrug(page, id, name) {
  await page.click('#drugPick');
  await page.fill('#drugSearch', name.slice(0, 5));
  await page.click('.drug-item[data-id="' + id + '"]');
}
async function overflow(page, label, errs) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    wide: Array.from(document.querySelectorAll('body *')).filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > document.documentElement.clientWidth + 1 && !e.closest('.cat-chips') && getComputedStyle(e).position !== 'fixed'; }).slice(0, 5).map(e => e.tagName + '.' + e.className + '#' + e.id + ' ' + Math.round(e.getBoundingClientRect().right)) }));
  if (o.sw > o.cw || o.wide.length) errs.push(label + ' overflow ' + JSON.stringify(o));
}

(async () => {
  const browser = await chromium.launch();
  const all = [];
  for (const [w, h, scheme] of [[360, 740, 'light'], [390, 844, 'dark'], [420, 900, 'light'], [1280, 860, 'dark']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme, hasTouch: w < 900, isMobile: w < 900 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push('console ' + m.type() + ' ' + m.text()); });
    await page.goto(url);
    await page.waitForTimeout(400);
    const tag = w + '-' + scheme;
    await page.screenshot({ path: OUT + '/' + tag + '-0-inicio.png', fullPage: true });
    // Sesión de referencia en modo inmediato
    const names = await page.evaluate(() => Object.fromEntries(CardioEngine.DRUGS.map(d => [d.id, d.name])));
    for (const [id, dose, unit] of SEQ) {
      await pickDrug(page, id, names[id]);
      await page.fill('#dose', String(dose).replace('.', ','));
      await page.selectOption('#unit', unit);
      await page.click('#giveBtn');
    }
    await page.waitForTimeout(300);
    await overflow(page, tag + ' registro', errs);
    // Cursor
    const box = await page.locator('#chart').boundingBox();
    if (w < 900) await page.touchscreen.tap(box.x + box.width * 0.55, box.y + box.height * 0.5);
    else await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.waitForTimeout(150);
    await page.screenshot({ path: OUT + '/' + tag + '-1-registro.png', fullPage: true });
    // Minivista: arrastrar
    const mb = await page.locator('#mini').boundingBox();
    await page.mouse.move(mb.x + mb.width * 0.3, mb.y + mb.height / 2);
    await page.mouse.down(); await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height / 2, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(100);
    await page.screenshot({ path: OUT + '/' + tag + '-2-zoom.png' });
    // Fisiología
    await page.click('#t-fisio');
    await page.waitForTimeout(900);
    await overflow(page, tag + ' fisio', errs);
    await page.screenshot({ path: OUT + '/' + tag + '-3-fisio.png', fullPage: true });
    // Historial
    await page.click('#t-historial');
    await page.click('.ev-head[data-n="10"]');
    await page.click('.ev-head[data-n="7"]');
    await page.waitForTimeout(100);
    await overflow(page, tag + ' historial', errs);
    await page.screenshot({ path: OUT + '/' + tag + '-4-historial.png', fullPage: true });
    // Sesión
    await page.click('#t-sesion');
    await page.waitForTimeout(100);
    await overflow(page, tag + ' sesion', errs);
    await page.screenshot({ path: OUT + '/' + tag + '-5-sesion.png', fullPage: true });
    // Coincidencia con el motor en Node
    const chk = await page.evaluate(() => { const items = document.querySelectorAll('.concl li').length; return items; });
    // Selector
    await page.click('#t-registro');
    await page.click('#drugPick');
    await page.fill('#drugSearch', 'beta');
    await page.waitForTimeout(100);
    await overflow(page, tag + ' sheet', errs);
    await page.screenshot({ path: OUT + '/' + tag + '-6-selector.png' });
    await page.keyboard.press('Escape');
    // Modo en vivo y por kg
    await page.click('[data-mode="live"]');
    await page.click('[data-speed="20"]');
    await pickDrug(page, 'phe', 'Fenilefrina');
    await page.selectOption('#unit', 'µg/kg');
    await page.fill('#dose', '1,5');
    await page.click('#giveBtn');
    await page.waitForTimeout(2500);
    await overflow(page, tag + ' live', errs);
    await page.screenshot({ path: OUT + '/' + tag + '-7-vivo.png', fullPage: true });
    await page.click('#t-fisio');
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + '/' + tag + '-8-fisio-vivo.png' });
    await page.click('#t-historial');
    await page.waitForTimeout(1500);
    // CSV
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => document.querySelector('[data-act="csv-events"]').click())]);
    const p = await dl.path(); const csv = require('fs').readFileSync(p, 'utf8');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => document.querySelector('[data-act="csv-points"]').click())]);
    const csv2 = require('fs').readFileSync(await dl2.path(), 'utf8');
    // Cambio de animal: rata descentralizada y después humano
    await page.click('#t-registro');
    await page.click('#animalBtn');
    await page.click('#dlgPrep [data-prep="descentralizado"]');
    await page.screenshot({ path: OUT + '/' + tag + '-9-animal.png' });
    await page.click('#animalOk');
    const pithed = await page.evaluate(() => [document.querySelector('#vSys').textContent, document.querySelector('#vDia').textContent, document.querySelector('#vHr').textContent, document.querySelector('#animalPrep').textContent]);
    await pickDrug(page, 'prz', 'Prazosina');
    await page.click('#giveBtn');
    await page.click('#animalBtn');
    await page.click('#dlgSpecies [data-sp="humano"]');
    await page.click('#dlgPrep [data-prep="normal"]');
    await page.click('#animalOk');
    const human = await page.evaluate(() => [document.querySelector('#vSys').textContent, document.querySelector('#vHr').textContent, document.querySelector('#unit').value, document.querySelector('#dose').value]);
    await pickDrug(page, 'adr', 'Adrenalina');
    await page.click('#giveBtn');
    await overflow(page, tag + ' humano', errs);
    // Terminar experimento
    await page.evaluate(() => document.querySelector('#menu [data-act="reset"]').click());
    await page.click('#resetOk');
    await page.click('#t-historial');
    const evCount = await page.evaluate(() => document.querySelectorAll('.ev').length);
    // Volver a rata normal para la siguiente ejecución
    await page.click('#t-registro'); await page.click('#animalBtn'); await page.click('#dlgSpecies [data-sp="rata"]'); await page.click('#animalOk');
    all.push({ tag, pithed, human, errs, conclusions: chk, csvEvents: csv.split('\n').length - 1, csvPoints: csv2.split('\n').length - 1, afterReset: evCount });
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(all, null, 1));
})();
