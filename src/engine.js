/* ==========================================================
   CardioLab · Motor farmacológico y hemodinámico
   Modelo de receptores (Gaddum/Schild), tono autónomo basal,
   barorreflejo por vía simpática y vagal, y gasto cardíaco.
   Las concentraciones se expresan como cantidad en el organismo (µg).
   ========================================================== */
(function (root) {
  'use strict';

  const DT = 0.1;
  const BASE = { map: 93.3, hr: 72, sv: 70, pp: 40 };

  /* Especies. El modelo farmacodinámico es relativo (fracción de ocupación y cambios
     respecto al basal), así que cada especie aporta sus valores basales, la escala de
     potencia y cómo se traduce el estímulo cronotrópico en lpm.
     · scale: µg equivalentes del modelo por µg reales en el animal. En la rata,
       1 µg/kg equivale a 10 µg del modelo (rata de 300 g → 10 / 0,3).
     · hrExp: compresión de la respuesta de FC (la rata parte de una FC alta y su
       margen relativo es menor).
     · thr: umbral de cambio relevante para la interpretación (mmHg y lpm). */
  const SPECIES = {
    humano: {
      id: 'humano', name: 'Humano', detail: 'adulto de 70 kg', weight: 70,
      base: BASE, hrMin: 20, hrMax: 280, hrExp: 1, scale: 1, thr: { map: 4, hr: 4 }
    },
    rata: {
      id: 'rata', name: 'Rata', detail: 'anestesiada, 300 g', weight: 0.3, K: null,
      base: { map: 91, hr: 178, sv: 0.3, pp: 12 }, hrMin: 0, hrMax: 420, hrExp: 1, scale: 10 / 0.3, thr: { map: 4, hr: 6 }
    }
  };

  /* Preparaciones del animal */
  const PREPS = {
    normal: { id: 'normal', name: 'Normal', desc: 'Animal anestesiado con reflejos y tono autónomo intactos.' },
    reserpinizado: { id: 'reserpinizado', name: 'Reserpinizado', store: 0.05,
      desc: 'Pretratado con reserpina: los depósitos de noradrenalina están casi vacíos (5 %).' },
    descentralizado: { id: 'descentralizado', name: 'Descentralizado', pithed: true, symTone: 0.08, hrFactor: 0.72,
      desc: 'Sin control del sistema nervioso central (desmedulado): no hay barorreflejo ni tono vagal y queda un tono simpático residual mínimo.' }
  };

  const CATEGORIES = [
    { id: 'ady', name: 'Agonistas adrenérgicos' },
    { id: 'bla', name: 'Antagonistas adrenérgicos' },
    { id: 'col', name: 'Colinérgicos' },
    { id: 'ind', name: 'Indirectos y moduladores' },
    { id: 'gan', name: 'Ganglionares' },
    { id: 'vas', name: 'Vasoactivos y otros' }
  ];

  // ag = agonismo (EC50, µg) · ant = antagonismo competitivo (KB, µg) · inh = inhibición no competitiva (IC50, µg)
  const DRUGS = [
    // Agonistas adrenérgicos
    { id: 'adr', name: 'Adrenalina', cat: 'ady', mech: 'Agonista α1, α2, β1, β2', unit: 'µg', dose: 10, t12: 20, onset: 2.5, netSub: true,
      ag: { a1: 7, a2: 20, b1: 6, b2: 5 },
      desc: 'Estimula β1 (FC y contractilidad), β2 (vasodilatación muscular) y α1 (vasoconstricción). A dosis bajas domina β2 y la diastólica puede bajar.' },
    { id: 'nor', name: 'Noradrenalina', cat: 'ady', mech: 'Agonista α1, α2, β1', unit: 'µg', dose: 10, t12: 20, onset: 2.5, netSub: true,
      ag: { a1: 8, a2: 14, b1: 30, b2: 400 },
      desc: 'Vasoconstricción α1 potente con poca acción β2. Sube sistólica y diastólica; el barorreflejo vagal suele producir bradicardia refleja.' },
    { id: 'iso', name: 'Isoprenalina', cat: 'ady', mech: 'Agonista β1, β2', unit: 'µg', dose: 5, t12: 25, onset: 2.5,
      ag: { b1: 2, b2: 1.5 },
      desc: 'Agonista β puro. Taquicardia y aumento de contractilidad; la vasodilatación β2 baja la diastólica y la PAM.' },
    { id: 'phe', name: 'Fenilefrina', cat: 'ady', mech: 'Agonista α1 selectivo', unit: 'µg', dose: 100, t12: 60, onset: 3,
      ag: { a1: 60 },
      desc: 'Vasoconstricción α1 pura. Sube la presión y provoca bradicardia refleja mediada por el vago.' },
    { id: 'dop', name: 'Dopamina', cat: 'ady', mech: 'Agonista D1, β1, α1 (dosis-dependiente)', unit: 'µg', dose: 200, t12: 25, onset: 3, netSub: true,
      ag: { d1: 100, b1: 150, a1: 700 },
      desc: 'A dosis baja actúa en D1 (vasodilatación renal y esplácnica), a dosis media en β1 y a dosis alta en α1.' },
    { id: 'dob', name: 'Dobutamina', cat: 'ady', mech: 'Agonista β1 preferente', unit: 'µg', dose: 250, t12: 40, onset: 3,
      ag: { b1: 120, b2: 900, a1: 1500 },
      desc: 'Inotrópico β1. Aumenta contractilidad y volumen sistólico con cambios modestos de la resistencia periférica.' },
    { id: 'sal', name: 'Salbutamol', cat: 'ady', mech: 'Agonista β2 selectivo', unit: 'µg', dose: 100, t12: 120, onset: 4,
      ag: { b2: 35, b1: 600 },
      desc: 'Vasodilatación β2 que baja la diastólica; la taquicardia es sobre todo refleja, con algo de β1 directo.' },
    { id: 'clo', name: 'Clonidina', cat: 'ady', mech: 'Agonista α2 (central y periférico)', unit: 'µg', dose: 150, t12: 900, onset: 3, cns: 30,
      ag: { a2: 60, a2c: 40 },
      desc: 'Respuesta bifásica: primero una subida breve por α2 vascular, después hipotensión y bradicardia al reducir el tono simpático central.' },

    // Antagonistas adrenérgicos
    { id: 'phn', name: 'Fentolamina', cat: 'bla', mech: 'Antagonista α1 y α2', unit: 'mg', dose: 2, t12: 400, onset: 6,
      ant: { a1: 25, a2: 25 },
      desc: 'Bloquea la vasoconstricción α1 (baja la presión) y el autorreceptor α2, lo que aumenta la liberación de noradrenalina y la taquicardia refleja.' },
    { id: 'prz', name: 'Prazosina', cat: 'bla', mech: 'Antagonista α1 selectivo', unit: 'mg', dose: 1, t12: 900, onset: 8,
      ant: { a1: 8 },
      desc: 'Bloqueo α1 selectivo. Hipotensión con menos taquicardia refleja que la fentolamina porque respeta α2.' },
    { id: 'pro', name: 'Propranolol', cat: 'bla', mech: 'Antagonista β1 y β2', unit: 'mg', dose: 2, t12: 900, onset: 6,
      ant: { b1: 15, b2: 15 },
      desc: 'Bloqueo β no selectivo. Reduce la FC basal y anula las respuestas β1 y β2 de los agonistas.' },
    { id: 'met', name: 'Metoprolol', cat: 'bla', mech: 'Antagonista β1 selectivo', unit: 'mg', dose: 5, t12: 900, onset: 6,
      ant: { b1: 40, b2: 1500 },
      desc: 'Bloqueo β1 cardioselectivo. Baja la FC pero conserva la vasodilatación β2.' },
    { id: 'ate', name: 'Atenolol', cat: 'bla', mech: 'Antagonista β1 selectivo', unit: 'mg', dose: 5, t12: 1200, onset: 6,
      ant: { b1: 60, b2: 30000 },
      desc: 'Bloqueo β1 cardioselectivo e hidrófilo. Baja la FC y anula la taquicardia β1, pero respeta la vasodilatación β2.' },
    { id: 'lab', name: 'Labetalol', cat: 'bla', mech: 'Antagonista α1, β1, β2', unit: 'mg', dose: 20, t12: 900, onset: 6,
      ant: { a1: 1500, b1: 300, b2: 600 },
      desc: 'Bloqueo mixto α1 y β. Baja la presión sin taquicardia refleja.' },

    // Colinérgicos
    { id: 'ach', name: 'Acetilcolina', cat: 'col', mech: 'Agonista muscarínico (y nicotínico a dosis altas)', unit: 'µg', dose: 10, t12: 4, onset: 1.5, ache: true,
      ag: { m: 6, n: 150 },
      desc: 'M2 cardíaco (bradicardia) y M3 endotelial (vasodilatación por NO). Se hidroliza muy rápido por la acetilcolinesterasa.' },
    { id: 'neo', name: 'Neostigmina', cat: 'col', mech: 'Inhibidor de acetilcolinesterasa', unit: 'mg', dose: 0.5, t12: 900, onset: 8,
      inh: { ache: 100 },
      desc: 'Impide la hidrólisis de la acetilcolina: potencia y prolonga la acetilcolina exógena y aumenta el tono vagal.' },
    { id: 'atr', name: 'Atropina', cat: 'col', mech: 'Antagonista muscarínico', unit: 'mg', dose: 1, t12: 1200, onset: 4,
      ant: { m: 0.5 },
      desc: 'Bloquea M2 y M3. Elimina el tono vagal (taquicardia) y las respuestas muscarínicas a la acetilcolina.' },

    // Indirectos y moduladores
    { id: 'tyr', name: 'Tiramina', cat: 'ind', mech: 'Liberador de noradrenalina', unit: 'µg', dose: 500, t12: 40, onset: 4,
      ag: { net: 250 },
      desc: 'Entra en la terminal por el transportador NET y desplaza la noradrenalina almacenada. Necesita NET funcional y depósitos llenos.' },
    { id: 'eph', name: 'Efedrina', cat: 'ind', mech: 'Mixto: liberador + agonista α/β', unit: 'mg', dose: 10, t12: 600, onset: 5,
      ag: { a1: 40000, b1: 20000, b2: 30000, net: 6000 },
      desc: 'Libera noradrenalina y además activa receptores α y β de forma directa, por lo que resiste parcialmente a la reserpina.' },
    { id: 'coc', name: 'Cocaína', cat: 'ind', mech: 'Bloqueador de recaptación (NET)', unit: 'mg', dose: 2, t12: 600, onset: 5,
      ant: { net: 150 },
      desc: 'Bloquea NET. Potencia las catecolaminas que se recaptan (noradrenalina, adrenalina) y anula a los liberadores como la tiramina.' },
    { id: 'res', name: 'Reserpina', cat: 'ind', mech: 'Depleción vesicular (VMAT)', unit: 'mg', dose: 1, t12: 3600, onset: 10,
      inh: { res: 50 },
      desc: 'Vacía los depósitos de noradrenalina (efecto acelerado en el simulador). Reduce el tono simpático y anula a los simpaticomiméticos indirectos.' },

    // Ganglionares
    { id: 'nic', name: 'Nicotina', cat: 'gan', mech: 'Agonista nicotínico ganglionar', unit: 'µg', dose: 100, t12: 120, onset: 2,
      ag: { n: 50 },
      desc: 'Estimula ganglios simpáticos, parasimpáticos y médula suprarrenal. El efecto neto suele ser presor con cambios variables de FC.' },
    { id: 'hex', name: 'Hexametonio', cat: 'gan', mech: 'Bloqueador ganglionar', unit: 'mg', dose: 10, t12: 900, onset: 5,
      ant: { n: 150 },
      desc: 'Interrumpe la transmisión ganglionar simpática y parasimpática: baja la presión y suprime todos los reflejos barorreceptores.' },

    // Vasoactivos y otros
    { id: 'his', name: 'Histamina', cat: 'vas', mech: 'Agonista H1', unit: 'µg', dose: 10, t12: 15, onset: 2,
      ag: { h1: 4 },
      desc: 'Vasodilatación H1 dependiente de endotelio: hipotensión con taquicardia refleja.' },
    { id: 'dph', name: 'Difenhidramina', cat: 'vas', mech: 'Antagonista H1', unit: 'mg', dose: 20, t12: 1200, onset: 6,
      ant: { h1: 150 },
      desc: 'Bloqueo H1 competitivo. Sin efecto hemodinámico propio relevante; anula la hipotensión por histamina.' },
    { id: 'ang', name: 'Angiotensina II', cat: 'vas', mech: 'Agonista AT1', unit: 'µg', dose: 1, t12: 25, onset: 2,
      ag: { at1: 0.5 },
      desc: 'Vasoconstrictor muy potente vía AT1. Hipertensión con bradicardia refleja.' },
    { id: 'los', name: 'Losartán', cat: 'vas', mech: 'Antagonista AT1', unit: 'mg', dose: 10, t12: 1800, onset: 10,
      ant: { at1: 120 },
      desc: 'Bloquea AT1. Baja ligeramente la presión al retirar el tono angiotensinérgico basal y anula la respuesta a angiotensina II.' },
    { id: 'avp', name: 'Vasopresina', cat: 'vas', mech: 'Agonista V1', unit: 'µg', dose: 2, t12: 120, onset: 3,
      ag: { v1: 1.5 },
      desc: 'Vasoconstricción V1 independiente de receptores adrenérgicos: resiste a los bloqueadores α.' },
    { id: 'snp', name: 'Nitroprusiato', cat: 'vas', mech: 'Donador de NO (arterial y venoso)', unit: 'µg', dose: 50, t12: 10, onset: 1.5,
      ag: { no: 30, ven: 40 },
      desc: 'Libera NO directamente en el músculo liso: vasodilatación arterial y venosa breve con taquicardia refleja.' },
    { id: 'ntg', name: 'Nitroglicerina', cat: 'vas', mech: 'Donador de NO (venoso preferente)', unit: 'µg', dose: 200, t12: 60, onset: 2,
      ag: { no: 300, ven: 70 },
      desc: 'Venodilatación predominante: reduce la precarga y el volumen sistólico más que la resistencia arterial.' },
    { id: 'ver', name: 'Verapamilo', cat: 'vas', mech: 'Bloqueador de canales de Ca²⁺ tipo L', unit: 'mg', dose: 5, t12: 1200, onset: 5,
      inh: { ca: 4000 },
      desc: 'Deprime el nodo sinusal y la contractilidad y relaja el músculo liso arterial. Hipotensión sin taquicardia refleja eficaz.' }
  ];

  const DRUG_BY_ID = {};
  DRUGS.forEach(d => { DRUG_BY_ID[d.id] = d; });

  // Dosis habituales en la rata (por kg). Las de la Práctica 7 siguen la guía.
  const RAT_DOSES = {
    adr: [1, 'µg/kg'], nor: [1, 'µg/kg'], iso: [3, 'µg/kg'], phe: [100, 'µg/kg'], dop: [20, 'µg/kg'], dob: [25, 'µg/kg'],
    sal: [10, 'µg/kg'], clo: [15, 'µg/kg'], phn: [200, 'µg/kg'], prz: [1000, 'µg/kg'], pro: [1000, 'µg/kg'], met: [500, 'µg/kg'],
    ate: [1000, 'µg/kg'], lab: [2, 'mg/kg'], ach: [1, 'µg/kg'], neo: [50, 'µg/kg'], atr: [100, 'µg/kg'], tyr: [50, 'µg/kg'],
    eph: [1, 'mg/kg'], coc: [200, 'µg/kg'], res: [100, 'µg/kg'], nic: [10, 'µg/kg'], hex: [1, 'mg/kg'], his: [1, 'µg/kg'],
    dph: [2, 'mg/kg'], ang: [0.1, 'µg/kg'], los: [1, 'mg/kg'], avp: [0.2, 'µg/kg'], snp: [5, 'µg/kg'], ntg: [20, 'µg/kg'],
    ver: [0.5, 'mg/kg']
  };
  DRUGS.forEach(d => { const r = RAT_DOSES[d.id]; d.ratDose = r ? { dose: r[0], unit: r[1] } : { dose: d.dose, unit: d.unit + '/kg' }; });

  const REC = ['a1', 'a2', 'b1', 'b2', 'm', 'n', 'h1', 'd1', 'v1', 'at1', 'no', 'ven', 'net', 'a2c'];
  const REC_LABEL = {
    a1: 'α1', a2: 'α2', b1: 'β1', b2: 'β2', m: 'M', m2: 'M2', m3: 'M3', n: 'N', h1: 'H1', d1: 'D1', v1: 'V1',
    at1: 'AT1', no: 'NO', ven: 'Venoso', net: 'NET', a2c: 'α2 central', ca: 'Ca²⁺', ache: 'AChE', res: 'Depósitos'
  };

  // Tono endógeno en unidades de EC50
  const ENDO = { a1: 0.55, a2: 0.3, b1: 0.28, m2: 0.9, at1: 0.25, g0: 3 };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function toMicrograms(dose, unit, weightKg) {
    const w = weightKg > 0 ? weightKg : 70;
    switch (unit) {
      case 'µg': return dose;
      case 'mg': return dose * 1000;
      case 'µg/kg': return dose * w;
      case 'mg/kg': return dose * w * 1000;
      default: return dose;
    }
  }

  /* Efectos: dado el estado, calcula estímulos, activaciones y determinantes hemodinámicos */
  function computeEffects(s) {
    const S = {}, shift = {};
    REC.forEach(r => { S[r] = 0; shift[r] = 1; });
    let caSum = 0, acheSum = 0, resSum = 0;

    // Primero los moduladores no competitivos (afectan la potencia de otros)
    for (const id in s.ce) {
      const d = DRUG_BY_ID[id], c = s.ce[id];
      if (!d.inh || c <= 1e-9) continue;
      if (d.inh.ca) caSum += c / d.inh.ca;
      if (d.inh.ache) acheSum += c / d.inh.ache;
      if (d.inh.res) resSum += c / d.inh.res;
    }
    const Eca = caSum / (1 + caSum);
    const Eache = acheSum / (1 + acheSum);
    const Eres = resSum / (1 + resSum);

    // Antagonismo competitivo
    for (const id in s.ce) {
      const d = DRUG_BY_ID[id], c = s.ce[id];
      if (!d.ant || c <= 1e-9) continue;
      for (const r in d.ant) shift[r] += c / d.ant[r];
    }
    const thNet = (shift.net - 1) / shift.net; // ocupación de NET por bloqueadores

    // Agonismo exógeno
    const netBoost = 1 + 0.9 * thNet;
    for (const id in s.ce) {
      const d = DRUG_BY_ID[id];
      if (!d.ag) continue;
      const c = s.ce[id];
      if (c <= 1e-9 && !(d.cns && s.cns[id] > 1e-9)) continue;
      const potency = d.ache ? (1 + 8 * Eache) : 1;
      for (const r in d.ag) {
        if (r === 'a2c') { S.a2c += (s.cns[id] || 0) / d.ag[r]; continue; }
        let v = c / d.ag[r] * potency;
        if (d.netSub && (r === 'a1' || r === 'a2' || r === 'b1')) v *= netBoost;
        S[r] += v;
      }
    }

    const act = (r, extra) => { const st = S[r] + (extra || 0); return st / (st + shift[r]); };

    // Ganglios
    const gT = (ENDO.g0 / (ENDO.g0 + shift.n)) / (ENDO.g0 / (ENDO.g0 + 1));
    const En = S.n / (S.n + shift.n); // estimulación nicotínica exógena
    const Erel = S.net / (S.net + shift.net); // liberadores indirectos

    // Autorreceptor α2 presináptico
    const thA2 = (shift.a2 - 1) / shift.a2;
    const Ea2exo = act('a2');
    const presyn = (1 + 0.6 * thA2) * (1 - 0.35 * Ea2exo);

    const store = s.store;
    const P = store * (presyn * (gT * s.sym + 2.6 * En) + 2.5 * Erel);
    const Pr = P * netBoost;
    const Ad = 1.6 * En * store; // adrenalina suprarrenal
    const V = (gT * s.vag + 1.0 * En) * (1 + 1.5 * Eache);

    const Ea1 = act('a1', ENDO.a1 * Pr + 0.3 * Ad);
    const Ea2 = act('a2', ENDO.a2 * Pr);
    const Eb1 = act('b1', ENDO.b1 * Pr + 0.6 * Ad);
    const Eb2 = act('b2', 0.8 * Ad);
    const Em2 = (2 * S.m + ENDO.m2 * V) / (2 * S.m + ENDO.m2 * V + shift.m);
    const Em3 = S.m / (S.m + shift.m);
    const Eh1 = act('h1'), Ed1 = act('d1'), Ev1 = act('v1');
    const Eat1 = act('at1', ENDO.at1);
    const Eno = act('no'), Even = act('ven');
    const Ea2c = S.a2c / (S.a2c + 1);

    const hrf = (1 + 1.1 * Eb1) / (1 + 1.4 * Em2) * (1 - 0.7 * Eca);
    const contr = (1 + 0.7 * Eb1) * (1 - 0.12 * Em2) * (1 - 0.35 * Eca);
    const preload = (1 + 0.1 * Ea1) / (1 + 0.5 * Even);
    const svrf = (1 + 1.8 * Ea1 + 0.8 * Ea2 + 1.5 * Ev1 + 1.7 * Eat1) /
      ((1 + 1.0 * Eb2) * (1 + 0.9 * Em3) * (1 + 1.3 * Eno) * (1 + 0.9 * Eh1) * (1 + 0.5 * Ed1) * (1 + 0.6 * Eca));

    const blk = r => (shift[r] - 1) / shift[r];
    return {
      hrf, contr, preload, svrf, Ea2c, Eres, Eache, Eca, gT,
      E: { a1: Ea1, a2: Ea2, b1: Eb1, b2: Eb2, m2: Em2, m3: Em3, n: En, h1: Eh1, d1: Ed1, v1: Ev1, at1: Eat1, no: Eno, ven: Even, net: Erel, a2c: Ea2c },
      B: { a1: blk('a1'), a2: blk('a2'), b1: blk('b1'), b2: blk('b2'), m: blk('m'), n: blk('n'), h1: blk('h1'), at1: blk('at1'), net: thNet, ca: Eca, ache: Eache, res: 1 - store },
      shift
    };
  }

  function freshState(sp) {
    const B = (sp || SPECIES.humano).base;
    return { t: 0, c: {}, ce: {}, cns: {}, sym: 1, vag: 1, store: 1, map: B.map, hr: B.hr };
  }

  const REF = computeEffects(freshState());

  function hemo(s, fx, sp) {
    sp = sp || SPECIES.humano;
    const B = sp.base;
    let hrTarget, dHr, hrRel;
    if (sp.hrExp === 1) {
      hrTarget = clamp(B.hr * fx.hrf / REF.hrf, sp.hrMin, sp.hrMax);
      dHr = s.hr - B.hr;
    } else {
      // La FC de la especie se traduce a su equivalente en el modelo de referencia
      hrTarget = clamp(B.hr * Math.pow(fx.hrf / REF.hrf, sp.hrExp), sp.hrMin, sp.hrMax);
      hrRel = Math.pow(s.hr / B.hr, 1 / sp.hrExp);
      dHr = (hrRel - 1) * BASE.hr;
    }
    const fill = clamp(1 - (dHr > 0 ? 0.0075 : 0.004) * dHr, 0.5, 1.2);
    const sv = B.sv * (fx.contr / REF.contr) * (fx.preload / REF.preload) * fill;
    const co = s.hr * sv;
    const svr = fx.svrf / REF.svrf;
    const coRel = sp.hrExp === 1 ? co / (B.hr * B.sv) : hrRel * sv / B.sv;
    const mapTarget = clamp(B.map * coRel * svr, 15, 260);
    return { hrTarget, sv, co, svr, mapTarget };
  }

  /* ==========================================================
     Modelo de la rata anestesiada
     Calibrado con los registros del CardioLab original de la Práctica 7.
     Usa el mismo esquema de receptores que el modelo humano, con parámetros propios:
     · potencia y cinética de cada fármaco en la rata (RAT_PD, en µg del modelo:
       1 µg/kg en la rata = 10 µg del modelo)
     · barorreflejo asimétrico: compensa las caídas de presión con taquicardia, pero
       casi no frena el corazón ante las subidas (rata anestesiada, tono vagal bajo)
     · gasto cardíaco poco dependiente de la FC (con FC alta se acorta el llenado) y
       presión de pulso que crece con la contractilidad β1
     · efecto estabilizador de membrana (bloqueo de canales de Na⁺) de propranolol y
       cocaína a dosis altas, que deprime algo la FC
     · paro cardíaco si la FC se mantiene por debajo de un umbral crítico
     El modelo humano no usa nada de este bloque.
     ========================================================== */
  const RAT_PD = {
    adr: { ag: { a1: 10.4, a2: 25, b1: 4.15, b2: 0.616 }, t12: 24.8, onset: 3,
      desc: 'Estimula α1, β1 y β2. Primero sube la presión por α1 y después cae por debajo de la basal cuando predomina β2 (respuesta bifásica), con taquicardia β1.' },
    nor: { ag: { a1: 14.8, a2: 20, b1: 12, b2: 4000 }, t12: 22.2, onset: 3,
      desc: 'Vasoconstricción α1 potente y acción β1 directa, con poca acción β2. En la rata anestesiada sube sistólica y diastólica con taquicardia, porque el reflejo vagal es débil.' },
    iso: { ag: { b1: 0.05, b2: 0.855 }, t12: 21.8, onset: 3,
      desc: 'Agonista β puro: caída brusca de la presión por β2 y gran taquicardia β1. Al pasar la vasodilatación, la sistólica puede quedar un poco por encima de la basal.' },
    phe: { ag: { a1: 109 }, t12: 32.7, onset: 3,
      desc: 'Vasoconstricción α1 pura. Sube mucho la presión; en la rata anestesiada la frecuencia cardíaca casi no cambia porque el reflejo vagal es débil.' },
    prz: { ant: { a1: 128 }, t12: 3600, onset: 200 },
    pro: { ant: { b1: 60, b2: 60 }, inh: { mem: 5320 }, t12: 3600, onset: 175,
      desc: 'Bloqueo β no selectivo. Baja la FC basal (a esta dosis también por un efecto estabilizador de membrana) y anula las respuestas β1 y β2 de los agonistas.' },
    ate: { ant: { b1: 1.97, b2: 1000000 }, t12: 3600, onset: 40 },
    ach: { ag: { m: 4.5, n: 93.7 }, t12: 3.98, onset: 3.51 },
    atr: { ant: { m: 25 }, t12: 1800, onset: 20 },
    neo: { inh: { ache: 22300 }, t12: 3600, onset: 60,
      desc: 'Impide la hidrólisis de la acetilcolina: aumenta el tono vagal y potencia y prolonga la acetilcolina exógena. Con acetilcolina a dosis alta puede causar paro cardíaco.' },
    coc: { ant: { net: 632 }, inh: { mem: 18000 }, t12: 1800, onset: 40,
      desc: 'Bloquea NET: potencia mucho a la noradrenalina y la adrenalina exógenas y anula a la tiramina. Por su efecto anestésico local baja un poco la FC y la presión.' },
    tyr: { ag: { net: 1460 }, t12: 60, onset: 20 }
  };

  const K_RAT = {
    endo: { a1: 0.176, a2: 0.3, b1: 0.2, m2: 0.05, at1: 0.25, g0: 3 },
    acheK: 34,   // potenciación de la acetilcolina con la colinesterasa inhibida
    netK: 5.64,   // potenciación de catecolaminas exógenas con NET bloqueado
    m2ex: 0.0698,   // peso del estímulo muscarínico exógeno sobre M2 cardíaco
    hr: { b1: 0.772, m2: 4.65, mem: 0.0816 },
    contr: { b1: 0.508, m2: 0.12 },
    svr: { a1: 2.35, a2: 0.6, b2: 0.651, m3: 6 },
    adrenal: 1.6,
    baro: { symUp: 0.113, symDown: 3.33, vagUp: 0.212, vagDown: 1, tauSym: 56.2, tauVag: 2 },
    coPow: 0.02,
    svContr: 0.313,
    ppContr: 4.01,
    ppMap: 0.05,
    tauMap: 26.9,
    tauHr: 12,
    lagB2: 14.5,   // retraso (s) de la vasodilatación β2 de los agonistas
    arrest: { hr: 60, secs: 15, tauMap: 150, tauHr: 4 }
  };
  K_RAT.build = function () {
    const D = {};
    DRUGS.forEach(d => { D[d.id] = Object.assign({}, d, RAT_PD[d.id] || {}); });
    K_RAT.D = D;
  };
  K_RAT.PD = RAT_PD;

  function computeEffectsRat(s, K) {
    const D = K.D, EN = K.endo;
    const S = {}, shift = {};
    REC.forEach(r => { S[r] = 0; shift[r] = 1; });
    let caSum = 0, acheSum = 0, resSum = 0, memSum = 0;
    for (const id in s.ce) {
      const d = D[id], c = s.ce[id];
      if (!d.inh || c <= 1e-9) continue;
      if (d.inh.ca) caSum += c / d.inh.ca;
      if (d.inh.ache) acheSum += c / d.inh.ache;
      if (d.inh.res) resSum += c / d.inh.res;
      if (d.inh.mem) memSum += c / d.inh.mem;
    }
    const Eca = caSum / (1 + caSum), Eache = acheSum / (1 + acheSum);
    const Eres = resSum / (1 + resSum), Emem = memSum / (1 + memSum);
    for (const id in s.ce) {
      const d = D[id], c = s.ce[id];
      if (!d.ant || c <= 1e-9) continue;
      for (const r in d.ant) shift[r] += c / d.ant[r];
    }
    const thNet = (shift.net - 1) / shift.net;
    const netBoost = 1 + K.netK * thNet;
    for (const id in s.ce) {
      const d = D[id];
      if (!d.ag) continue;
      const c = s.ce[id];
      if (c <= 1e-9 && !(d.cns && s.cns[id] > 1e-9)) continue;
      const potency = d.ache ? (1 + K.acheK * Eache) : 1;
      for (const r in d.ag) {
        if (r === 'a2c') { S.a2c += (s.cns[id] || 0) / d.ag[r]; continue; }
        let v = c / d.ag[r] * potency;
        if (d.netSub && (r === 'a1' || r === 'a2' || r === 'b1')) v *= netBoost;
        S[r] += v;
      }
    }
    // La vasodilatación β2 de los agonistas llega con retraso respecto a α1 (biofase más lenta):
    // por eso la adrenalina sube primero la presión y luego la baja por debajo de la basal
    const Sb2raw = S.b2;
    if (K.lagB2) S.b2 = s.lagB2 || 0;
    const act = (r, extra) => { const st = S[r] + (extra || 0); return st / (st + shift[r]); };
    const gT = (EN.g0 / (EN.g0 + shift.n)) / (EN.g0 / (EN.g0 + 1));
    const En = S.n / (S.n + shift.n);
    const Erel = S.net / (S.net + shift.net);
    const thA2 = (shift.a2 - 1) / shift.a2;
    const Ea2exo = act('a2');
    const presyn = (1 + 0.6 * thA2) * (1 - 0.35 * Ea2exo);
    const store = s.store;
    // En la rata el bloqueo de NET no aumenta el tono simpático endógeno
    const Pr = store * (presyn * (gT * s.sym + 2.6 * En) + 2.5 * Erel);
    const Ad = K.adrenal * En * store;
    const V = (gT * s.vag + 1.0 * En) * (1 + 1.5 * Eache);
    const Ea1 = act('a1', EN.a1 * Pr + 0.3 * Ad);
    const Ea2 = act('a2', EN.a2 * Pr);
    const Eb1 = act('b1', EN.b1 * Pr + 0.6 * Ad);
    const Eb2 = act('b2', 0.8 * Ad);
    const Sm2 = K.m2ex * S.m + EN.m2 * V;
    const Em2 = Sm2 / (Sm2 + shift.m);
    const Em3 = S.m / (S.m + shift.m);
    const Eh1 = act('h1'), Ed1 = act('d1'), Ev1 = act('v1');
    const Eat1 = act('at1', EN.at1);
    const Eno = act('no'), Even = act('ven');
    const Ea2c = S.a2c / (S.a2c + 1);
    const hrf = (1 + K.hr.b1 * Eb1) / (1 + K.hr.m2 * Em2) * (1 - 0.7 * Eca) * (1 - K.hr.mem * Emem);
    const contr = (1 + K.contr.b1 * Eb1) * (1 - K.contr.m2 * Em2) * (1 - 0.35 * Eca) * (1 - K.hr.mem * Emem);
    const preload = (1 + 0.1 * Ea1) / (1 + 0.5 * Even);
    const sv = K.svr;
    const svrf = (1 + sv.a1 * Ea1 + sv.a2 * Ea2 + 1.5 * Ev1 + 1.7 * Eat1) /
      ((1 + sv.b2 * Eb2) * (1 + sv.m3 * Em3) * (1 + 1.3 * Eno) * (1 + 0.9 * Eh1) * (1 + 0.5 * Ed1) * (1 + 0.6 * Eca));
    const blk = r => (shift[r] - 1) / shift[r];
    return {
      hrf, contr, preload, svrf, Ea2c, Eres, Eache, Eca, gT, Emem, Sb2raw,
      E: { a1: Ea1, a2: Ea2, b1: Eb1, b2: Eb2, m2: Em2, m3: Em3, n: En, h1: Eh1, d1: Ed1, v1: Ev1, at1: Eat1, no: Eno, ven: Even, net: Erel, a2c: Ea2c },
      B: { a1: blk('a1'), a2: blk('a2'), b1: blk('b1'), b2: blk('b2'), m: blk('m'), n: blk('n'), h1: blk('h1'), at1: blk('at1'), net: thNet, ca: Eca, ache: Eache, res: 1 - store },
      shift
    };
  }

  function initRat(s, sp) {
    const K = sp.K;
    if (!K.D) K.build();
    K.REF = computeEffectsRat({ c: {}, ce: {}, cns: {}, sym: 1, vag: 1, store: 1 }, K);
    s.arrest = false; s.lowHr = 0; s.lagB2 = 0;
  }

  function hemoRat(s, fx, sp) {
    const K = sp.K, B = sp.base, R = K.REF;
    const hrTarget = clamp(B.hr * fx.hrf / R.hrf, sp.hrMin, sp.hrMax);
    const rel = Math.max(s.hr / B.hr, 0.05);
    const cr = fx.contr / R.contr, pl = fx.preload / R.preload;
    const sv = B.sv * Math.pow(cr, K.svContr) * pl * Math.pow(rel, K.coPow - 1);
    const svr = fx.svrf / R.svrf;
    const coRel = Math.pow(rel, K.coPow) * Math.pow(cr, K.svContr) * pl;
    const mapTarget = clamp(B.map * coRel * svr, 0, 260);
    return { hrTarget, sv, co: Math.max(s.hr, 0) * sv, svr, mapTarget, cr };
  }

  function stepRat(m, dt) {
    const s = m.s, K = m.sp.K, D = K.D;
    const fx0 = computeEffectsRat(s, K);
    for (const id in s.c) {
      const d = D[id];
      let t12 = d.t12;
      if (d.ache) t12 *= 1 + 9 * fx0.Eache;
      s.c[id] *= Math.exp(-Math.LN2 / t12 * dt);
      s.ce[id] += (s.c[id] - s.ce[id]) * (1 - Math.exp(-dt / d.onset));
      if (d.cns) s.cns[id] += (s.c[id] - s.cns[id]) * (1 - Math.exp(-dt / d.cns));
      if (s.c[id] < 1e-7 && s.ce[id] < 1e-7 && (!d.cns || s.cns[id] < 1e-7)) {
        delete s.c[id]; delete s.ce[id]; delete s.cns[id];
      }
    }
    if (K.lagB2) s.lagB2 = (s.lagB2 || 0) + (fx0.Sb2raw - (s.lagB2 || 0)) * (1 - Math.exp(-dt / K.lagB2));
    const fx = computeEffectsRat(s, K);
    let storeTarget = 1 - 0.95 * fx.Eres;
    if (m.prep.store !== undefined) storeTarget = Math.min(storeTarget, m.prep.store);
    s.store += (storeTarget - s.store) * (1 - Math.exp(-dt / (storeTarget < s.store ? 30 : 240)));

    const B = m.sp.base, bk = K.baro;
    const setPoint = B.map * (1 - 0.22 * fx.Ea2c);
    const e = (s.map - setPoint) / B.map;
    let symT = clamp((1 - (e > 0 ? bk.symUp : bk.symDown) * e) / (1 + 1.5 * fx.Ea2c), 0.03, 4);
    let vagT = clamp((1 + (e > 0 ? bk.vagUp : bk.vagDown) * e) * (1 + 0.8 * fx.Ea2c), 0, 4);
    if (m.prep.pithed) { symT = m.prep.symTone; vagT = 0; }
    s.sym += (symT - s.sym) * (1 - Math.exp(-dt / bk.tauSym));
    s.vag += (vagT - s.vag) * (1 - Math.exp(-dt / bk.tauVag));

    const h = hemoRat(s, fx, m.sp);
    let hrT = m.prep.hrFactor ? h.hrTarget * m.prep.hrFactor : h.hrTarget;
    let mapT = h.mapTarget, tauHr = K.tauHr, tauMap = K.tauMap;
    // Paro cardíaco: FC por debajo del umbral crítico durante varios segundos
    if (K.arrest && !s.arrest) {
      s.lowHr = s.hr < K.arrest.hr ? s.lowHr + dt : 0;
      if (s.lowHr >= K.arrest.secs) s.arrest = true;
    }
    if (s.arrest) { hrT = 0; mapT = 0; tauHr = K.arrest.tauHr; tauMap = K.arrest.tauMap; }
    s.hr += (hrT - s.hr) * (1 - Math.exp(-dt / tauHr));
    s.map += (mapT - s.map) * (1 - Math.exp(-dt / tauMap));
    s.t = Math.round((s.t + dt) * 1000) / 1000;
    m.record(fx, h);
  }

  function recordRat(m, fx, h) {
    const s = m.s, K = m.sp.K, SB = m.sp.base;
    fx = fx || computeEffectsRat(s, K);
    h = h || hemoRat(s, fx, m.sp);
    const cr = fx.contr / K.REF.contr;
    const pp = SB.pp * Math.pow(cr, K.ppContr) * Math.pow(Math.max(s.map, 0) / SB.map, K.ppMap);
    const r3 = v => Math.round(v * 1000) / 1000;
    const E = {}, Bk = {};
    for (const k in fx.E) E[k] = r3(fx.E[k]);
    for (const k in fx.B) Bk[k] = r3(fx.B[k]);
    m.points.push({
      t: s.t,
      sys: s.map + pp * 2 / 3,
      dia: Math.max(0, s.map - pp / 3),
      map: s.map,
      hr: Math.max(0, s.hr),
      sv: h.sv, co: Math.max(s.hr, 0) * h.sv / 1000, svr: h.svr,
      contr: cr,
      sym: s.sym, vag: s.vag, gT: fx.gT,
      arrest: s.arrest || undefined,
      E, B: Bk
    });
  }

  class Model {
    constructor(opts) {
      opts = opts || {};
      this.sp = SPECIES[opts.species] || SPECIES.humano;
      this.prep = PREPS[opts.prep] || PREPS.normal;
      this.species = this.sp.id;
      this.prepId = this.prep.id;
      this.s = freshState(this.sp);
      this.D = this.sp.K ? (this.sp.K.D || (this.sp.K.build(), this.sp.K.D)) : DRUG_BY_ID;
      if (this.sp.K) initRat(this.s, this.sp);
      if (this.prep.pithed) { this.s.sym = this.prep.symTone; this.s.vag = 0; }
      this.points = [];
      this.events = [];
      this.record();
      // Una preparación distinta de la normal se deja estabilizar antes de empezar el registro
      if (this.prep !== PREPS.normal) this.equilibrate(this.prep.store !== undefined ? 400 : 90);
    }

    equilibrate(seconds) {
      this.run(seconds);
      const last = this.points[this.points.length - 1];
      this.s.t = 0;
      last.t = 0;
      this.points = [last];
    }

    activeDrugs(threshold) {
      const out = [];
      for (const id in this.s.ce) {
        const d = this.D[id];
        const c = Math.max(this.s.ce[id], this.s.c[id] || 0);
        const ref = d.ag ? Math.min(...Object.values(d.ag)) : d.ant ? Math.min(...Object.values(d.ant)) : Math.min(...Object.values(d.inh));
        if (c / ref > (threshold || 0.15)) out.push({ id, rel: c / ref });
      }
      return out;
    }

    inject(drugId, micrograms, meta) {
      const d = DRUG_BY_ID[drugId];
      if (!d || !(micrograms > 0)) return null;
      const s = this.s;
      const fx = computeEffects(s);
      const pre = this.points[this.points.length - 1];
      // Cantidad en µg equivalentes del modelo (en el humano, la misma)
      s.c[drugId] = (s.c[drugId] || 0) + micrograms * this.sp.scale;
      if (s.ce[drugId] === undefined) s.ce[drugId] = 0;
      if (d.cns && s.cns[drugId] === undefined) s.cns[drugId] = 0;
      const evt = Object.assign({
        n: this.events.length + 1,
        t: s.t,
        drugId,
        ug: micrograms,
        species: this.sp.id,
        prep: this.prep.id,
        pre: { sys: pre.sys, dia: pre.dia, map: pre.map, hr: pre.hr },
        ctx: { B: Object.assign({}, fx.B), modifiers: this.activeDrugs(0.3).filter(a => a.id !== drugId || true) }
      }, meta || {});
      this.events.push(evt);
      return evt;
    }

    step(dt) {
      dt = dt || DT;
      if (this.sp.K) return stepRat(this, dt);
      const s = this.s;
      const fx0 = computeEffects(s);
      // Farmacocinética: eliminación y compartimento efecto
      for (const id in s.c) {
        const d = DRUG_BY_ID[id];
        let t12 = d.t12;
        if (d.ache) t12 *= 1 + 9 * fx0.Eache;
        s.c[id] *= Math.exp(-Math.LN2 / t12 * dt);
        s.ce[id] += (s.c[id] - s.ce[id]) * (1 - Math.exp(-dt / d.onset));
        if (d.cns) s.cns[id] += (s.c[id] - s.cns[id]) * (1 - Math.exp(-dt / d.cns));
        if (s.c[id] < 1e-7 && s.ce[id] < 1e-7 && (!d.cns || s.cns[id] < 1e-7)) {
          delete s.c[id]; delete s.ce[id]; delete s.cns[id];
        }
      }
      const fx = computeEffects(s);
      // Depósitos de noradrenalina (reserpina)
      let storeTarget = 1 - 0.95 * fx.Eres;
      if (this.prep.store !== undefined) storeTarget = Math.min(storeTarget, this.prep.store);
      s.store += (storeTarget - s.store) * (1 - Math.exp(-dt / (storeTarget < s.store ? 30 : 240)));

      // Barorreflejo
      // La clonidina central desplaza el punto de ajuste del barorreflejo hacia abajo
      const B = this.sp.base;
      const setPoint = B.map * (1 - 0.22 * fx.Ea2c);
      const e = (s.map - setPoint) / B.map;
      let symT = clamp((1 - (e > 0 ? 0.7 : 2.2) * e) / (1 + 1.5 * fx.Ea2c), 0.03, 3.5);
      let vagT = clamp((1 + (e > 0 ? 6.0 : 2.5) * e) * (1 + 0.8 * fx.Ea2c), 0, 4);
      // Animal descentralizado: sin control central no hay reflejo ni tono vagal
      if (this.prep.pithed) { symT = this.prep.symTone; vagT = 0; }
      s.sym += (symT - s.sym) * (1 - Math.exp(-dt / 4.0));
      s.vag += (vagT - s.vag) * (1 - Math.exp(-dt / 1.0));

      const h = hemo(s, fx, this.sp);
      // hrFactor: menor FC del animal descentralizado (sin impulso central ni tono simpático)
      const hrT = this.prep.hrFactor ? h.hrTarget * this.prep.hrFactor : h.hrTarget;
      s.hr += (hrT - s.hr) * (1 - Math.exp(-dt / 1.0));
      s.map += (h.mapTarget - s.map) * (1 - Math.exp(-dt / 1.5));
      s.t = Math.round((s.t + dt) * 1000) / 1000;
      this.record(fx, h);
    }

    record(fx, h) {
      if (this.sp.K) return recordRat(this, fx, h);
      const s = this.s;
      fx = fx || computeEffects(s);
      h = h || hemo(s, fx, this.sp);
      const sv = h.sv;
      const SB = this.sp.base;
      const pp = SB.pp * (sv / SB.sv) * Math.sqrt(Math.max(s.map, 10) / SB.map);
      const r3 = v => Math.round(v * 1000) / 1000;
      const E = {}, B = {};
      for (const k in fx.E) E[k] = r3(fx.E[k]);
      for (const k in fx.B) B[k] = r3(fx.B[k]);
      this.points.push({
        t: s.t,
        sys: s.map + pp * 2 / 3,
        dia: s.map - pp / 3,
        map: s.map,
        hr: s.hr,
        sv, co: s.hr * sv / 1000, svr: h.svr,
        contr: fx.contr / REF.contr,
        sym: s.sym, vag: s.vag, gT: fx.gT,
        E, B
      });
    }

    run(seconds) {
      const n = Math.round(seconds / DT);
      for (let i = 0; i < n; i++) this.step(DT);
    }

    /* Avanza hasta que la respuesta se estabiliza (modo inmediato) */
    runUntilSettled(minS, maxS, drugId) {
      const t0 = this.s.t;
      const dd = this.D[drugId];
      if (dd) minS = Math.max(minS, dd.onset * 5, (dd.cns || 0) * 4);
      // En la rata las respuestas duran varios minutos, como en el registro original
      const rat = !!this.sp.K, lag = rat ? 301 : 31;
      if (rat) { minS = Math.max(minS, 60); maxS = Math.max(maxS, 600); }
      this.run(minS);
      while (this.s.t - t0 < maxS) {
        this.run(1);
        const p = this.points, n = p.length;
        const a = p[n - 1], b = p[n - lag];
        if (!b) continue;
        if (Math.abs(a.map - b.map) < (rat ? 0.6 : 0.25) && Math.abs(a.hr - b.hr) < (rat ? 1 : 0.3)) {
          const allTiny = Object.keys(this.s.c).every(id => {
            const d = this.D[id];
            return d.t12 > 200 || this.s.ce[id] < 0.05 * (d.ag ? Math.min(...Object.values(d.ag)) : 1);
          });
          if (allTiny) break;
        }
      }
      return this.s.t - t0;
    }
  }

  /* Métricas de respuesta en una ventana */
  function responseMetrics(points, t0, t1) {
    const i0 = Math.max(0, Math.round(t0 / DT));
    const pre = points[Math.max(0, i0)];
    if (!pre) return null;
    const keys = ['sys', 'dia', 'map', 'hr'];
    const res = {};
    keys.forEach(k => { res[k] = { max: 0, min: 0, tMax: 0, tMin: 0 }; });
    let end = null;
    for (let i = i0; i < points.length; i++) {
      const p = points[i];
      if (p.t > t1 + 1e-6) break;
      end = p;
      keys.forEach(k => {
        const d = p[k] - pre[k];
        if (d > res[k].max) { res[k].max = d; res[k].tMax = p.t - t0; }
        if (d < res[k].min) { res[k].min = d; res[k].tMin = p.t - t0; }
      });
    }
    const out = { pre: { sys: pre.sys, dia: pre.dia, map: pre.map, hr: pre.hr } };
    keys.forEach(k => {
      const r = res[k];
      const peak = Math.abs(r.max) >= Math.abs(r.min) ? r.max : r.min;
      out[k] = {
        peak, tPeak: peak === r.max ? r.tMax : r.tMin, up: r.max, down: r.min,
        end: end ? end[k] - pre[k] : 0
      };
    });
    out.window = end ? end.t - t0 : 0;
    // Duración: tiempo hasta que la PAM vuelve a ±25 % del pico
    const pk = out.map.peak;
    let dur = 0;
    if (Math.abs(pk) > 2) {
      for (let i = i0; i < points.length && points[i].t <= t1 + 1e-6; i++) {
        if (Math.abs(points[i].map - pre.map) >= Math.abs(pk) * 0.25) dur = points[i].t - t0;
      }
    }
    out.duration = dur;
    return out;
  }

  /* Respuesta control: misma dosis en un sujeto sin fármacos previos */
  const controlCache = new Map();
  function controlResponse(drugId, ug, opts) {
    opts = opts || {};
    const sp = SPECIES[opts.species] || SPECIES.humano, prep = PREPS[opts.prep] || PREPS.normal;
    const key = drugId + ':' + ug.toPrecision(6) + ':' + sp.id + ':' + prep.id;
    if (controlCache.has(key)) return controlCache.get(key);
    const m = new Model({ species: sp.id, prep: prep.id });
    m.run(2);
    const t0 = m.s.t;
    m.inject(drugId, ug);
    const d = m.D[drugId];
    if (sp.K) m.run(d.t12 > 200 ? 360 : 300);
    else m.run(d.t12 > 200 ? 60 : Math.min(120, Math.max(40, d.t12 * 4 + 20)));
    const r = responseMetrics(m.points, t0, m.s.t);
    controlCache.set(key, r);
    return r;
  }


  /* ==========================================================
     Interpretación de respuestas y de la sesión
     ========================================================== */
  const fmt = (v, d) => (Math.abs(v) < 0.5 ? '±' : v > 0 ? '+' : '−') + Math.abs(v).toFixed(d === undefined ? 0 : d);

  function compare(act, ctrl, thr) {
    if (Math.abs(ctrl) < thr * 1.5) {
      if (Math.abs(act) >= thr * 2) return 'nuevo';
      return 'igual';
    }
    const ratio = act / ctrl;
    if (ratio < -0.15 && Math.abs(act) >= thr) return 'invertida';
    if (Math.abs(act) < thr || ratio < 0.25) return 'abolida';
    if (ratio < 0.65) return 'atenuada';
    if (ratio > 1.5) return 'potenciada';
    return 'similar';
  }

  const CMP_LABEL = {
    invertida: 'Invertida', abolida: 'Abolida', atenuada: 'Atenuada', potenciada: 'Potenciada',
    similar: 'Similar al control', igual: 'Sin cambio', nuevo: 'Efecto nuevo'
  };

  function modifierNames(evt, filter) {
    const ids = (evt.ctx.modifiers || []).map(m => m.id).filter(id => id !== evt.drugId);
    return ids.filter(id => !filter || filter(DRUG_BY_ID[id])).map(id => DRUG_BY_ID[id].name);
  }
  const join = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1];
  const byAnt = r => d => d.ant && d.ant[r];
  const byInh = k => d => d.inh && d.inh[k];

  function interpretEvent(evt, resp, ctrl) {
    const spE = SPECIES[evt.species] || SPECIES.humano;
    const d = spE.K ? spE.K.D[evt.drugId] : DRUG_BY_ID[evt.drugId];
    const B = evt.ctx.B;
    const map = resp.map, hr = resp.hr;
    // Umbrales de la especie (en el humano, 4 mmHg y 4 lpm)
    const sp = SPECIES[evt.species] || SPECIES.humano;
    const tM = sp.thr.map, tH = sp.thr.hr, kH = tH / 4;
    const tags = [];
    if (map.up >= tM && map.down <= -tM) tags.push({ k: 'bi', label: 'Bifásica' });
    else if (map.peak >= tM) tags.push({ k: 'up', label: 'Presora' });
    else if (map.peak <= -tM) tags.push({ k: 'down', label: 'Depresora' });
    if (hr.peak >= tH) tags.push({ k: 'up', label: 'Taquicardia' });
    else if (hr.peak <= -tH) tags.push({ k: 'down', label: 'Bradicardia' });
    if (!tags.length) tags.push({ k: 'flat', label: 'Sin efecto relevante' });

    const others = modifierNames(evt);
    const cmp = ctrl ? { map: compare(map.peak, ctrl.map.peak, tM), hr: compare(hr.peak, ctrl.hr.peak, tH) } : null;
    const notes = [];
    const changed = cmp && (!['similar', 'igual'].includes(cmp.map) || !['similar', 'igual'].includes(cmp.hr));
    const id = d.id;

    if (changed) {
      if (id === 'adr' && B.a1 > 0.6 && cmp.map === 'invertida')
        notes.push('Inversión adrenalínica de Dale: con α1 bloqueado (' + join(modifierNames(evt, byAnt('a1'))) + ') queda sin oposición la vasodilatación β2 y la adrenalina se vuelve depresora.');
      if ((id === 'adr' || id === 'nor' || id === 'eph') && B.b2 > 0.6 && B.b1 > 0.6 && (cmp.map === 'potenciada' || cmp.map === 'invertida'))
        notes.push('Con los receptores β bloqueados (' + join(modifierNames(evt, byAnt('b1'))) + ') desaparece la vasodilatación β2 y la acción α1 actúa sin oposición: la respuesta presora aumenta.');
      if ((id === 'iso' || id === 'dob' || id === 'sal') && (B.b1 > 0.6 || B.b2 > 0.6) && ['abolida', 'atenuada'].includes(cmp.hr))
        notes.push('El bloqueo β (' + join(modifierNames(evt, d => d.ant && (d.ant.b1 || d.ant.b2))) + ') impide la acción de ' + d.name.toLowerCase() + ' en sus receptores.');
      if (id === 'iso' && B.b1 > 0.6 && B.b2 < 0.3 && cmp.map !== 'abolida')
        notes.push('El bloqueo es cardioselectivo (β1): la vasodilatación β2 se conserva y la presión sigue bajando.');
      if (ctrl && ctrl.map.peak >= tM && ctrl.hr.peak <= -3 * kH && B.m > 0.6 && hr.peak > ctrl.hr.peak + 3 * kH && id !== 'ach')
        notes.push('La bradicardia refleja es vagal (M2). Con atropina el reflejo no puede frenar el corazón y aparece el efecto cardíaco directo o una taquicardia.');
      if (B.n > 0.6 && ctrl && Math.abs(map.peak) > Math.abs(ctrl.map.peak) * 1.3 && id !== 'nic')
        notes.push('Con los ganglios bloqueados (' + join(modifierNames(evt, byAnt('n'))) + ') no funciona el barorreflejo: nada amortigua el cambio de presión.');
      if (id === 'ach' && B.m > 0.6 && map.up >= tM * 0.75)
        notes.push('Segundo experimento de Dale: con los receptores muscarínicos bloqueados, la acetilcolina a dosis alta estimula receptores nicotínicos de ganglios y médula suprarrenal y produce una respuesta presora.');
      else if ((id === 'ach' || id === 'neo') && B.m > 0.6)
        notes.push('La atropina bloquea los receptores muscarínicos M2 y M3: la acetilcolina ya no produce bradicardia ni vasodilatación.');
      if (id === 'ach' && B.ache > 0.4 && cmp.map === 'potenciada')
        notes.push('La neostigmina inhibe la acetilcolinesterasa: la acetilcolina se degrada más despacio y su efecto es mayor y más prolongado.');
      if (d.netSub && B.net > 0.5 && cmp.map === 'potenciada')
        notes.push('La cocaína bloquea la recaptación neuronal (NET), principal vía de terminación de ' + d.name.toLowerCase() + ': su efecto se potencia.');
      if ((id === 'tyr' || id === 'eph') && B.net > 0.5 && ['abolida', 'atenuada'].includes(cmp.map))
        notes.push('La ' + d.name.toLowerCase() + ' necesita entrar en la terminal por NET para liberar noradrenalina; la cocaína le cierra la entrada.' + (id === 'eph' ? ' Persiste su componente directo.' : ''));
      if ((id === 'tyr' || id === 'eph') && B.res > 0.5 && ['abolida', 'atenuada'].includes(cmp.map))
        notes.push('La reserpina vació los depósitos de noradrenalina: el simpaticomimético indirecto no tiene qué liberar.' + (id === 'eph' ? ' El componente directo de la efedrina explica la respuesta residual.' : ''));
      if (B.res > 0.5 && (id === 'nor' || id === 'adr' || id === 'phe') && cmp.map === 'potenciada')
        notes.push('Tras la reserpina, los agonistas directos siguen actuando y el reflejo simpático está debilitado: la respuesta es igual o mayor.');
      if (id === 'his' && B.h1 > 0.6) notes.push('La difenhidramina bloquea H1 de forma competitiva y anula la vasodilatación por histamina.');
      if (id === 'ang' && B.at1 > 0.6) notes.push('El losartán bloquea AT1: la angiotensina II no puede contraer el músculo liso vascular.');
      if ((id === 'phe' || id === 'nor' || id === 'adr' || id === 'dop') && B.a1 > 0.6 && ['abolida', 'atenuada'].includes(cmp.map))
        notes.push('El bloqueo α1 (' + join(modifierNames(evt, byAnt('a1'))) + ') impide la vasoconstricción.');
      if (B.ca > 0.4 && ctrl && Math.abs(hr.peak) < Math.abs(ctrl.hr.peak) * 0.75)
        notes.push('El verapamilo deprime el nodo sinusal: la respuesta de frecuencia cardíaca queda limitada.');
      if (id === 'nic' && B.n > 0.6) notes.push('El hexametonio bloquea el receptor nicotínico ganglionar donde actúa la nicotina.');
      if (!notes.length && others.length)
        notes.push('Respuesta modificada respecto al control por la presencia de ' + join(others) + '.');
    }
    if (id === 'avp' && B.a1 > 0.6 && cmp && ['similar', 'potenciada'].includes(cmp.map))
      notes.push('La vasopresina actúa por receptores V1: el bloqueo α no la afecta, lo que confirma que el músculo liso sigue respondiendo.');
    if (!changed && others.length && cmp)
      notes.push('Respuesta comparable al control a pesar de ' + join(others) + ': los fármacos previos no actúan sobre la vía de ' + d.name.toLowerCase() + '.');

    return { tags, cmp, notes, changed, mechanism: d.desc };
  }

  function interpretSession(model) {
    const ev = model.events;
    const pts = model.points;
    const items = ev.map((e, i) => {
      const t1 = i + 1 < ev.length ? ev[i + 1].t : model.s.t;
      const resp = responseMetrics(pts, e.t, t1);
      const ctrl = controlResponse(e.drugId, e.ug, { species: model.species, prep: model.prepId });
      return { evt: e, resp, ctrl, info: interpretEvent(e, resp, ctrl) };
    });
    let maxMap = -Infinity, minMap = Infinity, maxHr = -Infinity, minHr = Infinity;
    pts.forEach(p => {
      if (p.map > maxMap) maxMap = p.map; if (p.map < minMap) minMap = p.map;
      if (p.hr > maxHr) maxHr = p.hr; if (p.hr < minHr) minHr = p.hr;
    });
    const findings = items.filter(x => x.info.changed);
    const last = pts[pts.length - 1];
    const blocks = [];
    const B = last.B;
    const recName = { a1: 'α1', a2: 'α2', b1: 'β1', b2: 'β2', m: 'muscarínicos', n: 'nicotínicos ganglionares', h1: 'H1', at1: 'AT1', net: 'NET (recaptación)' };
    for (const r in recName) if (B[r] > 0.6) blocks.push(recName[r] + ' (' + Math.round(B[r] * 100) + ' %)');
    const extras = [];
    if (B.ache > 0.4) extras.push('acetilcolinesterasa inhibida (' + Math.round(B.ache * 100) + ' %)');
    if (B.ca > 0.3) extras.push('canales de Ca²⁺ bloqueados (' + Math.round(B.ca * 100) + ' %)');
    if (B.res > 0.3) extras.push('depósitos de noradrenalina al ' + Math.round((1 - B.res) * 100) + ' %');

    const conclusions = [];
    if (!items.length) return { items, findings, conclusions, stats: null, blocks, extras };
    const tM = (SPECIES[model.species] || SPECIES.humano).thr.map;
    const pressors = items.filter(x => x.resp.map.peak >= tM).map(x => DRUG_BY_ID[x.evt.drugId].name);
    const depress = items.filter(x => x.resp.map.peak <= -tM).map(x => DRUG_BY_ID[x.evt.drugId].name);
    const uniq = a => [...new Set(a)];
    if (pressors.length) conclusions.push('Respuestas presoras: ' + join(uniq(pressors)) + '.');
    if (depress.length) conclusions.push('Respuestas depresoras: ' + join(uniq(depress)) + '.');
    findings.forEach(f => {
      const n = DRUG_BY_ID[f.evt.drugId].name;
      const c = f.info.cmp;
      const parts = [];
      if (!['similar', 'igual'].includes(c.map)) parts.push('presión ' + CMP_LABEL[c.map].toLowerCase());
      if (!['similar', 'igual'].includes(c.hr)) parts.push('FC ' + CMP_LABEL[c.hr].toLowerCase());
      conclusions.push('#' + f.evt.n + ' ' + n + ': ' + parts.join(', ') + ' respecto al control. ' + (f.info.notes[0] || ''));
    });
    // Repeticiones del mismo fármaco a la misma dosis: comparar primera y última
    const byDrug = {}, byDose = {};
    items.forEach(x => {
      (byDrug[x.evt.drugId] = byDrug[x.evt.drugId] || []).push(x);
      const k = x.evt.drugId + ':' + x.evt.ug.toPrecision(5);
      (byDose[k] = byDose[k] || []).push(x);
    });
    for (const k in byDose) {
      const arr = byDose[k];
      if (arr.length < 2) continue;
      const a = arr[0], b = arr[arr.length - 1];
      const dn = DRUG_BY_ID[a.evt.drugId].name;
      const dose = a.evt.doseLabel || (Math.round(a.evt.ug * 100) / 100 + ' µg');
      conclusions.push(dn + ' ' + dose + ' se repitió ' + arr.length + ' veces: la PAM pasó de ' + fmt(a.resp.map.peak) + ' mmHg (#' + a.evt.n + ') a ' + fmt(b.resp.map.peak) + ' mmHg (#' + b.evt.n + ') y la FC de ' + fmt(a.resp.hr.peak) + ' a ' + fmt(b.resp.hr.peak) + ' lpm.');
    }
    if (blocks.length || extras.length) conclusions.push('Al final de la sesión persisten: ' + join(blocks.map(b => 'bloqueo ' + b).concat(extras)) + '.');
    return {
      items, findings, conclusions, blocks, extras,
      stats: { duration: model.s.t, n: items.length, drugs: Object.keys(byDrug).length, maxMap, minMap, maxHr, minHr, final: last }
    };
  }

  SPECIES.rata.K = K_RAT;

  const api = { DT, BASE, SPECIES, K_RAT, PREPS, DRUGS, DRUG_BY_ID, CATEGORIES, REC_LABEL, Model, toMicrograms, responseMetrics, controlResponse, computeEffects, interpretEvent, interpretSession, CMP_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardioEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
