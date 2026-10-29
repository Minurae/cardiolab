// Comparación del modo rata con los registros del CardioLab original que dio la profesora
// (10 gráficas de la Práctica 7, digitalizadas). Cada fila: cambio respecto al valor previo
// a la inyección; "up" = máximo, "down" = mínimo, "end" = valor al final del tramo.
const E = require('../src/engine.js');
const P = {
 iso:[['iso',3,5],['ate',1000,13.3],['iso',3,23],['pro',1000,32],['iso',3,40]],
 na_prz:[['nor',10,5],['prz',1000,13.5],['nor',0.3,22],['nor',10,27.5]],
 pe_prz:[['phe',100,5],['prz',1000,14],['phe',100,22]],
 na_pro:[['nor',0.3,5],['nor',1,11.5],['nor',10,19],['pro',1000,27],['nor',0.3,35],['nor',1,42],['nor',10,49]],
 adr:[['adr',0.3,5],['adr',1,13.5],['adr',10,23]],
 adr_pro:[['adr',0.3,5],['adr',1,13.5],['adr',10,23],['pro',1000,32.5],['adr',0.3,41],['adr',1,47.5],['adr',10,54.5]],
 adr_prz:[['adr',10,5],['prz',1000,15],['adr',10,23]],
 ach_atr:[['ach',1,5],['ach',10,13],['atr',0.5,19.5],['atr',10,25],['ach',10,38]],
 coc_tyr:[['coc',10000,5.5],['tyr',5000,13],['nor',1,21.8]],
 neo:[['ach',100,5],['atr',10,12],['ach',100,22],['neo',2000,31],['ach',100,38]]};
const END = {iso:46,na_prz:34,pe_prz:29,na_pro:56,adr:31,adr_pro:60,adr_prz:31,ach_atr:43,coc_tyr:28,neo:44};


const T = [
 ['na_prz',0,'hr','up',55,1],['na_prz',3,'hr','up',67,1],['na_prz',1,'hr','end',17,1],['na_prz',0,'sys','up',77,1],['na_prz',3,'sys','up',26,1],
 ['na_pro',0,'hr','up',4,.5],['na_pro',1,'hr','up',12,2],['na_pro',2,'hr','up',50,1],['na_pro',6,'hr','down',-4,.5],['na_pro',3,'hr','end',-22,1],['na_pro',3,'sys','end',-11,2],
 ['na_pro',0,'sys','up',12,1],['na_pro',1,'sys','up',38,2.5],['na_pro',2,'sys','up',76,1],['na_pro',4,'sys','up',11,1],['na_pro',5,'sys','up',28,2],['na_pro',6,'sys','up',72,1],
 ['coc_tyr',2,'hr','up',66,1],['coc_tyr',2,'sys','up',82,1],['coc_tyr',0,'hr','end',-8,.5],['coc_tyr',1,'sys','up',11,.5],
 ['adr',0,'hr','up',13,2],['adr',1,'hr','up',50,1],['adr',2,'hr','up',92,1],['adr',0,'dia','down',-15,1],['adr',1,'dia','down',-22,1],['adr',2,'dia','down',-20,1],['adr',1,'sys','up',15,1],['adr',2,'sys','up',56,1],
 ['adr_pro',6,'hr','up',9,.5],['adr_pro',6,'sys','up',56,1],['adr_pro',5,'sys','up',21,1],
 ['adr_prz',2,'hr','up',92,1],['adr_prz',2,'dia','down',-30,1],['adr_prz',1,'hr','end',17,1],['adr_prz',1,'sys','end',-14,1],
 ['iso',0,'hr','up',111,1],['iso',2,'hr','up',16,1],['iso',4,'hr','up',4,.5],['iso',0,'dia','down',-45,2],['iso',2,'dia','down',-32,1],['iso',0,'sys','up',15,.5],['iso',1,'hr','end',-13,1],['iso',3,'hr','end',-22,.5],
 ['pe_prz',0,'hr','up',5,.5],['pe_prz',0,'hr','down',-2,3],['pe_prz',0,'sys','up',76,1],['pe_prz',2,'sys','up',11,1],['pe_prz',1,'hr','end',17,1],
 ['ach_atr',0,'sys','down',-28,1],['ach_atr',1,'sys','down',-55,1],['ach_atr',1,'hr','down',-50,1],['ach_atr',0,'hr','down',-4,.5],['ach_atr',4,'sys','down',-35,1],['ach_atr',3,'hr','end',13,1],['ach_atr',2,'hr','end',5,.5],
 ['neo',0,'sys','down',-60,1],['neo',3,'hr','end',-18,1],['neo',4,'hr','end',-172,1],['neo',4,'sys','end',-80,1],['neo',2,'sys','down',-53,.5]];
const VI = { sys: 1, dia: 2, hr: 3 };
const sim = {};
for (const k in P) {
  const m = new E.Model({ species: 'rata' });
  for (const [id, d, tm] of P[k]) { m.run(tm * 60 - m.s.t); m.inject(id, E.toMicrograms(d, 'µg/kg', 0.3)); }
  m.run(END[k] * 60 - m.s.t);
  sim[k] = m.points.filter((p, i) => i % 10 === 0).map(p => [p.t / 60, p.sys, p.dia, p.hr]);
}
let bad = 0;
for (const [k, si, v, ty, tgt] of T) {
  const t0 = P[k][si][2], t1 = si + 1 < P[k].length ? P[k][si + 1][2] : END[k];
  const seg = sim[k].filter(x => x[0] >= t0 && x[0] < t1), vals = seg.map(x => x[VI[v]]), pre = vals[0];
  const val = ty === 'up' ? Math.max(...vals) - pre : ty === 'down' ? Math.min(...vals) - pre : vals[vals.length - 1] - pre;
  const off = Math.abs(val - tgt) > Math.max(8, Math.abs(tgt) * 0.35);
  if (off) bad++;
  console.log(k.padEnd(8), P[k][si][0], String(P[k][si][1]).padEnd(6), v.padEnd(3), ty.padEnd(4), 'original', String(tgt).padStart(5), ' simulador', val.toFixed(0).padStart(5), off ? ' <<' : '');
}
console.log('Fuera de tolerancia:', bad, 'de', T.length);
