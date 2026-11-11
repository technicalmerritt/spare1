'use strict';
// Runs every macOS collector outside the app and prints what came back.
// Usage: npm run collect            (summary)
//        npm run collect -- --full  (full JSON, for bug reports)
const full = process.argv.includes('--full');
const mods = {
  inform: () => require('../src/main/mac/inform').runInform(),
  battery: () => require('../src/main/mac/battery').runBattery(),
  drives: () => require('../src/main/mac/drives').runDrives(),
  startup: () => require('../src/main/mac/startup').runList(),
  devices: () => require('../src/main/mac/devices').runDevices(),
  net: () => require('../src/main/mac/net').info(),
  crash: () => require('../src/main/mac/crash').runCrash(),
};
function shape(v, depth) {
  if (Array.isArray(v)) return v.length ? '[' + v.length + ' x ' + shape(v[0], depth + 1) + ']' : '[]';
  if (v && typeof v === 'object') { if (depth > 1) return '{...}'; return '{' + Object.keys(v).map((k) => k + ': ' + shape(v[k], depth + 1)).join(', ') + '}'; }
  return v === null ? 'null' : typeof v === 'string' ? JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v) : String(v);
}
(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(mods)) {
    const t = Date.now();
    try {
      const d = await fn();
      console.log('\n== ' + name + ' (' + (Date.now() - t) + ' ms) ==');
      console.log(full ? JSON.stringify(d, null, 2) : shape(d, 0));
    } catch (e) { failed++; console.log('\n== ' + name + ' FAILED: ' + ((e && e.stack) || e)); }
  }
  if (process.argv.includes('--scan')) {
    const scan = require('../src/main/mac/scan-collect');
    const rules = require('../src/main/mac/rules');
    const t = Date.now();
    const data = await scan.collect((s) => console.log('  step: ' + s));
    const r = rules.evaluate(data);
    console.log('\n== scan (' + (Date.now() - t) + ' ms) score ' + r.score + ' ' + JSON.stringify(r.counts));
    console.log(r.summary);
    for (const f of r.findings) console.log('  ' + f.severity.padEnd(8) + ' ' + f.category.padEnd(12) + f.title);
  }
  process.exit(failed ? 1 : 0);
})();
