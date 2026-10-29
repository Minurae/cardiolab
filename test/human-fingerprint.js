// Huella del modo humano: debe quedar idéntica tras cualquier cambio del modo rata
const E = require('../src/engine.js');
const crypto = require('crypto');
const h = crypto.createHash('sha256');
for (const prep of ['normal', 'reserpinizado', 'descentralizado']) {
  E.DRUGS.forEach(d => {
    const m = new E.Model({ prep });
    m.run(5); m.inject(d.id, d.dose); m.runUntilSettled(20, 200, d.id);
    m.inject('adr', 10); m.run(60); m.inject('ach', 10); m.run(30);
    m.points.forEach(p => h.update(p.t.toFixed(1) + p.sys.toFixed(6) + p.dia.toFixed(6) + p.hr.toFixed(6) + JSON.stringify(p.E) + JSON.stringify(p.B)));
    const it = E.interpretSession(m); h.update(JSON.stringify(it.items.map(x => x.info)) + JSON.stringify(it.conclusions || ''));
  });
}
console.log(h.digest('hex'));
