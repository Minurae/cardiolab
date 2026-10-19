(function () {
  'use strict';

  const CE = window.CardioEngine;
  const { DT, DRUGS, DRUG_BY_ID, CATEGORIES, BASE } = CE;

  /* ---------- Utilidades ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mq = q => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });
  const reduceMotion = mq('(prefers-reduced-motion: reduce)').matches;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('cardiolab:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cardiolab:' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d) => {
    d = d || 0;
    if (!isFinite(v)) return '–';
    const r = Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
    return (Object.is(r, -0) ? 0 : r).toFixed(d).replace('-', '−').replace('.', ',');
  };
  const sg = (v, d) => {
    d = d || 0;
    const r = Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
    if (r === 0) return '±0';
    return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(d).replace('.', ',');
  };
  const trimNum = (v, maxDec) => String(Number(Number(v).toFixed(maxDec === undefined ? 3 : maxDec))).replace('.', ',');
  const fmtT = s => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };
  const fmtUg = ug => ug >= 1000 ? trimNum(ug / 1000, 3) + ' mg' : trimNum(ug, ug < 1 ? 3 : 2) + ' µg';
  const parseNum = s => { const v = parseFloat(String(s).trim().replace(',', '.')); return isFinite(v) ? v : NaN; };
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/α/g, 'alfa a').replace(/β/g, 'beta b');
  const idxOf = t => Math.round(t / DT);
  const CAT_NAME = {}; CATEGORIES.forEach(c => { CAT_NAME[c.id] = c.name; });

  /* ---------- Estado ---------- */
  const state = {
    mode: LS.get('mode', 'imm') === 'live' ? 'live' : 'imm',
    running: true,
    speed: [1, 5, 20, 60].includes(LS.get('speed', 5)) ? LS.get('speed', 5) : 5,
    drugId: DRUG_BY_ID[LS.get('drug', 'adr')] ? LS.get('drug', 'adr') : 'adr',
    unit: 'µg',
    weight: LS.get('weight', 70),
    species: CE.SPECIES[LS.get('species', 'rata')] ? LS.get('species', 'rata') : 'rata',
    prep: CE.PREPS[LS.get('prep', 'normal')] ? LS.get('prep', 'normal') : 'normal',
    tab: 'registro',
    view: { span: Infinity, follow: true, x0: 0 },
    cursorT: null,
    order: LS.get('order', 'desc'),
    expanded: new Set(),
    replay: null,
    theme: ['dark', 'light', 'auto'].includes(LS.get('theme', 'dark')) ? LS.get('theme', 'dark') : 'dark'
  };
  let model = null;
  let session = null, sessionDirty = true, lastSessionAt = 0;

  function freshModel() { const m = new CE.Model({ species: state.species, prep: state.prep }); m.run(5); return m; }

  /* ---------- Colores del tema ---------- */
  const C = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    ['ink', 'ink-2', 'muted', 'line', 'line-strong', 'pres', 'pres-band', 'hr', 'surface', 'surface-2', 'surface-3', 'accent', 'grid', 'sym', 'vag', 'marker', 'marker-ink', 'spark', 'p1', 'p2', 'p3', 'p4', 'p5']
      .forEach(k => { C[k] = cs.getPropertyValue('--' + k).trim(); });
    chart.dirty = true;
  }
  function applyTheme() {
    const r = document.documentElement;
    const t = state.theme === 'auto' ? (mq('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : state.theme;
    r.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#ffffff' : '#000000');
    $('#themeLabel').textContent = 'Tema: ' + ({ auto: 'automático', light: 'claro', dark: 'oscuro' })[state.theme];
    readColors();
  }

  /* ---------- Aviso ---------- */
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hide');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hide'), 3200);
  }

  /* ==========================================================
     Tarjeta de administración
     ========================================================== */
  const adminEl = $('#adminTpl').content.firstElementChild.cloneNode(true);
  const doseIn = $('#dose', adminEl), unitSel = $('#unit', adminEl), weightIn = $('#weight', adminEl);

  function placeAdmin() {
    const slot = $('#slot-' + state.tab);
    if (slot && adminEl.parentNode !== slot) slot.appendChild(adminEl);
  }

  function renderDrugPick() {
    const d = DRUG_BY_ID[state.drugId];
    $('#dpCat', adminEl).textContent = CAT_NAME[d.cat];
    $('#dpName', adminEl).textContent = d.name;
    $('#dpMech', adminEl).textContent = d.mech;
    $('#dpDesc', adminEl).textContent = d.desc;
  }

  // Especie del animal actual y dosis habitual de cada fármaco en esa especie
  const SP = () => CE.SPECIES[model ? model.species : state.species] || CE.SPECIES.rata;
  const isRat = () => SP().id === 'rata';
  const defaultDose = d => isRat() ? d.ratDose : { dose: d.dose, unit: d.unit };
  const UNITS = { rata: ['µg/kg', 'mg/kg', 'µg', 'mg'], humano: ['µg', 'mg', 'µg/kg', 'mg/kg'] };

  function renderUnitOptions() {
    const keep = unitSel.value;
    unitSel.innerHTML = UNITS[SP().id].map(u => '<option value="' + u + '">' + u + '</option>').join('');
    if (UNITS[SP().id].indexOf(keep) >= 0) unitSel.value = keep;
  }

  function selectDrug(id) {
    const d = DRUG_BY_ID[id];
    const def = defaultDose(d);
    state.drugId = id;
    state.unit = def.unit;
    unitSel.value = def.unit;
    doseIn.value = trimNum(def.dose);
    LS.set('drug', id);
    renderDrugPick();
    updateDose();
  }

  function currentDose() {
    const sp = SP(), rat = sp.id === 'rata';
    const dose = parseNum(doseIn.value);
    const unit = unitSel.value;
    // En la rata el peso es fijo (300 g); en el humano se escribe
    const weight = rat ? sp.weight : parseNum(weightIn.value);
    const perKg = unit.indexOf('/kg') > 0;
    let err = '';
    if (!(dose > 0)) err = 'Escribe una dosis mayor que 0.';
    else if (perKg && !rat && !(weight > 0 && weight <= 400)) err = 'Escribe un peso entre 1 y 400 kg.';
    const ug = err ? NaN : CE.toMicrograms(dose, unit, weight);
    if (!err && !(ug > 0)) err = 'La dosis no es válida.';
    return { dose, unit, weight, perKg, rat, ug, err };
  }

  function perKgLabel(ugPerKg) {
    return ugPerKg >= 1000 ? trimNum(ugPerKg / 1000, 3) + ' mg/kg' : trimNum(ugPerKg, 3) + ' µg/kg';
  }

  function doseLabel(c) {
    let s = trimNum(c.dose) + ' ' + c.unit;
    if (c.rat) { if (!c.perKg) s += ' (' + perKgLabel(c.ug / c.weight) + ')'; }
    else if (c.perKg) s += ' (' + fmtUg(c.ug) + ' para ' + trimNum(c.weight, 1) + ' kg)';
    return s;
  }

  function updateDose() {
    state.unit = unitSel.value;
    const c = currentDose();
    const showWeight = c.perKg && !c.rat;
    $('#weightField', adminEl).hidden = !showWeight;
    $('#doseGrid', adminEl).classList.toggle('with-weight', showWeight);
    const eq = $('#doseEq', adminEl);
    if (c.err) eq.textContent = '';
    else {
      const d = DRUG_BY_ID[state.drugId];
      const def = defaultDose(d);
      const ratio = c.ug / CE.toMicrograms(def.dose, def.unit, c.weight);
      let t = '';
      if (c.rat) t = c.perKg ? 'Son ' + fmtUg(c.ug) + ' en una rata de 300 g. ' : 'Equivale a ' + perKgLabel(c.ug / c.weight) + '. ';
      else if (c.perKg || c.unit === 'mg') t = 'Equivale a ' + fmtUg(c.ug) + '. ';
      t += Math.abs(ratio - 1) < 0.005 ? 'Dosis habitual.' : trimNum(ratio, ratio < 1 ? 2 : 1) + ' veces la dosis habitual.';
      eq.textContent = t;
    }
    doseIn.removeAttribute('aria-invalid');
    $('#doseErr', adminEl).hidden = true;
  }

  function scaleDose(mul) {
    const d = DRUG_BY_ID[state.drugId];
    const def = defaultDose(d);
    if (mul === 'reset') { unitSel.value = def.unit; doseIn.value = trimNum(def.dose); updateDose(); return; }
    const v = parseNum(doseIn.value);
    const base = v > 0 ? v : def.dose;
    doseIn.value = trimNum(base * parseFloat(mul), 4);
    updateDose();
  }

  function administer() {
    const c = currentDose();
    if (c.err) {
      const e = $('#doseErr', adminEl);
      e.textContent = c.err; e.hidden = false;
      (c.err.indexOf('peso') >= 0 ? weightIn : doseIn).setAttribute('aria-invalid', 'true');
      return;
    }
    if (c.perKg && !c.rat) { state.weight = c.weight; LS.set('weight', c.weight); }
    const d = DRUG_BY_ID[state.drugId];
    const label = doseLabel(c);
    const evt = model.inject(d.id, c.ug, { doseLabel: label, dose: c.dose, unit: c.unit, weight: c.perKg && !c.rat ? c.weight : null, mode: state.mode });
    if (!evt) { toast('No se pudo administrar.'); return; }
    if (state.mode === 'imm') {
      const btn = $('#giveBtn', adminEl);
      btn.disabled = true;
      const secs = model.runUntilSettled(20, 150, d.id);
      btn.disabled = false;
      const span = Math.max(30, model.s.t - (evt.t - 10));
      state.view = { span, follow: true, x0: 0 };
      state.cursorT = null;
      syncRangeSeg();
      toast('#' + evt.n + ' ' + d.name + ' ' + label + ': respuesta registrada en ' + fmtT(secs));
      if (state.tab === 'fisio') startReplay(evt.n);
    } else {
      if (!state.running) setRunning(true);
      toast('#' + evt.n + ' ' + d.name + ' ' + label + ' administrada');
    }
    dataChanged(true);
  }

  function renderModeHint() {
    $('#modeHint', adminEl).textContent = (state.mode === 'imm'
      ? 'Modo inmediato: la simulación avanza hasta que la respuesta se estabiliza (entre 20 y 150 s).'
      : 'Modo en vivo: el fármaco actúa en tiempo real a la velocidad elegida. Puedes encadenar dosis sin esperar.') +
      (isRat() ? ' Las dosis van por kg de peso, como en la guía.' : '');
  }

  function animalText() {
    const sp = SP(), prep = CE.PREPS[model ? model.prepId : state.prep];
    const PREP_LABEL = { normal: 'Sin pretratamiento', reserpinizado: 'Animal reserpinizado', descentralizado: 'Animal descentralizado' };
    return { name: sp.name + ' ' + sp.detail, prep: PREP_LABEL[prep.id] || prep.name };
  }
  function renderAnimal() {
    const a = animalText();
    $('#animalName', adminEl).textContent = a.name;
    $('#animalPrep', adminEl).textContent = a.prep;
    renderUnitOptions();
  }

  // Diálogo para cambiar de animal (equivale a «terminar el experimento» de la guía)
  const animalDlg = $('#animalDlg');
  let dlgSpecies = state.species, dlgPrep = state.prep;
  function renderAnimalDlg() {
    $('#dlgSpecies').innerHTML = Object.values(CE.SPECIES).map(sp =>
      '<button type="button" data-sp="' + sp.id + '" aria-pressed="' + (sp.id === dlgSpecies) + '"><b>' + esc(sp.name) + '</b><span>' + esc(sp.detail) + '</span></button>').join('');
    $('#dlgPrep').innerHTML = Object.values(CE.PREPS).map(pr =>
      '<button type="button" data-prep="' + pr.id + '" aria-pressed="' + (pr.id === dlgPrep) + '"><b>' + esc(pr.name) + '</b></button>').join('');
    $('#dlgPrepDesc').textContent = CE.PREPS[dlgPrep].desc;
    $('#dlgWarn').hidden = !model.events.length;
  }
  function openAnimalDlg() {
    dlgSpecies = model.species; dlgPrep = model.prepId;
    renderAnimalDlg();
    if (animalDlg.showModal) animalDlg.showModal();
  }
  function startAnimal(species, prep) {
    const changedSpecies = species !== model.species;
    state.species = species; state.prep = prep;
    LS.set('species', species); LS.set('prep', prep);
    resetSession(true);
    renderAnimal();
    if (changedSpecies) selectDrug(state.drugId); else updateDose();
    renderModeHint();
    const a = animalText();
    toast('Animal nuevo: ' + a.name + ', ' + a.prep.toLowerCase());
  }

  /* ==========================================================
     Selector de fármacos
     ========================================================== */
  const sheet = $('#sheet');
  let sheetCat = 'all', lastFocus = null;
  const HAY = {};
  DRUGS.forEach(d => { HAY[d.id] = norm([d.name, d.mech, CAT_NAME[d.cat], d.desc, d.id].join(' ')); });

  function buildCatChips() {
    const box = $('#catChips');
    const cats = [{ id: 'all', name: 'Todas' }].concat(CATEGORIES);
    box.innerHTML = cats.map(c => '<button type="button" data-cat="' + c.id + '" aria-pressed="' + (c.id === sheetCat) + '">' + esc(c.name) + '</button>').join('');
  }

  function renderDrugList() {
    const q = norm($('#drugSearch').value.trim());
    const terms = q.split(/\s+/).filter(Boolean);
    const list = DRUGS.filter(d => (sheetCat === 'all' || d.cat === sheetCat) && terms.every(t => HAY[d.id].indexOf(t) >= 0));
    const box = $('#drugList');
    if (!list.length) {
      box.innerHTML = '<div class="drug-empty">Ningún fármaco coincide con «' + esc($('#drugSearch').value.trim()) + '». Prueba con el nombre o un receptor, por ejemplo «beta» o «M2».</div>';
      return;
    }
    const groups = CATEGORIES.map(c => ({ c, items: list.filter(d => d.cat === c.id) })).filter(g => g.items.length);
    box.innerHTML = groups.map(g =>
      '<div class="drug-group"><h3>' + esc(g.c.name) + '</h3>' +
      g.items.map(d =>
        '<button type="button" class="drug-item" role="option" data-id="' + d.id + '" aria-selected="' + (d.id === state.drugId) + '">' +
        '<span class="di-name">' + esc(d.name) + '</span>' +
        '<span class="di-dose">' + trimNum(defaultDose(d).dose) + ' ' + defaultDose(d).unit + '</span>' +
        '<span class="di-mech">' + esc(d.mech) + '</span></button>').join('') +
      '</div>').join('');
  }

  function openSheet() {
    lastFocus = document.activeElement;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#drugSearch').value = '';
    buildCatChips();
    renderDrugList();
    const sel = $('.drug-item[aria-selected="true"]', sheet);
    if (sel) sel.scrollIntoView({ block: 'center' });
    if (mq('(hover: hover)').matches) $('#drugSearch').focus(); else $('.sheet-panel .icon-btn').focus();
  }
  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ==========================================================
     Gráfica principal
     ========================================================== */
  const chart = { dirty: true, pointers: new Map(), pinch: null };
  const cv = $('#chart'), mini = $('#mini'), tip = $('#tip');

  function sizeCanvas(c) {
    const r = c.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 2 || h < 2) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function fullSpan() { return Math.max(model.s.t, 30); }
  function viewRange() {
    const T = model.s.t, v = state.view, full = fullSpan();
    if (v.span === Infinity) return [0, full];
    const span = v.span;
    if (v.follow) { const x1 = Math.max(T, span); return [x1 - span, x1]; }
    const x0 = clamp(v.x0, 0, Math.max(0, Math.max(full, span) - span));
    return [x0, x0 + span];
  }
  function setView(x0, span, keepFollowCheck) {
    const full = fullSpan();
    span = Math.max(5, span);
    if (span >= full * 0.999) { state.view = { span: Infinity, follow: true, x0: 0 }; }
    else {
      x0 = clamp(x0, 0, full - span);
      const follow = keepFollowCheck !== false && x0 + span >= model.s.t - 0.05;
      state.view = { span, follow, x0 };
    }
    chart.dirty = true;
    syncRangeSeg();
  }

  function syncRangeSeg() {
    const v = state.view;
    $$('#rangeSeg button').forEach(b => {
      const s = b.dataset.span === 'all' ? Infinity : +b.dataset.span;
      b.setAttribute('aria-pressed', String(s === v.span && (v.follow || s === Infinity)));
    });
    $('#toEnd').hidden = v.span === Infinity || v.follow;
  }

  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const f = x / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  function niceBounds(lo, hi, minSpan, floor) {
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 100; }
    let span = hi - lo;
    if (span < minSpan) { const c = (lo + hi) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; span = minSpan; }
    lo -= span * 0.1; hi += span * 0.1;
    const step = niceStep((hi - lo) / 4);
    lo = Math.max(floor, Math.floor(lo / step) * step);
    hi = Math.ceil(hi / step) * step;
    return { lo, hi, step };
  }
  const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

  function chartLayout(w, h) {
    const L = 40, R = 10, top = 46, bottom = 20, gap = 34;
    const avail = h - top - bottom - gap;
    const p1h = Math.round(avail * 0.6);
    return { L, R, x1: w - R, p1: { t: top, b: top + p1h }, p2: { t: top + p1h + gap, b: h - bottom } };
  }

  // Agrupa los puntos por columna de píxel (mín./máx.) para dibujar sesiones largas sin perder picos
  function columns(i0, i1, X) {
    const P = model.points, cols = [];
    let cur = null;
    for (let i = i0; i <= i1; i++) {
      const p = P[i];
      const x = X(p.t), cx = Math.round(x);
      if (!cur || cx !== cur.cx) {
        cur = { cx, x, sysMax: p.sys, diaMin: p.dia, mF: p.map, mMin: p.map, mMax: p.map, mL: p.map, hF: p.hr, hMin: p.hr, hMax: p.hr, hL: p.hr };
        cols.push(cur);
      } else {
        if (p.sys > cur.sysMax) cur.sysMax = p.sys;
        if (p.dia < cur.diaMin) cur.diaMin = p.dia;
        if (p.map < cur.mMin) cur.mMin = p.map; if (p.map > cur.mMax) cur.mMax = p.map;
        if (p.hr < cur.hMin) cur.hMin = p.hr; if (p.hr > cur.hMax) cur.hMax = p.hr;
        cur.mL = p.map; cur.hL = p.hr;
      }
    }
    return cols;
  }

  function drawChart() {
    const s = sizeCanvas(cv);
    if (!s) return false;
    const { ctx, w, h } = s;
    const P = model.points;
    const [x0, x1] = viewRange();
    const lay = chartLayout(w, h);
    const X = t => lay.L + (t - x0) / (x1 - x0) * (lay.x1 - lay.L);
    const i0 = clamp(Math.floor(x0 / DT) - 1, 0, P.length - 1);
    const i1 = clamp(Math.ceil(x1 / DT) + 1, 0, P.length - 1);
    const cols = columns(i0, i1, X);

    let pLo = Infinity, pHi = -Infinity, hLo = Infinity, hHi = -Infinity;
    cols.forEach(c => {
      if (c.diaMin < pLo) pLo = c.diaMin; if (c.sysMax > pHi) pHi = c.sysMax;
      if (c.hMin < hLo) hLo = c.hMin; if (c.hMax > hHi) hHi = c.hMax;
    });
    const yp = niceBounds(pLo, pHi, 40, 0), yh = niceBounds(hLo, hHi, 30, 0);
    const Yp = v => lay.p1.b - (v - yp.lo) / (yp.hi - yp.lo) * (lay.p1.b - lay.p1.t);
    const Yh = v => lay.p2.b - (v - yh.lo) / (yh.hi - yh.lo) * (lay.p2.b - lay.p2.t);
    chart.geo = { x0, x1, lay, X, Yp, Yh, w, h };

    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'middle';

    // Rejilla y ejes Y
    function grid(sc, Y, panel, title) {
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.fillStyle = C.muted; ctx.textAlign = 'right';
      for (let v = sc.lo; v <= sc.hi + 1e-9; v += sc.step) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(lay.L, y); ctx.lineTo(lay.x1, y); ctx.stroke();
        ctx.fillText(String(Math.round(v)), lay.L - 6, y);
      }
      ctx.textAlign = 'left'; ctx.fillStyle = C.muted;
      ctx.font = '600 10.5px ' + getComputedStyle(document.body).fontFamily;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.6px';
      ctx.fillText(title.toUpperCase(), lay.L, panel === lay.p1 ? 12 : panel.t - 13);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    }
    grid(yp, Yp, lay.p1, 'Presión arterial, mmHg');
    grid(yh, Yh, lay.p2, 'Frecuencia cardíaca, lpm');

    // Eje de tiempo
    const pxPerS = (lay.x1 - lay.L) / (x1 - x0);
    const tStep = TIME_STEPS.find(s => s * pxPerS >= 64) || 7200;
    ctx.fillStyle = C.muted; ctx.textAlign = 'center';
    for (let t = Math.ceil(x0 / tStep) * tStep; t <= x1 + 1e-6; t += tStep) {
      const x = X(t);
      if (x < lay.L + 10 || x > lay.x1 - 12) continue;
      ctx.fillText(fmtT(t), x, h - 8);
      ctx.strokeStyle = C.grid; ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, lay.p2.b); ctx.lineTo(Math.round(x) + 0.5, lay.p2.b + 4); ctx.stroke();
    }

    // Marcadores de administración (líneas)
    const evs = model.events.filter(e => e.t >= x0 - 1e-6 && e.t <= x1 + 1e-6);
    ctx.save();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = C['line-strong']; ctx.lineWidth = 1;
    evs.forEach(e => {
      const x = Math.round(X(e.t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, lay.p1.t - 2); ctx.lineTo(x, lay.p1.b); ctx.moveTo(x, lay.p2.t); ctx.lineTo(x, lay.p2.b); ctx.stroke();
    });
    ctx.restore();

    // Recorte por panel
    function clip(panel, fn) {
      ctx.save(); ctx.beginPath(); ctx.rect(lay.L, panel.t - 2, lay.x1 - lay.L, panel.b - panel.t + 4); ctx.clip(); fn(); ctx.restore();
    }
    if (cols.length) {
      clip(lay.p1, () => {
        // Banda SIS–DIA
        ctx.beginPath();
        cols.forEach((c, i) => { const y = Yp(c.sysMax); i ? ctx.lineTo(c.x, y) : ctx.moveTo(c.x, y); });
        for (let i = cols.length - 1; i >= 0; i--) ctx.lineTo(cols[i].x, Yp(cols[i].diaMin));
        ctx.closePath(); ctx.fillStyle = C['pres-band']; ctx.fill();
        // Bordes de la banda
        ctx.lineWidth = 1; ctx.strokeStyle = C.pres; ctx.globalAlpha = 0.45;
        ctx.beginPath(); cols.forEach((c, i) => { const y = Yp(c.sysMax); i ? ctx.lineTo(c.x, y) : ctx.moveTo(c.x, y); }); ctx.stroke();
        ctx.beginPath(); cols.forEach((c, i) => { const y = Yp(c.diaMin); i ? ctx.lineTo(c.x, y) : ctx.moveTo(c.x, y); }); ctx.stroke();
        ctx.globalAlpha = 1;
        // PAM
        ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = C.pres;
        ctx.beginPath();
        cols.forEach((c, i) => {
          if (i) ctx.lineTo(c.x, Yp(c.mF)); else ctx.moveTo(c.x, Yp(c.mF));
          if (c.mMax !== c.mMin) { ctx.lineTo(c.x, Yp(c.mMax)); ctx.lineTo(c.x, Yp(c.mMin)); }
          ctx.lineTo(c.x, Yp(c.mL));
        });
        ctx.stroke();
      });
      clip(lay.p2, () => {
        ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = C.hr;
        ctx.beginPath();
        cols.forEach((c, i) => {
          if (i) ctx.lineTo(c.x, Yh(c.hF)); else ctx.moveTo(c.x, Yh(c.hF));
          if (c.hMax !== c.hMin) { ctx.lineTo(c.x, Yh(c.hMax)); ctx.lineTo(c.x, Yh(c.hMin)); }
          ctx.lineTo(c.x, Yh(c.hL));
        });
        ctx.stroke();
      });
    }

    // Insignias numeradas
    ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center';
    let lastX = -Infinity;
    const triY = lay.p1.t - 1;
    evs.forEach(e => {
      const x = X(e.t);
      const label = String(e.n);
      const wLab = ctx.measureText(label).width + 8;
      ctx.fillStyle = C.marker;
      ctx.beginPath(); ctx.moveTo(x - 5, triY - 8); ctx.lineTo(x + 5, triY - 8); ctx.lineTo(x, triY); ctx.closePath(); ctx.fill();
      if (x - lastX < Math.max(18, wLab)) return;
      lastX = x;
      ctx.fillStyle = C.ink; ctx.fillText(label, x, triY - 17);
    });

    // Cursor
    drawCursor(ctx);
    return true;
  }

  function lastEventAt(t) {
    const ev = model.events;
    for (let i = ev.length - 1; i >= 0; i--) if (ev[i].t <= t + 1e-6) return ev[i];
    return null;
  }

  function drawCursor(ctx) {
    const g = chart.geo;
    if (state.cursorT === null || !g || state.cursorT < g.x0 || state.cursorT > g.x1) { tip.hidden = true; return; }
    const i = clamp(idxOf(state.cursorT), 0, model.points.length - 1);
    const p = model.points[i];
    const x = Math.round(g.X(p.t)) + 0.5, lay = g.lay;
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, lay.p1.t - 2); ctx.lineTo(x, lay.p1.b); ctx.moveTo(x, lay.p2.t); ctx.lineTo(x, lay.p2.b); ctx.stroke();
    ctx.globalAlpha = 1;
    const dot = (y, col, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.surface; ctx.stroke(); };
    dot(g.Yp(p.sys), C.pres, 3.5); dot(g.Yp(p.dia), C.pres, 3.5); dot(g.Yp(p.map), C.pres, 4.5); dot(g.Yh(p.hr), C.hr, 4.5);

    const ev = lastEventAt(p.t);
    let evHtml = '';
    if (ev) evHtml = '<div class="tip-ev">Tras #' + ev.n + ' ' + esc(DRUG_BY_ID[ev.drugId].name) + ', +' + fmtT(p.t - ev.t) + '</div>';
    tip.innerHTML =
      '<div class="tip-t">t ' + fmtT(p.t) + '</div>' +
      '<div class="tip-row"><i style="background:' + C.pres + ';height:6px;opacity:.6"></i>SIS/DIA<b>' + nf(p.sys) + '/' + nf(p.dia) + '</b></div>' +
      '<div class="tip-row"><i style="background:' + C.pres + '"></i>PAM<b>' + nf(p.map) + ' mmHg</b></div>' +
      '<div class="tip-row"><i style="background:' + C.hr + '"></i>FC<b>' + nf(p.hr) + ' lpm</b></div>' + evHtml;
    tip.hidden = false;
    const tw = tip.offsetWidth, cw = g.w;
    let left = x + 14;
    if (left + tw > cw - 4) left = x - 14 - tw;
    tip.style.left = clamp(left, 2, cw - tw - 2) + 'px';
  }

  function drawMini() {
    const s = sizeCanvas(mini);
    if (!s) return;
    const { ctx, w, h } = s;
    const P = model.points, full = fullSpan();
    const pad = 2;
    const X = t => pad + t / full * (w - pad * 2);
    const cols = columns(0, P.length - 1, X);
    let lo = Infinity, hi = -Infinity;
    cols.forEach(c => { if (c.mMin < lo) lo = c.mMin; if (c.mMax > hi) hi = c.mMax; });
    if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
    const Y = v => h - 6 - (v - lo) / (hi - lo) * (h - 14);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C['surface-2'];
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 8); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
    // Traza de PAM
    ctx.strokeStyle = C.pres; ctx.lineWidth = 1.25; ctx.globalAlpha = 0.85;
    ctx.beginPath();
    cols.forEach((c, i) => { if (i) ctx.lineTo(c.x, Y(c.mMax)); else ctx.moveTo(c.x, Y(c.mMax)); ctx.lineTo(c.x, Y(c.mMin)); });
    ctx.stroke(); ctx.globalAlpha = 1;
    // Administraciones
    ctx.fillStyle = C.marker;
    model.events.forEach(e => { const x = X(e.t); ctx.fillRect(Math.round(x) - 0.5, 1, 1.5, 5); });
    // Ventana
    const [x0, x1] = viewRange();
    const bx0 = X(Math.max(0, x0)), bx1 = X(Math.min(full, x1));
    ctx.fillStyle = C.ink; ctx.globalAlpha = 0.07;
    ctx.fillRect(1, 1, Math.max(0, bx0 - 1), h - 2); ctx.fillRect(bx1, 1, Math.max(0, w - 1 - bx1), h - 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
    roundRect(ctx, bx0, 1.5, Math.max(4, bx1 - bx0), h - 3, 6); ctx.stroke();
    ctx.fillStyle = C.accent;
    [bx0, bx1].forEach(x => { roundRect(ctx, x - 2.5, h / 2 - 9, 5, 18, 2.5); ctx.fill(); });
    chart.miniGeo = { X, full, w, pad, bx0, bx1 };
    mini.setAttribute('aria-valuenow', String(Math.round(x0 / full * 100)));
    mini.setAttribute('aria-valuetext', 'De ' + fmtT(x0) + ' a ' + fmtT(Math.min(x1, full)));
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function renderViewLabel() {
    const [x0, x1] = viewRange();
    const full = fullSpan();
    $('#viewLabel').textContent = state.view.span === Infinity
      ? 'Sesión completa, ' + fmtT(model.s.t)
      : 'Mostrando ' + fmtT(x0) + ' a ' + fmtT(Math.min(x1, Math.max(full, x1)));
  }

  // Interacción con la gráfica: tocar/pasar = cursor, rueda o pellizco = zoom
  function tAtClientX(clientX) {
    const g = chart.geo; if (!g) return null;
    const r = cv.getBoundingClientRect();
    const x = clamp(clientX - r.left, g.lay.L, g.lay.x1);
    return g.x0 + (x - g.lay.L) / (g.lay.x1 - g.lay.L) * (g.x1 - g.x0);
  }
  function setCursorFromEvent(e) {
    const t = tAtClientX(e.clientX);
    if (t === null) return;
    state.cursorT = clamp(t, 0, model.s.t);
    chart.dirty = true;
  }
  cv.addEventListener('pointerdown', e => {
    chart.pointers.set(e.pointerId, e.clientX);
    if (chart.pointers.size === 2) {
      const xs = Array.from(chart.pointers.values());
      const [a, b] = viewRange();
      chart.pinch = { d0: Math.abs(xs[0] - xs[1]) || 1, tMid: tAtClientX((xs[0] + xs[1]) / 2), frac: null, span0: b - a };
      const r = cv.getBoundingClientRect(), g = chart.geo;
      chart.pinch.frac = ((xs[0] + xs[1]) / 2 - r.left - g.lay.L) / (g.lay.x1 - g.lay.L);
      state.cursorT = null;
      return;
    }
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignorar */ }
    setCursorFromEvent(e);
  });
  cv.addEventListener('pointermove', e => {
    if (chart.pointers.has(e.pointerId)) chart.pointers.set(e.pointerId, e.clientX);
    if (chart.pinch && chart.pointers.size === 2) {
      const xs = Array.from(chart.pointers.values());
      const d = Math.abs(xs[0] - xs[1]) || 1;
      const span = clamp(chart.pinch.span0 * chart.pinch.d0 / d, 5, fullSpan());
      setView(chart.pinch.tMid - chart.pinch.frac * span, span);
      return;
    }
    if (e.pointerType === 'mouse' || chart.pointers.has(e.pointerId)) setCursorFromEvent(e);
  });
  const endPointer = e => {
    chart.pointers.delete(e.pointerId);
    if (chart.pointers.size < 2) chart.pinch = null;
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') { state.cursorT = null; chart.dirty = true; }
  });
  cv.addEventListener('wheel', e => {
    if (!chart.geo) return;
    e.preventDefault();
    const [a, b] = viewRange();
    const t = tAtClientX(e.clientX);
    const k = Math.exp((e.deltaY || 0) * 0.0018);
    const span = clamp((b - a) * k, 5, fullSpan());
    const frac = (t - a) / (b - a);
    setView(t - frac * span, span);
  }, { passive: false });
  cv.addEventListener('dblclick', () => { state.view = { span: Infinity, follow: true, x0: 0 }; syncRangeSeg(); chart.dirty = true; });

  // Minivista: arrastrar ventana, redimensionar por los bordes o tocar para centrar
  let miniDrag = null;
  mini.addEventListener('pointerdown', e => {
    const g = chart.miniGeo; if (!g) return;
    const r = mini.getBoundingClientRect();
    const x = e.clientX - r.left;
    const toT = px => (px - g.pad) / (g.w - g.pad * 2) * g.full;
    const [a, b] = viewRange();
    const span = Math.min(b - a, g.full);
    let mode = 'move', off;
    if (Math.abs(x - g.bx0) < 12 && g.bx1 - g.bx0 > 24) mode = 'l';
    else if (Math.abs(x - g.bx1) < 12 && g.bx1 - g.bx0 > 24) mode = 'r';
    else if (x < g.bx0 || x > g.bx1) {
      const s = span >= g.full * 0.999 ? Math.max(10, g.full * 0.25) : span;
      setView(toT(x) - s / 2, s);
    }
    const [na, nb] = viewRange();
    off = toT(x) - na;
    miniDrag = { mode, off, toT, a: na, b: nb };
    try { mini.setPointerCapture(e.pointerId); } catch (err) { /* ignorar */ }
    e.preventDefault();
  });
  mini.addEventListener('pointermove', e => {
    if (!miniDrag) return;
    const r = mini.getBoundingClientRect();
    const t = miniDrag.toT(e.clientX - r.left);
    const d = miniDrag;
    if (d.mode === 'move') setView(t - d.off, d.b - d.a);
    else if (d.mode === 'l') { const a = clamp(t, 0, d.b - 5); setView(a, d.b - a); }
    else { const b = clamp(t, d.a + 5, fullSpan()); setView(d.a, b - d.a); }
  });
  const miniEnd = () => { miniDrag = null; };
  mini.addEventListener('pointerup', miniEnd);
  mini.addEventListener('pointercancel', miniEnd);
  mini.addEventListener('keydown', e => {
    const [a, b] = viewRange(); const span = b - a; let x0 = a;
    if (e.key === 'ArrowLeft') x0 = a - span * 0.2;
    else if (e.key === 'ArrowRight') x0 = a + span * 0.2;
    else if (e.key === 'Home') x0 = 0;
    else if (e.key === 'End') x0 = fullSpan() - span;
    else return;
    e.preventDefault();
    setView(x0, span);
  });

  /* ==========================================================
     Constantes
     ========================================================== */
  function renderVitals() {
    const p = model.points[model.points.length - 1];
    $('#vSys').textContent = nf(p.sys); $('#vDia').textContent = nf(p.dia);
    $('#vMap').textContent = nf(p.map); $('#vHr').textContent = nf(p.hr);
    $('#vT').textContent = fmtT(p.t);
  }

  /* ==========================================================
     Fisiología animada
     ========================================================== */
  const phys = {
    phase: 0, lumen: 56, pxAcc: 0, buf: null, head: 0, yLo: 40, yHi: 160,
    lanes: { sym: { acc: 0, spikes: [] }, vag: { acc: 0, spikes: [] } }, frame: 0, built: false
  };
  const REC_ROWS = [
    ['a1', 'α1', 'a1'], ['a2', 'α2', 'a2'], ['b1', 'β1', 'b1'], ['b2', 'β2', 'b2'],
    ['m2', 'M2', 'm'], ['m3', 'M3', 'm'], ['n', 'Nicotínico', 'n'], ['h1', 'H1', 'h1'],
    ['d1', 'D1', null], ['v1', 'V1', null], ['at1', 'AT1', 'at1'], ['no', 'NO', null]
  ];

  function buildPhysio() {
    if (phys.built) return;
    phys.built = true;
    const NS = 'http://www.w3.org/2000/svg';
    const cells = $('#artCells');
    phys.cells = [];
    for (let i = 0; i < 18; i++) {
      const el = document.createElementNS(NS, 'ellipse');
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'var(--wall-cell)'); el.setAttribute('stroke-width', '1.4');
      cells.appendChild(el); phys.cells.push(el);
    }
    const rbc = $('#artRbc');
    phys.rbc = [];
    for (let i = 0; i < 7; i++) {
      const g = document.createElementNS(NS, 'g');
      const o = document.createElementNS(NS, 'circle'); o.setAttribute('r', '7.5'); o.setAttribute('fill', 'none'); o.setAttribute('stroke', 'var(--rbc)'); o.setAttribute('stroke-width', '1.4');
      const c = document.createElementNS(NS, 'circle'); c.setAttribute('r', '2.6'); c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'var(--rbc)'); c.setAttribute('stroke-width', '1'); c.setAttribute('opacity', '.6');
      g.appendChild(o); g.appendChild(c); rbc.appendChild(g);
      phys.rbc.push({ el: g, a: Math.random() * Math.PI * 2, f: 0.2 + Math.random() * 0.75, w: (Math.random() - 0.5) * 0.6, ph: Math.random() * 6 });
    }
    $('#recList').innerHTML = REC_ROWS.map(r =>
      '<div class="rec" data-r="' + r[0] + '"><span class="rec-name">' + r[1] + '</span><span class="rec-bar"><i></i><s></s></span><span class="rec-val">0 %</span></div>').join('');
    phys.recEls = $$('#recList .rec').map(el => ({ el, bar: $('i', el), base: $('s', el), val: $('.rec-val', el) }));
  }

  function physioPoint() {
    if (state.replay) {
      const r = state.replay;
      const now = performance.now();
      const f = clamp((now - r.start) / r.dur, 0, 1);
      const t = r.t0 + f * (r.t1 - r.t0);
      $('#rpProg').style.width = (f * 100) + '%';
      $('#rpSub').textContent = 't ' + fmtT(t) + ' (' + (t >= r.evtT ? '+' : '−') + fmtT(Math.abs(t - r.evtT)) + ' desde la dosis)';
      if (f >= 1) stopReplay(true);
      return model.points[clamp(idxOf(t), 0, model.points.length - 1)];
    }
    return model.points[model.points.length - 1];
  }

  function startReplay(n) {
    const ev = model.events.find(e => e.n === n) || model.events[model.events.length - 1];
    if (!ev) return;
    const i = model.events.indexOf(ev);
    const end = i + 1 < model.events.length ? model.events[i + 1].t : model.s.t;
    const t0 = Math.max(0, ev.t - 4), t1 = end;
    state.replay = { t0, t1, evtT: ev.t, start: performance.now(), dur: clamp((t1 - t0) / 12, 4, 14) * 1000 };
    $('#rpTitle').textContent = 'Repitiendo #' + ev.n + ' ' + DRUG_BY_ID[ev.drugId].name;
    $('#rpBtn').textContent = 'Detener';
  }
  function stopReplay(finished) {
    state.replay = null;
    $('#rpTitle').textContent = finished ? 'Respuesta completa, estado actual' : 'Estado actual';
    $('#rpProg').style.width = '0';
    syncReplayBtn();
  }
  function syncReplayBtn() {
    const btn = $('#rpBtn');
    const last = model.events[model.events.length - 1];
    if (state.replay) { btn.textContent = 'Detener'; btn.disabled = false; return; }
    btn.disabled = !last;
    btn.textContent = last ? 'Repetir #' + last.n + ' ' + DRUG_BY_ID[last.drugId].name : 'Repetir respuesta';
    if (!state.replay) $('#rpSub').textContent = 't ' + fmtT(model.s.t) + (state.mode === 'live' ? (state.running ? ', en curso' : ', en pausa') : '');
  }

  function wave(ph) {
    if (ph < 0.13) return 0.5 - 0.5 * Math.cos(Math.PI * ph / 0.13);
    const u = ph - 0.13;
    let s = Math.exp(-u * 3.4);
    s += 0.1 * Math.exp(-Math.pow((ph - 0.4) / 0.045, 2)) - 0.07 * Math.exp(-Math.pow((ph - 0.33) / 0.02, 2));
    const end = Math.exp(-0.87 * 3.4);
    return (s - end) / (1 - end);
  }
  const contraction = ph => ph < 0.32 ? Math.sin(Math.PI * ph / 0.32) : 0;

  /* Corazón de partículas: una constelación de triángulos en contorno (el gesto
     distintivo de la guía de estilo) que se contrae con cada latido */
  const heartP = { built: false, parts: [], t: 0 };
  function heartCurve(t) {
    return [16 * Math.pow(Math.sin(t), 3), -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  }
  function buildHeart() {
    const poly = [];
    for (let i = 0; i < 240; i++) poly.push(heartCurve(i / 240 * Math.PI * 2));
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const parts = [];
    const add = (x, y, kind) => parts.push({ x, y, kind, s: 0.32 + rnd() * 0.5, rot: rnd() * Math.PI * 2, spin: (rnd() - 0.5) * 0.6, col: Math.floor(rnd() * 5), tw: rnd() * Math.PI * 2, d: rnd() });
    while (parts.length < 380) { const x = -17 + rnd() * 34, y = -13 + rnd() * 30; if (inside(x, y)) add(x, y, 0); }
    for (let i = 0; i < 170; i++) { const [x, y] = heartCurve(rnd() * Math.PI * 2); add(x + (rnd() - 0.5) * 1.6, y + (rnd() - 0.5) * 1.6, 0); }
    for (let i = 0; i < 70; i++) { const a = rnd() * Math.PI * 2, r = 19 + rnd() * 12; add(Math.cos(a) * r * 1.2, 2 + Math.sin(a) * r * 0.9, 1); }
    heartP.parts = parts; heartP.built = true;
  }
  function drawHeart(dt, c, contr) {
    if (!heartP.built) buildHeart();
    const s = sizeCanvas($('#heartCv'));
    if (!s) return;
    const { ctx, w, h } = s;
    heartP.t += dt;
    const cols = [C.p1, C.p2, C.p3, C.p4, C.p5];
    const unit = Math.min(w / 46, h / 40);
    const cx = w / 2, cy = h / 2 - unit * 1.5;
    const squeeze = 1 - 0.085 * c * Math.sqrt(contr);
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    heartP.parts.forEach(q => {
      let k = 1, alpha;
      if (q.kind === 0) {
        // Contracción hacia el centro, más marcada en el borde
        k = squeeze - 0.02 * c * q.d;
        alpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(heartP.t * 1.3 + q.tw)) * (0.6 + 0.4 * c);
      } else {
        alpha = 0.22 + 0.12 * Math.sin(heartP.t * 0.8 + q.tw);
      }
      const drift = q.kind === 1 && !reduceMotion ? Math.sin(heartP.t * 0.25 + q.tw) * 0.6 : 0;
      const x = cx + (q.x + drift) * unit * k, y = cy + (q.y + drift * 0.5) * unit * k;
      const r = q.s * unit * 0.55 * (q.kind === 0 ? 1 + 0.25 * c : 0.8);
      const a = q.rot + (reduceMotion ? 0 : heartP.t * q.spin);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.strokeStyle = cols[q.col];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let v = 0; v < 3; v++) {
        const ang = a + v * 2.0944;
        const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
        if (v) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function stepPhysio(dt) {
    buildPhysio();
    const p = physioPoint();
    const hr = p.hr, pp = p.sys - p.dia;
    const fam = 'px ' + getComputedStyle(document.body).fontFamily;

    // Onda de pulso (barrido tipo monitor)
    const s = sizeCanvas($('#pulse'));
    if (s) {
      const { ctx, w, h } = s;
      if (!phys.buf || phys.buf.length !== w) { phys.buf = new Float32Array(w).fill(NaN); phys.head = 0; }
      const speed = isRat() ? 240 : 90;
      if (reduceMotion) {
        for (let i = 0; i < w; i++) { const ph = (i / speed * hr / 60) % 1; phys.buf[i] = p.dia + pp * wave(ph); }
        phys.phase = 0.6;
      } else {
        phys.pxAcc += speed * dt;
        let n = Math.floor(phys.pxAcc); phys.pxAcc -= n;
        n = Math.min(n, w);
        for (let k = 0; k < n; k++) {
          phys.phase += hr / 60 / speed;
          if (phys.phase >= 1) phys.phase -= 1;
          phys.buf[phys.head] = p.dia + pp * wave(phys.phase);
          phys.head = (phys.head + 1) % w;
          for (let g = 0; g < 14; g++) phys.buf[(phys.head + g) % w] = NaN;
        }
      }
      // Escala vertical suave
      const tLo = Math.floor((p.dia - 15) / 20) * 20, tHi = Math.ceil((p.sys + 15) / 20) * 20;
      const a = 1 - Math.exp(-dt * 2.5);
      phys.yLo += (tLo - phys.yLo) * a; phys.yHi += (tHi - phys.yHi) * a;
      const Y = v => h - 6 - (v - phys.yLo) / (phys.yHi - phys.yLo) * (h - 12);
      ctx.clearRect(0, 0, w, h);
      ctx.font = '11' + fam; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const step = phys.yHi - phys.yLo > 140 ? 40 : 20;
      for (let v = Math.ceil(phys.yLo / step) * step; v <= phys.yHi; v += step) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.fillStyle = C.muted; ctx.fillText(String(v), 0, y);
      }
      ctx.strokeStyle = C.pres; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      for (let i = 30; i < w; i++) {
        const v = phys.buf[i];
        if (isNaN(v)) { pen = false; continue; }
        const y = Y(v);
        if (pen) ctx.lineTo(i, y); else { ctx.moveTo(i, y); pen = true; }
      }
      ctx.stroke();
      if (!reduceMotion) {
        const hx = (phys.head - 1 + w) % w, hv = phys.buf[hx];
        if (!isNaN(hv) && hx >= 30) { ctx.fillStyle = C.pres; ctx.beginPath(); ctx.arc(hx, Y(hv), 3.5, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    // Corazón
    const c = reduceMotion ? 0 : contraction(phys.phase);
    const contr = clamp(p.contr, 0.3, 2.5);
    drawHeart(dt, c, contr);

    // Arteriola: el radio de la luz sigue a la resistencia (Poiseuille, R ∝ 1/r⁴), exagerado para que se vea
    const target = clamp(56 * Math.pow(p.svr, -0.85), 14, 74);
    phys.lumen += (target - phys.lumen) * (1 - Math.exp(-dt * 3));
    const rl = phys.lumen * (1 + (reduceMotion ? 0 : 0.035 * c * clamp(pp / 40, 0.2, 2.5)));
    const outer = 84;
    const wall = outer - rl;
    $('#artMedia').setAttribute('r', ((outer + rl) / 2).toFixed(2));
    $('#artMedia').setAttribute('stroke-width', wall.toFixed(2));
    $('#artLumen').setAttribute('r', rl.toFixed(2));
    $('#artEndo').setAttribute('r', rl.toFixed(2));
    const rm = (outer + rl) / 2;
    const segLen = 2 * Math.PI * rm / phys.cells.length;
    phys.cells.forEach((el, i) => {
      const ang = i / phys.cells.length * 360 + 5;
      const rad = ang * Math.PI / 180;
      el.setAttribute('cx', (100 + rm * Math.cos(rad)).toFixed(2));
      el.setAttribute('cy', (100 + rm * Math.sin(rad)).toFixed(2));
      el.setAttribute('rx', clamp(segLen * 0.42, 3, 30).toFixed(2));
      el.setAttribute('ry', clamp(wall * 0.26, 1.5, 14).toFixed(2));
      el.setAttribute('transform', 'rotate(' + (ang + 90).toFixed(1) + ' ' + (100 + rm * Math.cos(rad)).toFixed(2) + ' ' + (100 + rm * Math.sin(rad)).toFixed(2) + ')');
    });
    const k = clamp(rl / 56, 0.45, 1.15);
    const flow = clamp(p.co / 5, 0.2, 3);
    phys.rbc.forEach(b => {
      if (!reduceMotion) { b.a += dt * (0.35 + b.w) * flow; b.ph += dt * 1.3; }
      const rr = Math.max(0, rl - 9 * k) * clamp(b.f + 0.08 * Math.sin(b.ph), 0, 1);
      b.el.setAttribute('transform', 'translate(' + (100 + rr * Math.cos(b.a)).toFixed(2) + ' ' + (100 + rr * Math.sin(b.a)).toFixed(2) + ') scale(' + k.toFixed(3) + ')');
    });

    // Nervios autonómicos
    const sym = p.sym * p.gT, vag = p.vag * p.gT;
    [['sym', sym, 2.6, $('#laneSym'), C.sym], ['vag', vag, 3.2, $('#laneVag'), C.vag]].forEach(([key, tone, base, canvas, col]) => {
      const lane = phys.lanes[key];
      const rate = Math.min(28, base * tone);
      if (!reduceMotion) {
        lane.acc += rate * dt * (0.7 + 0.6 * Math.random());
        while (lane.acc >= 1) { lane.spikes.push(0); lane.acc -= 1; }
        lane.spikes = lane.spikes.map(x => x + dt / 1.1).filter(x => x < 1);
      }
      const sz = sizeCanvas(canvas);
      if (!sz) return;
      const { ctx, w, h } = sz;
      ctx.clearRect(0, 0, w, h);
      const y = h / 2;
      ctx.strokeStyle = C['line-strong']; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(w - 4, y); ctx.stroke();
      const spikes = reduceMotion ? Array.from({ length: Math.min(12, Math.round(rate)) }, (_, i) => (i + 0.5) / Math.max(1, Math.min(12, Math.round(rate)))) : lane.spikes;
      spikes.forEach(x => {
        const px = 4 + x * (w - 8);
        const g = ctx.createLinearGradient(px - 22, 0, px, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, col);
        ctx.strokeStyle = g; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(Math.max(4, px - 22), y); ctx.lineTo(px, y); ctx.stroke();
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(px, y - 8); ctx.lineTo(px + 3, y); ctx.lineTo(px, y + 8); ctx.lineTo(px - 2, y); ctx.closePath(); ctx.fill();
      });
    });

    // Textos (a menor frecuencia)
    phys.frame++;
    if (phys.frame % 6 === 1) {
      $('#fHr').textContent = nf(hr);
      $('#fContr').textContent = nf(p.contr, 2);
      $('#fSvr').textContent = nf(p.svr, 2);
      const st = $('#fSvrState');
      if (p.svr > 1.08) { st.textContent = 'Vasoconstricción'; st.className = 'state-pill up'; }
      else if (p.svr < 0.92) { st.textContent = 'Vasodilatación'; st.className = 'state-pill down'; }
      else { st.textContent = 'Tono basal'; st.className = 'state-pill'; }
      if (isRat()) {
        $('#fCo').textContent = nf(p.co * 1000); $('#fCoU').textContent = 'mL/min';
        $('#fSv').textContent = nf(p.sv, 2);
      } else {
        $('#fCo').textContent = nf(p.co, 1); $('#fCoU').textContent = 'L/min';
        $('#fSv').textContent = nf(p.sv);
      }
      $('#fMap').textContent = nf(p.map);
      $('#fPp').textContent = nf(pp);
      $('#fPulse').textContent = nf(p.sys) + '/' + nf(p.dia) + ' mmHg';
      const toneTxt = v => '×' + nf(v, 2) + (v > 1.12 ? ' aumentado' : v < 0.88 ? ' reducido' : ' basal');
      $('#mSym').style.width = clamp(sym / 3, 0, 1) * 100 + '%';
      $('#mVag').style.width = clamp(vag / 3, 0, 1) * 100 + '%';
      $('#vSym').textContent = toneTxt(sym);
      $('#vVag').textContent = toneTxt(vag);
      $('#toneNote').textContent = model.prepId === 'descentralizado'
        ? 'Animal descentralizado: sin sistema nervioso central no hay barorreflejo ni tono vagal, y el tono simpático es mínimo. Los fármacos actúan sin que nada compense.'
        : p.gT < 0.6
        ? 'La transmisión ganglionar está bloqueada (' + nf(p.gT * 100) + ' % de la basal): ni el simpático ni el vago llegan a sus órganos y el barorreflejo no puede compensar.'
        : 'La marca indica el tono basal. El barorreflejo sube el tono simpático y baja el vagal cuando la presión cae, y al revés cuando sube.';
      const base = model.points[0];
      phys.recEls.forEach((r, i) => {
        const [key, , bk] = REC_ROWS[i];
        const e = p.E[key] || 0, blk = bk ? (p.B[bk] || 0) : 0;
        r.bar.style.width = (e * 100) + '%';
        r.base.style.left = 'calc(' + ((base.E[key] || 0) * 100) + '% - 1px)';
        const blocked = blk > 0.3;
        r.el.classList.toggle('blocked', blocked);
        r.val.textContent = blocked ? 'Bloq. ' + nf(blk * 100) + ' %' : nf(e * 100) + ' %';
      });
      const t = p.t;
      if (!state.replay || phys.frame % 30 === 1) {
        const act = state.replay ? [] : model.activeDrugs(0.15).sort((a, b) => b.rel - a.rel);
        $('#activeDrugs').innerHTML = state.replay
          ? '<span class="card-sub">Durante la repetición se muestran solo los valores registrados.</span>'
          : act.length ? act.map(a => '<span class="chip drug">' + esc(DRUG_BY_ID[a.id].name) + '</span>').join('') : '<span class="card-sub">Ninguno. El sujeto está en condiciones basales.</span>';
      }
      const other = [];
      if (p.B.net > 0.3) other.push('Recaptación NET bloqueada ' + nf(p.B.net * 100) + ' %');
      if (p.B.ca > 0.2) other.push('Canales de Ca²⁺ bloqueados ' + nf(p.B.ca * 100) + ' %');
      if (p.B.ache > 0.2) other.push('AChE inhibida ' + nf(p.B.ache * 100) + ' %');
      if (p.B.res > 0.15) other.push('Depósitos de NA al ' + nf((1 - p.B.res) * 100) + ' %');
      $('#otherBlocksWrap').hidden = !other.length;
      $('#otherBlocks').innerHTML = other.map(o => '<span class="chip block">' + esc(o) + '</span>').join('');
      if (!state.replay && phys.frame % 30 === 1) syncReplayBtn();
      void t;
    }
  }

  /* ==========================================================
     Historial y sesión
     ========================================================== */
  function getSession(force) {
    if (!session || sessionDirty || force) {
      session = CE.interpretSession(model);
      sessionDirty = false;
      lastSessionAt = performance.now();
    }
    return session;
  }

  const controlTraceCache = new Map();
  // Traza de la respuesta control con el mismo protocolo que controlResponse (sujeto sin fármacos previos)
  function controlTrace(drugId, ug) {
    const key = drugId + ':' + ug.toPrecision(6) + ':' + model.species + ':' + model.prepId;
    if (controlTraceCache.has(key)) return controlTraceCache.get(key);
    const m = new CE.Model({ species: model.species, prep: model.prepId });
    m.run(2);
    const t0 = m.s.t;
    m.inject(drugId, ug);
    const d = DRUG_BY_ID[drugId];
    m.run(d.t12 > 200 ? 60 : Math.min(120, Math.max(40, d.t12 * 4 + 20)));
    const out = sampleTrace(m.points, t0, m.s.t);
    controlTraceCache.set(key, out);
    return out;
  }
  function sampleTrace(points, t0, t1) {
    const i0 = clamp(idxOf(t0), 0, points.length - 1), i1 = clamp(idxOf(t1), 0, points.length - 1);
    const pre = points[i0];
    const step = Math.max(1, Math.floor((i1 - i0) / 160));
    const out = [];
    for (let i = i0; i <= i1; i += step) out.push([points[i].t - t0, points[i].map - pre.map, points[i].hr - pre.hr]);
    return out;
  }

  function sparkSvg(obs, ctrl, k, color) {
    const W = 160, H = 72, padT = 6, padB = 6;
    const tMax = Math.max(obs.length ? obs[obs.length - 1][0] : 1, ctrl.length ? ctrl[ctrl.length - 1][0] : 1, 1);
    let m = 4;
    obs.concat(ctrl).forEach(r => { m = Math.max(m, Math.abs(r[k])); });
    m *= 1.1;
    const X = t => t / tMax * W, Y = v => padT + (m - v) / (2 * m) * (H - padT - padB);
    const path = arr => arr.map((r, i) => (i ? 'L' : 'M') + X(r[0]).toFixed(1) + ' ' + Y(r[k]).toFixed(1)).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<line x1="0" x2="' + W + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="var(--line-strong)" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + path(ctrl) + '" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + path(obs) + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '</svg>';
  }

  const TAG_ICON = { up: '↑', down: '↓', bi: '↕', flat: '' };
  function tagChips(tags) {
    return tags.map(t => '<span class="chip ' + t.k + '">' + (TAG_ICON[t.k] ? '<span aria-hidden="true">' + TAG_ICON[t.k] + '</span>' : '') + esc(t.label) + '</span>').join('');
  }
  function cmpChip(c) { return c ? '<span class="cmp cmp-' + c + '">' + esc(CE.CMP_LABEL[c]) + '</span>' : ''; }

  function renderHistory() {
    const S = getSession();
    const items = S.items.slice();
    const n = items.length;
    const changed = items.filter(x => x.info.changed).length;
    $('#histCount').innerHTML = n
      ? n + (n === 1 ? ' administración' : ' administraciones') + '<small>' + (changed ? changed + (changed === 1 ? ' difiere' : ' difieren') + ' de su control' : 'Todas comparables a su control') + '</small>'
      : 'Sin administraciones';
    $('#orderSeg').hidden = n < 2;
    const box = $('#evList');
    if (!n) {
      box.innerHTML = '<div class="card empty"><h3>Aún no hay administraciones</h3><p>Cada dosis que administres aparecerá aquí junto a la respuesta que tendría un sujeto sin fármacos previos.</p><button type="button" class="ghost" data-goto="registro">Ir a Registro</button></div>';
      return;
    }
    if (state.order === 'desc') items.reverse();
    const lastN = model.events[model.events.length - 1].n;
    const scrollY = window.scrollY;
    box.innerHTML = items.map(x => {
      const e = x.evt, d = DRUG_BY_ID[e.drugId], r = x.resp, c = x.ctrl, info = x.info;
      const open = state.expanded.has(e.n);
      const ongoing = state.mode === 'live' && e.n === lastN;
      const mods = (e.ctx.modifiers || []).map(m => m.id).filter(id => id !== e.drugId).map(id => DRUG_BY_ID[id].name);
      let body = '';
      if (open) {
        const obs = sampleTrace(model.points, e.t, e.t + r.window);
        const ctr = controlTrace(e.drugId, e.ug);
        body =
          '<div class="ev-body" id="evb-' + e.n + '">' +
          '<table class="cmp-table"><thead><tr><th>Pico</th><th>Observado</th><th>Control</th><th>Comparación</th></tr></thead><tbody>' +
          '<tr><td>PAM</td><td>' + sg(r.map.peak) + ' mmHg</td><td>' + sg(c.map.peak) + '</td><td>' + cmpChip(info.cmp.map) + '</td></tr>' +
          '<tr><td>FC</td><td>' + sg(r.hr.peak) + ' lpm</td><td>' + sg(c.hr.peak) + '</td><td>' + cmpChip(info.cmp.hr) + '</td></tr>' +
          '<tr><td>SIS</td><td>' + sg(r.sys.peak) + ' mmHg</td><td>' + sg(c.sys.peak) + '</td><td></td></tr>' +
          '<tr><td>DIA</td><td>' + sg(r.dia.peak) + ' mmHg</td><td>' + sg(c.dia.peak) + '</td><td></td></tr>' +
          '</tbody></table>' +
          '<div class="sparks">' +
          '<div class="spark"><div class="spark-title"><span>ΔPAM, mmHg</span><span>' + fmtT(Math.max(r.window, 1)) + '</span></div>' + sparkSvg(obs, ctr, 1, 'var(--pres)') + '</div>' +
          '<div class="spark"><div class="spark-title"><span>ΔFC, lpm</span></div>' + sparkSvg(obs, ctr, 2, 'var(--hr)') + '</div>' +
          '<div class="spark-legend"><span><i></i>Observado</span><span><i class="dash"></i>Control sin fármacos previos</span></div>' +
          '</div>' +
          (info.notes.length ? '<ul class="notes">' + info.notes.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '') +
          '<p class="mech"><b>' + esc(d.mech) + '.</b> ' + esc(info.mechanism) + '</p>' +
          '<p class="mech">Basal previa: ' + nf(e.pre.sys) + '/' + nf(e.pre.dia) + ' mmHg, PAM ' + nf(e.pre.map) + ', FC ' + nf(e.pre.hr) + ' lpm.' +
          (mods.length ? ' Presentes: ' + esc(mods.join(', ')) + '.' : ' Sin otros fármacos activos.') +
          (r.duration > 0 ? ' Duración del efecto sobre la PAM: ' + fmtT(r.duration) + '.' : '') + '</p>' +
          '<div class="ev-actions"><button type="button" class="ghost" data-view="' + e.n + '">Ver en la gráfica</button>' +
          '<button type="button" class="ghost" data-replay="' + e.n + '">Ver en Fisiología</button></div>' +
          '</div>';
      }
      return '<article class="ev' + (info.changed ? ' changed' : '') + '">' +
        '<button type="button" class="ev-head" data-n="' + e.n + '" aria-expanded="' + open + '" aria-controls="evb-' + e.n + '">' +
        '<span class="ev-n">' + e.n + '</span>' +
        '<span class="ev-main"><span class="ev-name">' + esc(d.name) + ' <span class="ev-dose">' + esc(e.doseLabel || fmtUg(e.ug)) + '</span></span>' +
        '<span class="ev-meta">t ' + fmtT(e.t) + (ongoing ? ', respuesta en curso' : '') + (info.changed ? ', difiere del control' : '') + '</span>' +
        '<span class="chips">' + tagChips(info.tags) + '</span></span>' +
        '<span class="ev-right"><span>PAM ' + sg(r.map.peak) + '</span><span>FC ' + sg(r.hr.peak) + '</span>' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></span>' +
        '</button>' + body + '</article>';
    }).join('');
    window.scrollTo(0, scrollY);
  }

  function renderSession() {
    const S = getSession();
    const box = $('#sessionBox');
    if (!S.items.length) {
      box.innerHTML = '<div class="card empty"><h3>La sesión está vacía</h3><p>Administra un fármaco y aquí aparecerán el resumen, las respuestas que difieren del control y los bloqueos que persisten.</p><button type="button" class="ghost" data-goto="registro">Ir a Registro</button></div>' + actionsCard();
      return;
    }
    const st = S.stats, f = st.final;
    const statsHtml =
      '<div class="stats">' +
      stat('Animal', SP().name, CE.PREPS[model.prepId].name.toLowerCase()) +
      stat('Duración', fmtT(st.duration)) +
      stat('Administraciones', st.n) +
      stat('Fármacos distintos', st.drugs) +
      stat('PAM mín. y máx.', nf(st.minMap) + '–' + nf(st.maxMap), 'mmHg') +
      stat('FC mín. y máx.', nf(st.minHr) + '–' + nf(st.maxHr), 'lpm') +
      stat('Estado final', nf(f.sys) + '/' + nf(f.dia), 'FC ' + nf(f.hr)) +
      '</div>';
    const blocks = S.blocks.map(b => '<span class="chip block">Bloqueo ' + esc(b) + '</span>')
      .concat(S.extras.map(x => '<span class="chip block">' + esc(x.charAt(0).toUpperCase() + x.slice(1)) + '</span>'));
    const findings = S.findings.length
      ? '<ul class="concl">' + S.findings.map(x => '<li><b>#' + x.evt.n + ' ' + esc(DRUG_BY_ID[x.evt.drugId].name) + '</b>: presión ' + esc(CE.CMP_LABEL[x.info.cmp.map].toLowerCase()) + ', FC ' + esc(CE.CMP_LABEL[x.info.cmp.hr].toLowerCase()) + '.</li>').join('') + '</ul>'
      : '<p class="card-sub">Todas las respuestas fueron comparables a su control.</p>';
    box.innerHTML =
      '<div class="card"><div class="card-head"><h2 class="headline">Resumen de la sesión</h2></div>' + statsHtml + '</div>' +
      '<div class="card"><div class="card-head"><h2 class="eyebrow">Conclusiones</h2></div><ul class="concl">' +
      S.conclusions.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul></div>' +
      '<div class="card"><div class="card-head"><h2 class="eyebrow">Respuestas que difieren del control</h2><span class="card-sub">' + S.findings.length + ' de ' + S.items.length + '</span></div>' + findings + '</div>' +
      '<div class="card"><div class="card-head"><h2 class="eyebrow">Al final de la sesión</h2></div>' +
      (blocks.length ? '<div class="chips">' + blocks.join('') + '</div>' : '<p class="card-sub">No persisten bloqueos relevantes.</p>') + '</div>' +
      actionsCard();
  }
  function stat(label, val, small) {
    return '<div class="stat"><span>' + esc(label) + '</span><b>' + esc(String(val)) + '</b>' + (small ? ' <small>' + esc(small) + '</small>' : '') + '</div>';
  }
  function actionsCard() {
    return '<div class="card"><div class="card-head"><h2 class="eyebrow">Datos</h2></div><div class="actions">' +
      '<button type="button" class="ghost" data-act="csv-points">Exportar registro (CSV)</button>' +
      '<button type="button" class="ghost" data-act="csv-events">Exportar administraciones (CSV)</button>' +
      '<button type="button" class="ghost danger" data-act="reset">Terminar experimento</button></div></div>';
  }

  /* ==========================================================
     Exportación CSV
     ========================================================== */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isFinite(v) ? String(Math.round(v * 1000) / 1000) : '';
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(name, rows) {
    const text = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function exportPoints() {
    const evAt = {};
    model.events.forEach(e => { const i = idxOf(e.t); evAt[i] = (evAt[i] ? evAt[i] + ' | ' : '') + '#' + e.n + ' ' + DRUG_BY_ID[e.drugId].name + ' ' + (e.doseLabel || fmtUg(e.ug)); });
    const rows = [['t_s', 'sis_mmHg', 'dia_mmHg', 'pam_mmHg', 'fc_lpm', 'vs_mL', 'gc_L_min', 'rvp_rel', 'contractilidad_rel', 'tono_simpatico', 'tono_vagal', 'transmision_ganglionar', 'administracion']];
    model.points.forEach((p, i) => rows.push([p.t, p.sys, p.dia, p.map, p.hr, p.sv, p.co, p.svr, p.contr, p.sym, p.vag, p.gT, evAt[i] || '']));
    download('cardiolab-registro-' + stamp() + '.csv', rows);
    toast('Registro exportado: ' + model.points.length.toLocaleString('es') + ' filas');
  }
  function exportEvents() {
    const S = getSession(true);
    if (!S.items.length) { toast('No hay administraciones que exportar.'); return; }
    const rows = [['n', 't_s', 'animal', 'preparacion', 'farmaco', 'dosis', 'dosis_ug', 'pre_sis', 'pre_dia', 'pre_pam', 'pre_fc', 'pico_dPAM', 'pico_dSIS', 'pico_dDIA', 'pico_dFC', 'control_dPAM', 'control_dFC', 'comparacion_PAM', 'comparacion_FC', 'respuesta', 'farmacos_presentes', 'interpretacion']];
    S.items.forEach(x => {
      const e = x.evt, r = x.resp, c = x.ctrl;
      rows.push([e.n, e.t, CE.SPECIES[e.species].name, CE.PREPS[e.prep].name, DRUG_BY_ID[e.drugId].name, e.doseLabel || fmtUg(e.ug), e.ug, e.pre.sys, e.pre.dia, e.pre.map, e.pre.hr,
        r.map.peak, r.sys.peak, r.dia.peak, r.hr.peak, c.map.peak, c.hr.peak,
        CE.CMP_LABEL[x.info.cmp.map], CE.CMP_LABEL[x.info.cmp.hr], x.info.tags.map(t => t.label).join(' / '),
        (e.ctx.modifiers || []).map(m => m.id).filter(id => id !== e.drugId).map(id => DRUG_BY_ID[id].name).join(' / '),
        x.info.notes.join(' ')]);
    });
    download('cardiolab-administraciones-' + stamp() + '.csv', rows);
    toast('Administraciones exportadas: ' + S.items.length);
  }

  /* ==========================================================
     Navegación, modo y reinicio
     ========================================================== */
  function setTab(tab) {
    if (state.tab === tab) { window.scrollTo(0, 0); return; }
    state.tab = tab;
    ['registro', 'fisio', 'historial', 'sesion'].forEach(t => {
      $('#tab-' + t).hidden = t !== tab;
      $('#t-' + t).setAttribute('aria-selected', String(t === tab));
    });
    placeAdmin();
    window.scrollTo(0, 0);
    chart.dirty = true;
    if (tab === 'historial') renderHistory();
    if (tab === 'sesion') renderSession();
    if (tab === 'fisio') syncReplayBtn();
    if (tab !== 'fisio' && state.replay) stopReplay(false);
  }

  function setMode(mode) {
    state.mode = mode; LS.set('mode', mode);
    $$('#modeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('#liveBar').hidden = mode !== 'live';
    state.view = mode === 'live' ? { span: 60, follow: true, x0: 0 } : { span: Infinity, follow: true, x0: 0 };
    if (mode === 'live') setRunning(true);
    syncRangeSeg();
    renderModeHint();
    sessionDirty = true;
    chart.dirty = true;
  }
  function setRunning(on) {
    state.running = on;
    const btn = $('#playBtn');
    btn.setAttribute('aria-pressed', String(on));
    $('#playLabel').textContent = on ? 'Pausar' : 'Reanudar';
    $('#playIcon').innerHTML = on
      ? '<rect x="3" y="2.5" width="3.4" height="11" rx="1"/><rect x="9.6" y="2.5" width="3.4" height="11" rx="1"/>'
      : '<path d="M4 2.6v10.8a.8.8 0 0 0 1.2.7l8.6-5.4a.8.8 0 0 0 0-1.4L5.2 1.9a.8.8 0 0 0-1.2.7z"/>';
  }
  function setSpeed(s) {
    state.speed = s; LS.set('speed', s);
    $$('#speedSeg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === s)));
  }

  function resetSession(quiet) {
    model = freshModel();
    state.expanded.clear();
    state.cursorT = null;
    state.replay = null;
    state.view = state.mode === 'live' ? { span: 60, follow: true, x0: 0 } : { span: Infinity, follow: true, x0: 0 };
    syncRangeSeg();
    dataChanged(true);
    syncReplayBtn();
    if (!quiet) toast('Experimento terminado: animal nuevo sin pretratamiento');
  }

  function dataChanged(heavy) {
    chart.dirty = true;
    sessionDirty = true;
    renderVitals();
    const n = model.events.length;
    const badge = $('#histBadge');
    badge.hidden = !n; badge.textContent = n;
    if (heavy) {
      if (state.tab === 'historial') renderHistory();
      if (state.tab === 'sesion') renderSession();
      syncReplayBtn();
    }
  }

  /* ---------- Eventos de la interfaz ---------- */
  $('#tabbar').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('#tabbar').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = $$('#tabbar [role=tab]');
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const nx = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    nx.focus(); setTab(nx.dataset.tab);
  });
  $('#modeSeg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b && b.dataset.mode !== state.mode) setMode(b.dataset.mode); });
  $('#rangeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-span]'); if (!b) return;
    state.view = { span: b.dataset.span === 'all' ? Infinity : +b.dataset.span, follow: true, x0: 0 };
    syncRangeSeg(); chart.dirty = true;
  });
  $('#toEnd').addEventListener('click', () => { state.view.follow = true; syncRangeSeg(); chart.dirty = true; });
  $('#playBtn').addEventListener('click', () => { setRunning(!state.running); syncReplayBtn(); });
  $('#speedSeg').addEventListener('click', e => { const b = e.target.closest('[data-speed]'); if (b) setSpeed(+b.dataset.speed); });
  $('#orderSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-order]'); if (!b) return;
    state.order = b.dataset.order; LS.set('order', state.order);
    $$('#orderSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderHistory();
  });
  $('#evList').addEventListener('click', e => {
    const h = e.target.closest('.ev-head');
    if (h) {
      const n = +h.dataset.n;
      if (state.expanded.has(n)) state.expanded.delete(n); else state.expanded.add(n);
      renderHistory();
      const again = $('.ev-head[data-n="' + n + '"]');
      if (again) again.focus({ preventScroll: true });
      return;
    }
    const v = e.target.closest('[data-view]');
    if (v) {
      const ev = model.events.find(x => x.n === +v.dataset.view);
      const item = getSession().items.find(x => x.evt.n === ev.n);
      const end = ev.t + item.resp.window;
      setTab('registro');
      setView(Math.max(0, ev.t - 10), Math.max(20, end - ev.t + 20), false);
      state.cursorT = ev.t + item.resp.map.tPeak;
      chart.dirty = true;
      return;
    }
    const r = e.target.closest('[data-replay]');
    if (r) { setTab('fisio'); startReplay(+r.dataset.replay); }
  });
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]'); if (g) setTab(g.dataset.goto);
    const a = e.target.closest('#sessionBox [data-act]'); if (a) runAction(a.dataset.act);
  });

  // Menú
  const menu = $('#menu'), menuBtn = $('#menuBtn');
  function toggleMenu(open) {
    menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open));
    if (open) { const f = $('button', menu); if (f) f.focus(); }
  }
  menuBtn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(menu.hidden); });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) toggleMenu(false); });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act !== 'theme') toggleMenu(false);
    runAction(b.dataset.act);
  });
  function runAction(act) {
    if (act === 'theme') {
      state.theme = ({ dark: 'light', light: 'auto', auto: 'dark' })[state.theme];
      LS.set('theme', state.theme); applyTheme();
    } else if (act === 'csv-points') exportPoints();
    else if (act === 'csv-events') exportEvents();
    else if (act === 'reset') {
      const dlg = $('#resetDlg');
      if (dlg.showModal) dlg.showModal(); else if (window.confirm('¿Reiniciar la sesión? Se borran el registro y el historial.')) resetSession();
    }
  }
  $('#resetCancel').addEventListener('click', () => $('#resetDlg').close());
  $('#resetOk').addEventListener('click', () => { $('#resetDlg').close(); resetSession(); });

  // Administración
  $('#drugPick', adminEl).addEventListener('click', openSheet);
  $('#animalBtn', adminEl).addEventListener('click', openAnimalDlg);
  $('#dlgSpecies').addEventListener('click', e => { const b = e.target.closest('[data-sp]'); if (b) { dlgSpecies = b.dataset.sp; renderAnimalDlg(); } });
  $('#dlgPrep').addEventListener('click', e => { const b = e.target.closest('[data-prep]'); if (b) { dlgPrep = b.dataset.prep; renderAnimalDlg(); } });
  $('#animalCancel').addEventListener('click', () => animalDlg.close());
  $('#animalOk').addEventListener('click', () => { animalDlg.close(); startAnimal(dlgSpecies, dlgPrep); });
  doseIn.addEventListener('input', updateDose);
  weightIn.addEventListener('input', updateDose);
  unitSel.addEventListener('change', updateDose);
  doseIn.addEventListener('keydown', e => { if (e.key === 'Enter') administer(); });
  weightIn.addEventListener('keydown', e => { if (e.key === 'Enter') administer(); });
  $('.dose-chips', adminEl).addEventListener('click', e => { const b = e.target.closest('[data-mul]'); if (b) scaleDose(b.dataset.mul); });
  $('#giveBtn', adminEl).addEventListener('click', administer);

  // Selector
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    const c = e.target.closest('[data-cat]');
    if (c) { sheetCat = c.dataset.cat; buildCatChips(); renderDrugList(); $('#drugList').scrollTop = 0; return; }
    const it = e.target.closest('.drug-item');
    if (it) { selectDrug(it.dataset.id); closeSheet(); }
  });
  $('#drugSearch').addEventListener('input', renderDrugList);
  $('#drugSearch').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const f = $('.drug-item', sheet); if (f) { selectDrug(f.dataset.id); closeSheet(); } }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!sheet.hidden) closeSheet();
    else if (!menu.hidden) { toggleMenu(false); menuBtn.focus(); }
    else if (state.cursorT !== null) { state.cursorT = null; chart.dirty = true; }
  });
  sheet.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = $$('button, input', $('.sheet-panel')).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  $('#rpBtn').addEventListener('click', () => {
    if (state.replay) stopReplay(false);
    else { const last = model.events[model.events.length - 1]; if (last) startReplay(last.n); }
  });

  window.addEventListener('resize', () => { chart.dirty = true; });
  const schemeMq = mq('(prefers-color-scheme: dark)');
  if (schemeMq.addEventListener) schemeMq.addEventListener('change', () => { if (state.theme === 'auto') applyTheme(); });

  /* ---------- Bucle principal ---------- */
  let lastFrame = performance.now(), simAcc = 0, lastMiniDraw = 0;
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (state.mode === 'live' && state.running) {
      simAcc += dt * state.speed;
      let n = Math.floor(simAcc / DT + 1e-9);
      if (n > 0) {
        simAcc -= n * DT;
        n = Math.min(n, 1200);
        for (let i = 0; i < n; i++) model.step(DT);
        dataChanged(false);
        if ((state.tab === 'historial' || state.tab === 'sesion') && now - lastSessionAt > 1200) {
          if (state.tab === 'historial') renderHistory(); else renderSession();
        }
      }
    }
    if (state.tab === 'registro' && chart.dirty) {
      if (drawChart()) {
        if (now - lastMiniDraw > 120 || !(state.mode === 'live' && state.running)) { drawMini(); lastMiniDraw = now; }
        renderViewLabel();
        chart.dirty = false;
      }
    }
    if (state.tab === 'fisio') stepPhysio(dt);
    requestAnimationFrame(frame);
  }

  /* ---------- Inicio ---------- */
  model = freshModel();
  placeAdmin();
  applyTheme();
  renderAnimal();
  selectDrug(state.drugId);
  weightIn.value = trimNum(state.weight, 1);
  setSpeed(state.speed);
  setRunning(true);
  setMode(state.mode);
  $$('#orderSeg button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.order === state.order)));
  dataChanged(true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { chart.dirty = true; });
  requestAnimationFrame(frame);
})();
