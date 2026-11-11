'use strict';
// Unit tests for the pure parts of the macOS layer (no Mac needed).
const assert = require('node:assert');
const util = require('../src/main/mac/util');
const rules = require('../src/main/mac/rules');
const crash = require('../src/main/mac/crash');
const drives = require('../src/main/mac/drives');
const battery = require('../src/main/mac/battery');
const net = require('../src/main/mac/net');

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok  ' + name); }

test('plist: dict, array, scalars, empty containers', () => {
  const p = util.parsePlist('<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.a&amp;b</string><key>RunAtLoad</key><true/><key>Disabled</key><false/><key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string></array><key>N</key><integer>42</integer><key>E</key><dict/><key>A</key><array/><key>Nest</key><dict><key>a</key><array><dict><key>z</key><real>1.5</real></dict></array></dict></dict></plist>');
  assert.deepStrictEqual(p, { Label: 'com.a&b', RunAtLoad: true, Disabled: false, ProgramArguments: ['/bin/sh', '-c'], N: 42, E: {}, A: [], Nest: { a: [{ z: 1.5 }] } });
  assert.strictEqual(util.parsePlist(''), null);
});

test('rules: empty input scores 100 and never throws', () => {
  const r = rules.evaluate({});
  assert.strictEqual(r.score, 100);
  assert.deepStrictEqual(r.findings, []);
});

test('rules: old macOS, full disk, worn battery, adware all flagged', () => {
  const r = rules.evaluate({
    system: { version: '12.7.6' },
    inform: { security: { sip: false, gatekeeper: false, fileVault: 'Off' }, volumes: [{ drive: '/', freePct: 3, freeGB: 7, sizeGB: 250 }], history: { timeMachineConfigured: false } },
    battery: { hasBattery: true, batteries: [{ wearPct: 31, cycleCount: 1100, maxCycles: 1000, maximumCapacityPct: 69, condition: 'Service Recommended' }] },
    startup: { items: [{ name: 'com.mackeeper.agent', enabled: true }] },
    crash: { dumps: [{ time: new Date().toISOString(), title: 'x', fix: 'f', why: 'w' }] },
  });
  const titles = r.findings.map((f) => f.title).join('|');
  for (const t of ['no longer patched', 'System Integrity Protection is OFF', 'Gatekeeper is disabled', 'FileVault disk encryption is off', 'Startup disk almost full', 'battery needs service', 'Possible adware', 'No Time Machine', '1 kernel panic']) assert.ok(titles.includes(t), 'missing: ' + t);
  assert.ok(r.counts.critical >= 4);
  assert.strictEqual(r.findings[0].severity, 'critical');
});

test('rules: supported macOS versions are not flagged', () => {
  const newest = rules.MACOS_ORDER[rules.MACOS_ORDER.length - 1];
  assert.strictEqual(rules.evaluate({ system: { version: newest + '.0' } }).findings[0].severity, 'ok');
  assert.strictEqual(rules.evaluate({ system: { version: '11.7' } }).findings[0].severity, 'warning');
});

test('rules: FileVault off is only informational on a desktop', () => {
  const f = rules.evaluate({ inform: { security: { fileVault: 'Off' } }, battery: { hasBattery: false } }).findings.find((x) => /FileVault/.test(x.title));
  assert.strictEqual(f.severity, 'info');
});

test('crash: panic string is pulled from a JSON report and classified', () => {
  const ps = crash.panicString('{"bug_type":"210"}\n{"panicString":"panic(cpu 4 caller 0xfffffe0012): userspace watchdog timeout: no successful checkins from WindowServer\\nKernel Extensions in backtrace:\\n   com.apple.driver.AppleNVMe(1.0)[A]@0x1\\n   com.vendor.kext.Thing(1.2)[B]@0x2\\n"}');
  const a = crash.analysePanic(ps);
  assert.ok(/watchdog/i.test(a.hint.title));
  assert.deepStrictEqual(a.thirdPartyKexts, ['com.vendor.kext.Thing']);
});

test('crash: Intel-style text panic and an unknown panic', () => {
  assert.ok(/Storage/.test(crash.analysePanic('panic(cpu 2 caller 0xffffff80): nvme: "Fatal error occurred. CSTS=0x1"').hint.title));
  assert.strictEqual(crash.analysePanic('panic(cpu 0 caller 0x0): something novel').hint.title, 'Kernel panic');
});

test('drives: smartctl NVMe and ATA JSON map to the shared shape', () => {
  const nv = drives.fromSmart({ model_name: 'APPLE SSD AP0512R', serial_number: 'S', firmware_version: '1', smart_status: { passed: true }, nvme_smart_health_information_log: { critical_warning: 0, temperature: 31, available_spare: 100, available_spare_threshold: 99, percentage_used: 3, data_units_read: 10, data_units_written: 20, power_cycles: 5, power_on_hours: 77, unsafe_shutdowns: 1, media_errors: 0 } });
  assert.strictEqual(nv.source, 'nvme-log');
  assert.strictEqual(nv.nvme.percentageUsed, 3);
  assert.strictEqual(nv.nvme.powerOnHours, 77);
  const ata = drives.fromSmart({ ata_smart_attributes: { table: [{ id: 5, value: 100, worst: 100, thresh: 10, raw: { value: 8 } }] }, temperature: { current: 35 }, power_on_time: { hours: 1234 } });
  assert.strictEqual(ata.source, 'ata-passthrough');
  assert.deepStrictEqual(ata.attrs[0], { id: 5, value: 100, worst: 100, threshold: 10, raw: 8 });
  assert.strictEqual(drives.fromSmart(null).source, 'none');
});

test('battery: ioreg key/value lines parse', () => {
  const m = battery.ioregMap('    | {\n      "CycleCount" = 123\n      "DesignCapacity" = 6075\n      "ExternalConnected" = Yes\n      "DeviceName" = "bq40z651"\n');
  assert.strictEqual(m.CycleCount, '123');
  assert.strictEqual(m.DeviceName, 'bq40z651');
  assert.strictEqual(m.ExternalConnected, 'Yes');
});

test('net: ping targets cannot smuggle options', () => {
  assert.ok(net.validTarget('8.8.8.8') && net.validTarget('router.local') && net.validTarget('2001:db8::1'));
  assert.ok(!net.validTarget('-c 1') && !net.validTarget('a b') && !net.validTarget('') && !net.validTarget('x;rm'));
});

console.log('\n' + n + ' tests passed');
