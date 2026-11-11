'use strict';

// macOS crash analysis (read-only): kernel panics with the panic reason pulled
// out and explained, apps that keep crashing, and why the Mac last shut down.

const fs = require('node:fs');
const path = require('node:path');
const { run, clean, home } = require('./util');

const DIRS = () => ['/Library/Logs/DiagnosticReports', path.join(home(), 'Library/Logs/DiagnosticReports')];

// Plain-English reading of a panic string. First match wins.
const PANIC_HINTS = [
  [/userspace watchdog timeout|watchdog timeout: no checkins from watchdogd|no successful checkins/i, 'System stopped responding (watchdog)', 'A core macOS service froze for so long the watchdog restarted the Mac. Often a failing or very full SSD, a hung third-party background tool, or a peripheral.', 'Check free space and drive health, disconnect peripherals, remove recently added background/security software, then update macOS.'],
  [/Sleep transition timed out|Wake transition timed out|sleep\/wake|PowerOff|AppleARMPMU|power state/i, 'Failed going to sleep or waking', 'The Mac could not finish sleeping or waking. Usually a peripheral, hub, dock or external display, or a driver that will not sleep.', 'Test with everything unplugged. Update macOS. Reset power settings (and SMC on Intel Macs).'],
  [/AppleNVMe|nvme|IONVMe|APFS|apfs_|disk\d+s\d+|I\/O error|spaceman/i, 'Storage or file-system fault', 'The panic came from the SSD driver or the APFS file system. This can mean a failing drive or file-system damage.', 'Back up immediately. Run Disk Utility First Aid from Recovery. Check Drive Health. If it recurs, the storage (or logic board on soldered SSDs) is suspect.'],
  [/AGX|AppleM\dGPU|GPU|AMDRadeon|NVDA|IntelAccelerator|IOGraphics|DCP|DisplayPort|IOMFB/i, 'Graphics or display fault', 'The panic came from the graphics or display driver. Common with external displays, adapters and docks; on older Intel Macs it can be a failing GPU.', 'Test without external displays/adapters. Update macOS. On Intel Macs with a discrete GPU, recurring GPU panics often mean a board-level fault.'],
  [/CATERR|Machine[- ]check|MCA|x86 CPU|Unresponsive processor|processor.*NMI/i, 'Processor / hardware fault', 'The CPU reported a hardware error. This is a hardware-level fault, not software.', 'Run Apple Diagnostics (hold D at startup, or power button on Apple silicon). Check for overheating and liquid damage. Likely logic-board repair.'],
  [/SMC|thermal|temperature|fan/i, 'Thermal or power-management fault', 'The power/thermal controller reported a problem: overheating, a failed fan or sensor, or a power fault.', 'Check the fans spin and vents are clear. Run Apple Diagnostics. Reset the SMC on Intel Macs.'],
  [/BridgeOS|T2|macOS watchdog|x86 global reset|bridgeOS/i, 'T2 security chip fault (BridgeOS)', 'The T2 chip crashed or restarted the Mac. Seen with some USB-C hubs and audio devices, and with T2 firmware problems.', 'Update macOS (it updates T2 firmware). Test without USB-C hubs/docks. Recurring BridgeOS panics may need a firmware restore with Apple Configurator.'],
  [/zalloc|zone .* exhausted|kernel memory|out of memory|kalloc|Compressor|memorystatus|jetsam/i, 'Kernel ran out of memory', 'The kernel exhausted its memory, usually a leak in a kernel extension or a runaway process.', 'Update macOS and any software with system/kernel extensions. Check Activity Monitor for runaway memory use.'],
  [/Kernel data abort|data abort|page fault|invalid kernel|Kernel trap|type 14=page fault|NULL pointer|sanitizer/i, 'Kernel fault (bad memory access)', 'The kernel or a kernel extension touched memory it should not have. Caused by a buggy driver/extension or, less often, faulty RAM or logic board.', 'Check the listed kernel extensions for third-party ones and update or remove them. If panics are random and varied, suspect hardware.'],
  [/AppleUSB|IOUSB|usb|Thunderbolt|IOThunderbolt|xhci/i, 'USB / Thunderbolt fault', 'The panic came from the USB or Thunderbolt stack, usually triggered by a hub, dock or accessory.', 'Test with accessories unplugged and add them back one at a time.'],
  [/wifi|wlan|AirPort|IO80211|bluetooth|IOBluetooth/i, 'Wi-Fi or Bluetooth driver fault', 'The panic came from the wireless driver.', 'Update macOS. Remove VPN/network-filter software as a test.'],
];
// "Previous shutdown cause" codes logged by macOS at boot.
const SHUTDOWN = {
  5: ['Normal shutdown', false], 7: ['Normal restart (CPU thread error on some models)', false], 3: ['Hard shutdown - power button held', true], 0: ['Power lost - battery ran flat or power was cut', true],
  2: ['Low battery / power lost', true], 1: ['Forced restart', true], '-3': ['Overheating - several temperature sensors too high', true], '-11': ['Battery reported an unrecoverable fault', true],
  '-14': ['Electricity supply fault', true], '-20': ['T2 / BridgeOS initiated shutdown', true], '-27': ['Thermal shutdown', true], '-30': ['Sleep/wake failure', true],
  '-40': ['Power-supply fault', true], '-60': ['Corrupt startup disk directory', true], '-61': ['Unresponsive app forced a shutdown (watchdog)', true], '-62': ['Unresponsive app forced a restart (watchdog)', true],
  '-63': ['Sleep/wake failure', true], '-64': ['Sleep/wake failure', true], '-65': ['Operating-system fault', true], '-71': ['Memory module overheating', true], '-74': ['Battery overheating', true],
  '-75': ['Communication fault with the power adapter', true], '-78': ['Wrong current from the power adapter', true], '-79': ['Wrong current from the battery', true], '-81': ['Power-controller fault', true],
  '-82': ['Temperature sensor fault', true], '-83': ['Thermal shutdown', true], '-84': ['Thermal shutdown', true], '-86': ['Overheating near the processor', true], '-95': ['CPU overheating', true],
  '-100': ['Power-supply overheating', true], '-101': ['Display overheating', true], '-102': ['Battery cell under-voltage', true], '-103': ['Battery cell under-voltage', true],
  '-104': ['Battery fault', true], '-108': ['Likely memory fault', true], '-112': ['Memory fault', true], '-127': ['Power button held', true], '-128': ['Unknown cause (often memory)', true],
};

function readHead(file, bytes) {
  let fd = null;
  try { fd = fs.openSync(file, 'r'); const b = Buffer.alloc(bytes); const n = fs.readSync(fd, b, 0, bytes, 0); return b.slice(0, n).toString('utf8'); }
  catch { return ''; } finally { try { if (fd != null) fs.closeSync(fd); } catch { /* ignore */ } }
}

function panicString(text) {
  const m = /"panicString"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (m) { try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1].replace(/\\n/g, '\n').replace(/\\t/g, ' '); } }
  const i = text.indexOf('panic(');
  return i >= 0 ? text.slice(i, i + 6000) : text.slice(0, 3000);
}

function analysePanic(ps) {
  const first = clean((ps.split('\n').find((l) => /panic\(|watchdog|abort|fault|timeout|error/i.test(l)) || ps.split('\n')[0] || ''), 300);
  let hint = null;
  for (const [re, title, why, fix] of PANIC_HINTS) { if (re.test(first)) { hint = { title, why, fix }; break; } }
  if (!hint) for (const [re, title, why, fix] of PANIC_HINTS) { if (re.test(ps.slice(0, 2500))) { hint = { title, why, fix }; break; } }
  if (!hint) hint = { title: 'Kernel panic', why: 'macOS hit an error it could not recover from and restarted.', fix: 'Note what was in use at the time. Update macOS, test with accessories unplugged, and check the kernel extensions listed for third-party software.' };
  // Third-party kernel extensions named in the backtrace are the usual suspects.
  const kexts = [];
  const re = /^\s*([A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+){2,})\(([^)]+)\)/gm; let m;
  while ((m = re.exec(ps)) !== null) { if (!/^com\.apple\./.test(m[1]) && kexts.indexOf(m[1]) < 0) kexts.push(m[1]); }
  return { reason: first, hint, thirdPartyKexts: kexts.slice(0, 8) };
}

function scanReports(days) {
  const since = Date.now() - days * 86400000;
  const panics = [], apps = {};
  const seen = new Set();
  const visit = (dir) => {
    let files = []; try { files = fs.readdirSync(dir); } catch { return; }
    for (const f of files) {
      const full = path.join(dir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (f === 'Retired') visit(full); continue; }
      const isPanic = /\.panic$/i.test(f) || /^(Kernel|panic-full|panic-base)[-_].*\.(ips|panic)$/i.test(f);
      if (isPanic) {
        if (seen.has(f)) continue; seen.add(f);
        const text = readHead(full, 400000);
        const a = analysePanic(panicString(text));
        panics.push({ file: full, name: f, sizeKB: Math.round(st.size / 1024), time: st.mtime.toISOString(), reason: a.reason, title: a.hint.title, why: a.hint.why, fix: a.hint.fix, thirdPartyKexts: a.thirdPartyKexts });
        continue;
      }
      if (st.mtimeMs < since) continue;
      if (!/\.(ips|crash|hang|spin|diag)$/i.test(f)) continue;
      const head = readHead(full, 1200);
      let app = '', kind = /\.(hang|spin)$/i.test(f) ? 'hang' : /\.diag$/i.test(f) ? 'resource' : 'crash';
      const j = /^\s*(\{.*\})\s*$/m.exec(head.split('\n')[0] || '');
      if (j) { try { const o = JSON.parse(j[1]); app = o.app_name || o.name || ''; if (String(o.bug_type) === '210') continue; if (/hang|spin/i.test(String(o.bug_type_name || ''))) kind = 'hang'; } catch { /* ignore */ } }
      if (!app) app = (/^Process:\s+(.+?)\s+\[/m.exec(head) || [])[1] || f.replace(/[-_]\d{4}-\d{2}-\d{2}.*$/, '').replace(/\.(ips|crash|hang|spin|diag)$/i, '');
      app = clean(app, 60);
      // Memory-pressure and other system event logs are not app crashes.
      if (!app || /^(JetsamEvent|ExcUserFault|stacks|log-|Analytics|SiriSearchFeedback)/i.test(app)) continue;
      const rec = apps[app] || (apps[app] = { app, crashes: 0, hangs: 0, last: '' });
      if (kind === 'hang') rec.hangs++; else rec.crashes++;
      const t = st.mtime.toISOString(); if (t > rec.last) rec.last = t;
    }
  };
  for (const d of DIRS()) visit(d);
  panics.sort((a, b) => (a.time < b.time ? 1 : -1));
  const appList = Object.values(apps).sort((a, b) => (b.crashes + b.hangs) - (a.crashes + a.hangs)).slice(0, 25);
  return { panics, appList };
}

// The unified log query is slow, so it runs in the background and is cached.
let shutdownCache = null, shutdownRunning = null;
function queryShutdowns() {
  if (shutdownRunning) return shutdownRunning;
  shutdownRunning = run('/usr/bin/log', ['show', '--last', '7d', '--style', 'compact', '--predicate', 'eventMessage CONTAINS "Previous shutdown cause"'], { timeoutMs: 120000 }).then((r) => {
    const out = [];
    for (const ln of r.out.split('\n')) {
      const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\S*\s.*Previous shutdown cause:\s*(-?\d+)/.exec(ln);
      if (!m) continue;
      const known = SHUTDOWN[m[2]];
      out.push({ time: new Date(m[1].replace(' ', 'T')).toISOString(), kind: known && !known[1] ? 'normal' : 'power', code: Number(m[2]), message: (known ? known[0] : 'Unrecognised cause') + ' (code ' + m[2] + ')' });
    }
    out.sort((a, b) => (a.time < b.time ? 1 : -1));
    shutdownCache = { at: Date.now(), events: out, ok: r.code === 0 };
    shutdownRunning = null;
    return shutdownCache;
  });
  return shutdownRunning;
}

async function runCrash() {
  const out = { generatedAt: new Date().toISOString(), platform: 'macOS' };
  const { panics, appList } = scanReports(30);
  out.dumps = panics;            // kernel panics (the Overview tile counts these)
  out.appCrashes = appList;      // apps crashing or hanging in the last 30 days
  const fresh = shutdownCache && Date.now() - shutdownCache.at < 10 * 60000;
  let sd = fresh ? shutdownCache : null;
  if (!sd) sd = await Promise.race([queryShutdowns(), new Promise((r) => setTimeout(() => r(null), 7000))]);
  out.events = sd ? sd.events.slice(0, 40) : [];
  out.shutdownScanPending = !sd;
  out.abnormalShutdowns = out.events.filter((e) => e.kind === 'power').length;
  return out;
}

module.exports = { runCrash, analysePanic, panicString, SHUTDOWN };
