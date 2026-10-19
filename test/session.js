const E = require('../src/engine.js');
const m = new E.Model(); m.run(5);
const seq = [['nor',10,'µg'],['adr',10,'µg'],['iso',5,'µg'],['ach',10,'µg'],['atr',1,'mg'],['ach',10,'µg'],['ach',1000,'µg'],['nor',10,'µg'],['phn',2,'mg'],['adr',10,'µg'],['pro',2,'mg'],['iso',5,'µg'],['avp',2,'µg']];
for (const [id,d,u] of seq){ m.inject(id, E.toMicrograms(d,u,70)); m.runUntilSettled(20,150,id); }
const S = E.interpretSession(m);
S.items.forEach(x=>console.log('#'+x.evt.n, E.DRUG_BY_ID[x.evt.drugId].name, x.info.tags.map(t=>t.label).join('/'), x.info.cmp.map, x.info.cmp.hr, '|', x.info.notes.join(' ')));
console.log('---'); S.conclusions.forEach(c=>console.log('·',c)); console.log(S.stats.duration, m.points.length);
