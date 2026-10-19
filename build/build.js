// Genera index.html incrustando src/engine.js sin modificar y la aplicación
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
if (engine.includes('</script')) throw new Error('engine.js contiene </script>');
const out = tpl.replace('/*__ENGINE__*/', () => engine).replace('/*__APP__*/', () => app);
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('index.html', out.length, 'bytes');
