'use strict';

// macOS build: the Windows app runs PowerShell collector scripts through this
// module. Here the same entry point routes each request to a native macOS
// collector that returns the same data shape, so the rest of the app (IPC
// handlers and screens) is shared with the Windows edition. Requests for
// Windows-only features reject with a clear message.

const path = require('node:path');
const battery = require('./mac/battery');
const devices = require('./mac/devices');
const crash = require('./mac/crash');
const net = require('./mac/net');
const drives = require('./mac/drives');

function argOf(args, name) {
  const a = Array.isArray(args) ? args.map(String) : [];
  const i = a.indexOf(name);
  return i >= 0 && i + 1 < a.length ? a[i + 1] : '';
}

async function speedForDisk(diskNumber, onProgress) {
  const list = await drives.runDrives();
  const dr = (list.drives || []).find((d) => String(d.number) === String(diskNumber));
  if (!dr) return { error: 'open', detail: 'disk not found' };
  const ext = (dr.volumes || []).find((v) => /^\/Volumes\//.test(v.drive));
  const mount = dr.internal || !ext ? '/' : ext.drive;
  if (!dr.internal && !ext) return { error: 'open', detail: 'no mounted volume on this disk to test' };
  const r = await drives.speedTest(mount, onProgress);
  if (!r.ok) return { error: 'open', detail: r.error };
  return { readMBps: r.readMBps, writeMBps: r.writeMBps, writeDrive: mount === '/' ? 'startup disk' : mount, writeNote: 'Tested with a 512 MB temporary file, removed afterwards. ' + r.note };
}

const ROUTES = {
  'battery/battery.ps1': () => battery.runBattery(),
  'devices/devices.ps1': () => devices.runDevices(),
  'crash/crash.ps1': () => crash.runCrash(),
  'net/net.ps1': (o) => {
    const action = argOf(o.scriptArgs, '-Action');
    if (action === 'info') return net.info();
    if (action === 'ping') return net.ping(argOf(o.scriptArgs, '-Target'));
    if (action === 'discover') return net.discover(o.onProgress);
    return Promise.resolve({ ok: false, error: 'not-on-mac' });
  },
  'drives/speedtest.ps1': (o) => speedForDisk(argOf(o.scriptArgs, '-Disk'), o.onProgress),
};

function runPowerShellScript(opts) {
  const o = opts || {};
  const p = String(o.scriptPath || '').split(path.sep).join('/');
  const key = Object.keys(ROUTES).find((k) => p.endsWith('/' + k));
  if (!key) return Promise.reject(new Error('This feature is not available in the Mac version.'));
  const timeoutMs = o.timeoutMs || 120000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out after ' + Math.round(timeoutMs / 1000) + 's.')), timeoutMs);
    Promise.resolve().then(() => ROUTES[key](o)).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); }
    );
  });
}

module.exports = { runPowerShellScript };
