// Práctica Nº 7 en la rata anestesiada, con las dosis de la guía (µg/kg)
const E = require('../src/engine.js');
const W = E.SPECIES.rata.weight;
function exp(name, seq, prep) {
  const m = new E.Model({ species: 'rata', prep: prep || 'normal' }); m.run(5);
  const b = m.points[m.points.length - 1];
  console.log('== ' + name + '  basal ' + b.sys.toFixed(0) + '/' + b.dia.toFixed(0) + ' PAM ' + b.map.toFixed(0) + ' FC ' + b.hr.toFixed(0));
  for (const [id, d] of seq) { m.inject(id, E.toMicrograms(d, 'µg/kg', W), { doseLabel: d + ' µg/kg' }); m.runUntilSettled(20, 150, id); }
  E.interpretSession(m).items.forEach(x => {
    const r = x.resp;
    console.log(' #' + x.evt.n, E.DRUG_BY_ID[x.evt.drugId].name, x.evt.doseLabel, '| SIS', r.sys.peak.toFixed(0), 'DIA', r.dia.peak.toFixed(0), 'PAM', r.map.peak.toFixed(0), '(+' + r.map.up.toFixed(0) + '/' + r.map.down.toFixed(0) + ')', 'FC', r.hr.peak.toFixed(0), '|', x.info.tags.map(t => t.label).join('/'), '|', x.info.cmp.map, x.info.cmp.hr);
  });
}
exp('1abc Adrenalina, propranolol', [['adr', 0.3], ['adr', 1], ['adr', 10], ['pro', 1000], ['adr', 0.3], ['adr', 1], ['adr', 10]]);
exp('1de Adrenalina, prazosina', [['adr', 10], ['prz', 1000], ['adr', 10]]);
exp('2 Noradrenalina, propranolol', [['nor', 0.3], ['nor', 1], ['nor', 10], ['pro', 1000], ['nor', 0.3], ['nor', 1], ['nor', 10]]);
exp('2 Noradrenalina, prazosina', [['nor', 10], ['prz', 1000], ['nor', 10]]);
exp('3 Isoproterenol, atenolol, propranolol', [['iso', 3], ['ate', 1000], ['iso', 3], ['pro', 1000], ['iso', 3]]);
exp('4 Fenilefrina, prazosina', [['phe', 100], ['prz', 1000], ['phe', 100]]);
exp('5a Prazosina, animal normal', [['prz', 1000]]);
exp('5c Prazosina, animal descentralizado', [['prz', 1000]], 'descentralizado');
exp('Extra: animal reserpinizado, tiramina y noradrenalina', [['tyr', 50], ['nor', 1]], 'reserpinizado');
