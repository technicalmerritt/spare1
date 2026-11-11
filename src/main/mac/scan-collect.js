'use strict';

// Gathers everything the Issue Scanner's Mac rules look at, reusing the tab
// collectors so the scanner and the tabs can never disagree.

const os = require('node:os');
const { run, readPlistFile, num, clean } = require('./util');
const inform = require('./inform');
const drives = require('./drives');
const battery = require('./battery');
const startup = require('./startup');
const crash = require('./crash');
const devices = require('./devices');

function line(text, re) { const m = re.exec(text || ''); return m ? m[1].trim() : ''; }

async function pendingUpdates() {
  // Asks Apple's update servers, so it needs the internet and can take a while.
  const r = await run('/usr/sbin/softwareupdate', ['-l'], { timeoutMs: 60000 });
  const text = r.out + '\n' + r.err;
  if (r.timedOut) return { checked: false, reason: 'timed out' };
  if (/No new software available/i.test(text)) return { checked: true, updates: [] };
  const ups = []; const re = /\*\s*Label:\s*(.+)\n\s*Title:\s*([^,\n]+)(?:,\s*Version:\s*([^,\n]+))?[^\n]*/g; let m;
  while ((m = re.exec(text)) !== null) ups.push({ label: clean(m[1], 80), title: clean(m[2], 80), version: clean(m[3] || '', 20), restart: /Action:\s*restart/i.test(m[0]), recommended: /Recommended:\s*YES/i.test(m[0]) });
  if (!ups.length && !/Software Update found/i.test(text)) return { checked: false, reason: clean(text, 160) || 'no answer' };
  return { checked: true, updates: ups };
}

async function collect(onProgress, onChild) {
  const step = (s) => { if (onProgress) { try { onProgress(s); } catch { /* ignore */ } } };
  const data = { generatedAt: new Date().toISOString(), platform: 'macOS' };

  step('System information');
  const info = await inform.runInform();
  data.inform = info;
  data.system = {
    manufacturer: 'Apple', model: (info.computer && info.computer.model) || '', modelId: (info.computer && info.computer.systemType) || '',
    caption: (info.os && info.os.name) || 'macOS', displayVersion: (info.os && info.os.displayVersion) || '', version: (info.os && info.os.version) || '',
    buildNumber: (info.os && info.os.build) || '', serial: (info.computer && info.computer.serial) || '', cpu: (info.cpu && info.cpu.name) || '',
    ramGB: info.memory ? Math.round(info.memory.totalGB) : null, uptimeHours: info.os ? info.os.uptimeHours : null,
    appleSilicon: os.arch() === 'arm64', isAdmin: true,
  };

  step('Drive health');
  data.drives = await drives.runDrives().catch(() => ({ drives: [] }));
  step('Battery');
  data.battery = await battery.runBattery().catch(() => ({ hasBattery: false, batteries: [] }));
  step('Startup items');
  data.startup = await startup.runList().catch(() => ({ items: [] }));
  step('Crashes and panics');
  data.crash = await crash.runCrash().catch(() => ({ dumps: [], appCrashes: [], events: [] }));
  step('Extensions and devices');
  data.devices = await devices.runDevices().catch(() => ({ kexts: [], sysexts: [], problems: [] }));

  step('Memory and performance');
  const [swap, pressure, therm, mdm, load] = await Promise.all([
    run('/usr/sbin/sysctl', ['-n', 'vm.swapusage'], { timeoutMs: 5000 }),
    run('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeoutMs: 5000 }),
    run('/usr/bin/pmset', ['-g', 'therm'], { timeoutMs: 8000 }),
    run('/usr/bin/profiles', ['status', '-type', 'enrollment'], { timeoutMs: 10000 }),
    run('/usr/sbin/sysctl', ['-n', 'vm.loadavg'], { timeoutMs: 5000 }),
  ]);
  const toMB = (s) => { const m = /([\d.]+)([MGK])/.exec(s || ''); if (!m) return null; const v = parseFloat(m[1]); return m[2] === 'G' ? v * 1024 : m[2] === 'K' ? v / 1024 : v; };
  data.memory = {
    swapUsedMB: toMB(line(swap.out, /used\s*=\s*(\S+)/)), swapTotalMB: toMB(line(swap.out, /total\s*=\s*(\S+)/)),
    pressureLevel: num(pressure.out), usedPct: info.memory ? info.memory.usedPct : null, totalGB: info.memory ? info.memory.totalGB : null,
  };
  const limit = num(line(therm.out, /CPU_Speed_Limit\s*=\s*(\d+)/));
  data.thermal = { cpuSpeedLimit: limit, schedulerLimit: num(line(therm.out, /CPU_Scheduler_Limit\s*=\s*(\d+)/)) };
  data.loadAvg = num(line(load.out, /\{\s*([\d.]+)/));
  data.cpuCount = os.cpus().length;
  const mtext = mdm.out + mdm.err;
  data.mdm = { enrolled: /MDM enrollment:\s*Yes/i.test(mtext), dep: /Enrolled via DEP:\s*Yes/i.test(mtext), userApproved: /User Approved/i.test(mtext) };

  step('Checking for macOS updates');
  data.updates = await pendingUpdates().catch(() => ({ checked: false, reason: 'failed' }));
  const su = await readPlistFile('/Library/Preferences/com.apple.SoftwareUpdate.plist');
  data.lastUpdateCheck = su && su.LastSuccessfulDate ? String(su.LastSuccessfulDate) : null;
  void onChild;
  return data;
}

module.exports = { collect, pendingUpdates };
