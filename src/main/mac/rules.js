'use strict';

// Pure evaluation layer for macOS: takes the data from scan-collect.js and
// returns scored, categorised findings in the same shape as the Windows rules.
// No I/O here, so it is easy to test.

const SEVERITY_WEIGHT = { critical: 22, warning: 9, info: 0, ok: 0 };

// macOS major versions in release order. Apple patches roughly the newest
// three; update this list when a new macOS ships.
const MACOS_ORDER = [10, 11, 12, 13, 14, 15, 26];
const MACOS_NAMES = { 11: 'Big Sur', 12: 'Monterey', 13: 'Ventura', 14: 'Sonoma', 15: 'Sequoia', 26: 'Tahoe' };
const SUPPORTED_COUNT = 3;

// Launch-item names that belong to well-known adware / "cleaner" scareware.
const PUP = /mackeeper|genieo|vsearch|conduit|spigot|advanced.?mac.?cleaner|mac.?auto.?fixer|pcvark|techyutils|installmac|mughthesec|shlayer|adload|pirrit|crossrider|bundlore|searchmine|smartmaccare|macsweeper|mac.?tonic|zipcloud|trovi|myshopcoupon|awesome.?screenshot.?helper|kuaizip|maccleanup.?pro|mac.?speedup/i;

function num(v, fallback = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }
function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

function evaluate(d) {
  d = d || {};
  const findings = [];
  const add = (severity, category, title, summary, opts = {}) =>
    findings.push({ severity, category, title, summary, detail: opts.detail || '', recommendation: opts.recommendation || '', explain: opts.explain || '', actions: Array.isArray(opts.actions) ? opts.actions : [], links: Array.isArray(opts.links) ? opts.links : [] });

  const sys = d.system || {};
  const info = d.inform || {};
  const sec = info.security || {};
  const isLaptop = !!(d.battery && d.battery.hasBattery);

  // ---------- macOS version ----------
  const major = parseInt(String(sys.version || '').split('.')[0], 10);
  const minor = parseInt(String(sys.version || '').split('.')[1], 10);
  const eff = major === 10 ? 10 : major;
  if (eff) {
    const pos = MACOS_ORDER.indexOf(eff);
    const newest = MACOS_ORDER.length - 1;
    const label = 'macOS ' + sys.version + (MACOS_NAMES[eff] ? ' ' + MACOS_NAMES[eff] : (major === 10 ? ' (10.' + minor + ')' : ''));
    if (pos >= 0 && newest - pos >= SUPPORTED_COUNT) {
      add('warning', 'System', 'This macOS version is no longer patched', `${label}. Apple normally provides security updates only for the three most recent macOS versions, so this one has stopped receiving them.`, {
        recommendation: 'Check whether this Mac can run a newer macOS (System Settings › General › Software Update). If it cannot, tell the customer it is past security support.',
        explain: 'Without security updates, newly found vulnerabilities stay open, and browsers and apps gradually stop supporting the system. The options are: upgrade macOS if the hardware allows, keep it offline or for low-risk use, or replace the machine. Apple does not publish formal end dates, so this is based on its consistent practice.',
        actions: [{ label: 'Software Update', token: 'software-update' }],
        links: [{ label: 'Apple security releases', url: 'https://support.apple.com/en-gb/100100' }],
      });
    } else {
      add('ok', 'System', label, 'A macOS version that still receives security updates.');
    }
  }

  // ---------- Pending updates ----------
  const up = d.updates || {};
  if (up.checked) {
    const ups = arr(up.updates);
    if (ups.length) {
      add('warning', 'Maintenance', plural(ups.length, 'software update') + ' waiting', ups.map((u) => u.title + (u.version ? ' ' + u.version : '')).join(', ') + '.', {
        detail: ups.map((u) => u.label + (u.restart ? '  (needs a restart)' : '')).join('\n'),
        recommendation: 'Install the updates, after a backup.',
        actions: [{ label: 'Software Update', token: 'software-update' }],
      });
    } else add('ok', 'Maintenance', 'macOS is up to date', 'Apple reports no updates waiting.');
  } else if (up.reason) {
    add('info', 'Maintenance', 'Could not check for updates', 'The update check did not complete (' + up.reason + '). It needs an internet connection.', { actions: [{ label: 'Software Update', token: 'software-update' }] });
  }
  if (sec.autoCheck === false) add('info', 'Maintenance', 'Automatic update checks are off', 'This Mac is not checking for updates on its own.', { recommendation: 'Turn on automatic updates in Software Update.', actions: [{ label: 'Software Update', token: 'software-update' }] });
  else if (sec.autoInstallSecurity === false) add('info', 'Maintenance', 'Security responses are not installed automatically', 'Background security updates (XProtect, Rapid Security Responses) are set not to install on their own.', { recommendation: 'Turn on "Install Security Responses and system files".', actions: [{ label: 'Software Update', token: 'software-update' }] });

  // ---------- Uptime ----------
  if (num(sys.uptimeHours) >= 24 * 21) add('info', 'Maintenance', 'Not restarted for ' + Math.round(sys.uptimeHours / 24) + ' days', 'A long uptime lets memory leaks and stuck processes build up, and pending updates wait for a restart.', { recommendation: 'Restart the Mac.' });

  // ---------- Security ----------
  if (sec.sip === false) add('critical', 'Security', 'System Integrity Protection is OFF', 'SIP stops software (including malware) from changing protected system files. It is only ever turned off deliberately, from Recovery.', { recommendation: 'Re-enable it from Recovery (csrutil enable) unless there is a known reason it is off.', explain: 'With SIP off, anything running as an administrator can modify the operating system itself. Legitimate reasons are rare (some development or legacy-hardware work).' });
  else if (sec.sip === true) add('ok', 'Security', 'System Integrity Protection is on', 'System files are protected.');
  if (sec.gatekeeper === false) add('warning', 'Security', 'Gatekeeper is disabled', 'macOS is not checking that downloaded apps are signed and notarised, so anything will run.', { recommendation: 'Turn it back on: System Settings › Privacy & Security › Allow applications from App Store & known developers.', actions: [{ label: 'Privacy & Security', token: 'privacy-security' }] });
  if (sec.fileVault === 'Off') {
    add(isLaptop ? 'warning' : 'info', 'Security', 'FileVault disk encryption is off', isLaptop ? 'If this laptop is lost or stolen, the files on it can be read by anyone.' : 'The disk is not encrypted. Less of a risk for a desktop that stays put.', {
      recommendation: 'Turn on FileVault and make sure the customer stores the recovery key.',
      explain: 'On Apple silicon and T2 Macs the storage is always hardware-encrypted, but without FileVault the key is released without the user\'s password. Turning FileVault on ties it to their login.',
      actions: [{ label: 'FileVault settings', token: 'filevault' }],
    });
  } else if (sec.fileVault === 'On') add('ok', 'Security', 'FileVault is on', 'The startup disk is encrypted.');
  const fw = arr(sec.firewall)[0];
  if (fw && fw.enabled === false) add('info', 'Security', 'macOS firewall is off', 'Fine behind a home or office router; worth enabling on a laptop used on public Wi-Fi.', { actions: [{ label: 'Firewall settings', token: 'firewall' }] });
  if (arr(sec.avProducts).length > 1) add('info', 'Security', 'More than one security product installed', arr(sec.avProducts).map((a) => a.name).join(', ') + '. Running several real-time scanners together slows a Mac badly.', { recommendation: 'Keep one and uninstall the rest with the maker\'s own uninstaller.' });

  // ---------- Ownership / management (matters before resale or repair) ----------
  const mdm = d.mdm || {};
  if (mdm.enrolled) add('info', 'System', 'This Mac is managed by an organisation (MDM)', 'It is enrolled in device management' + (mdm.dep ? ' through Apple Business/School Manager, so it re-enrols itself even after an erase' : '') + '.', { recommendation: 'Check with the owner before erasing or selling. A business-owned Mac must be released by that organisation.' });
  if (/^On/.test(String((info.os || {}).activation || ''))) add('info', 'System', 'Activation Lock is on', 'Find My is protecting this Mac. After an erase it will ask for the owner\'s Apple Account password.', { recommendation: 'Before a wipe or resale, have the owner sign out of iCloud or turn off Find My.' });

  // ---------- Storage ----------
  for (const v of arr(info.volumes)) {
    if (v.drive !== '/') continue;
    const free = num(v.freePct, 100), freeGB = num(v.freeGB);
    if (free < 5 || freeGB < 5) add('critical', 'Storage', 'Startup disk almost full', `${v.freeGB} GB free of ${v.sizeGB} GB (${free}%). macOS needs working space; this causes slowness, failed updates and can stop the Mac starting.`, { recommendation: 'Free space now: large files, old iOS backups, Downloads, then empty the Bin.', actions: [{ label: 'Storage settings', token: 'storage-settings' }] });
    else if (free < 12 || freeGB < 15) add('warning', 'Storage', 'Startup disk is getting full', `${v.freeGB} GB free of ${v.sizeGB} GB (${free}%).`, { recommendation: 'Clear space before it becomes a problem. macOS updates alone need 15-25 GB free.', actions: [{ label: 'Storage settings', token: 'storage-settings' }] });
    else add('ok', 'Storage', 'Startup disk has room', `${v.freeGB} GB free of ${v.sizeGB} GB.`);
  }
  for (const dr of arr((d.drives || {}).drives)) {
    const name = (dr.model || 'Drive') + (dr.sizeGB ? ' (' + dr.sizeGB + ' GB)' : '');
    if (dr.health === 'Unhealthy') add('critical', 'Storage', 'Drive is failing: ' + name, 'macOS reports this drive\'s SMART status as failing.', { recommendation: 'Back up immediately and replace the drive. On Macs with soldered storage this means a logic-board repair.' });
    const n = dr.nvme;
    if (n) {
      if (num(n.criticalWarning) > 0) add('critical', 'Storage', 'SSD reports a critical warning: ' + name, 'The drive\'s own health log has a critical-warning flag set (value ' + n.criticalWarning + ').', { recommendation: 'Back up now and plan replacement.' });
      if (num(n.mediaErrors) > 0) add('warning', 'Storage', 'SSD has logged media errors: ' + name, plural(n.mediaErrors, 'unrecovered data error') + ' recorded by the drive.', { recommendation: 'Back up and monitor; rising numbers mean the drive is failing.' });
      if (num(n.percentageUsed) >= 90) add('warning', 'Storage', 'SSD is near the end of its rated life: ' + name, 'The drive reports ' + n.percentageUsed + '% of its rated write endurance used.', { recommendation: 'Plan replacement and keep backups current.' });
      else if (num(n.percentageUsed) >= 70) add('info', 'Storage', 'SSD wear is high: ' + name, n.percentageUsed + '% of rated write endurance used.');
      if (n.availableSpare != null && n.spareThreshold != null && n.availableSpare <= n.spareThreshold) add('critical', 'Storage', 'SSD spare capacity exhausted: ' + name, 'Available spare (' + n.availableSpare + '%) is at or below the drive\'s own threshold (' + n.spareThreshold + '%).', { recommendation: 'Replace the drive.' });
    }
    if (dr.health === 'Healthy' && !(n && (num(n.criticalWarning) > 0 || num(n.mediaErrors) > 0))) add('ok', 'Storage', 'Drive reports healthy: ' + name, 'SMART status verified' + (dr.wearPct != null ? ', ' + dr.wearPct + '% wear' : '') + '.');
  }
  if ((d.drives || {}).smartEngine === false) add('info', 'Storage', 'Detailed SSD wear data not available', 'macOS only gives a pass/fail SMART verdict. Wear percentage, power-on hours and error counts need smartmontools.', { recommendation: 'Install smartmontools (brew install smartmontools) to unlock the full drive health readout.', links: [{ label: 'smartmontools', url: 'https://www.smartmontools.org/' }] });

  // ---------- Backup ----------
  const hist = info.history || {};
  if (hist.timeMachineConfigured === false) add('warning', 'Backup', 'No Time Machine backup set up', 'This Mac has no Time Machine destination. Unless another backup is in use, a drive failure would lose everything.', { recommendation: 'Ask the customer how they back up. If they do not, set up Time Machine to an external drive.', actions: [{ label: 'Time Machine settings', token: 'time-machine' }] });
  else if (hist.timeMachineConfigured && hist.lastBackup) {
    const age = Math.floor((Date.now() - Date.parse(hist.lastBackup.replace(' ', 'T'))) / 86400000);
    if (age >= 14) add('warning', 'Backup', 'Last Time Machine backup was ' + age + ' days ago', 'Last completed: ' + hist.lastBackup + '.', { recommendation: 'Connect the backup drive and let a backup finish.', actions: [{ label: 'Time Machine settings', token: 'time-machine' }] });
    else add('ok', 'Backup', 'Time Machine is backing up', 'Last completed: ' + hist.lastBackup + '.');
  } else if (hist.timeMachineConfigured) add('info', 'Backup', 'Time Machine is set up', 'Could not read when it last completed (macOS needs Full Disk Access granted to read that).', { actions: [{ label: 'Time Machine settings', token: 'time-machine' }] });

  // ---------- Battery ----------
  const b = arr((d.battery || {}).batteries)[0];
  if (b) {
    const wear = num(b.wearPct, -1), cyc = num(b.cycleCount, -1), max = num(b.maxCycles, 1000);
    const cap = b.maximumCapacityPct != null ? b.maximumCapacityPct + '% of original capacity' : '';
    if (/service|replace|poor/i.test(String(b.condition || ''))) add('critical', 'Battery', 'macOS says the battery needs service', 'Condition: ' + b.condition + '. ' + cap + (cyc >= 0 ? ', ' + cyc + ' cycles' : '') + '.', { recommendation: 'Quote for a battery replacement.', actions: [{ label: 'Battery settings', token: 'battery-settings' }] });
    else if (wear >= 20) add('warning', 'Battery', 'Battery is worn', cap + (cyc >= 0 ? ', ' + cyc + ' of ' + max + ' rated cycles' : '') + '. Apple considers a battery consumed below 80%.', { recommendation: 'Flag to the customer; quote a replacement if runtime is a complaint.', actions: [{ label: 'Battery settings', token: 'battery-settings' }] });
    else if (cyc >= 0 && cyc >= max) add('warning', 'Battery', 'Battery has passed its rated cycle count', cyc + ' cycles against a rated ' + max + '.', { recommendation: 'Expect capacity to fall off; plan a replacement.' });
    else if (wear >= 0) add('ok', 'Battery', 'Battery is in good health', cap + (cyc >= 0 ? ', ' + cyc + ' cycles' : '') + '.');
    if (num(b.temperatureC) >= 45) add('warning', 'Battery', 'Battery is running hot', b.temperatureC + ' °C. Heat ages a lithium battery quickly.', { recommendation: 'Check ventilation and for a runaway process; a swollen pack also runs hot.' });
  }

  // ---------- Memory & performance ----------
  const mem = d.memory || {};
  if (num(mem.pressureLevel) >= 4) add('critical', 'Performance', 'Memory pressure is critical', 'macOS has run out of usable memory and is struggling. The Mac will be very slow.', { recommendation: 'Close heavy apps; check Activity Monitor › Memory for what is using it.', actions: [{ label: 'Activity Monitor', token: 'activity-monitor' }] });
  else if (num(mem.pressureLevel) >= 2) add('warning', 'Performance', 'Memory pressure is high', 'The Mac is short of memory for what is open.', { recommendation: 'Check Activity Monitor › Memory. If this is normal use, the Mac has too little RAM for the job.', actions: [{ label: 'Activity Monitor', token: 'activity-monitor' }] });
  if (num(mem.swapUsedMB) >= 4096) add(num(mem.totalGB) <= 8 ? 'warning' : 'info', 'Performance', 'Heavy swap use (' + (mem.swapUsedMB / 1024).toFixed(1) + ' GB)', 'macOS is using the SSD as overflow memory. That slows everything and adds SSD wear.', { recommendation: 'Restart to clear it; if it returns quickly the Mac needs fewer things open or more RAM.', actions: [{ label: 'Activity Monitor', token: 'activity-monitor' }] });
  const th = d.thermal || {};
  if (th.cpuSpeedLimit != null && th.cpuSpeedLimit < 100) add('warning', 'Performance', 'CPU is being thermally throttled', 'macOS has limited the processor to ' + th.cpuSpeedLimit + '% speed to control heat.', { recommendation: 'Check for a runaway process, blocked vents, dust, or failed fan. Clean and re-paste if it is an older Intel Mac.', actions: [{ label: 'Activity Monitor', token: 'activity-monitor' }] });
  if (num(d.loadAvg) > 0 && num(d.cpuCount) > 0 && d.loadAvg > d.cpuCount * 1.5) add('info', 'Performance', 'The Mac is under heavy load right now', 'Load average ' + d.loadAvg + ' on ' + d.cpuCount + ' cores.', { actions: [{ label: 'Activity Monitor', token: 'activity-monitor' }] });

  // ---------- Stability ----------
  const cr = d.crash || {};
  const panics = arr(cr.dumps);
  const recent = panics.filter((p) => Date.now() - Date.parse(p.time) < 30 * 86400000);
  if (recent.length) {
    add(recent.length >= 3 ? 'critical' : 'warning', 'Stability', plural(recent.length, 'kernel panic') + ' in the last 30 days', 'Most recent: ' + recent[0].title + '.', {
      detail: recent.slice(0, 5).map((p) => new Date(p.time).toLocaleString() + '  -  ' + p.title + (arr(p.thirdPartyKexts).length ? '  [' + p.thirdPartyKexts.join(', ') + ']' : '')).join('\n'),
      recommendation: recent[0].fix,
      explain: recent[0].why + ' See the Crash Analysis tab for each panic.',
    });
  } else if (d.crash) add('ok', 'Stability', 'No recent kernel panics', 'No panic reports in the last 30 days.');
  const bad = arr(cr.events).filter((e) => e.kind === 'power');
  if (bad.length >= 2) add('warning', 'Stability', plural(bad.length, 'abnormal shutdown') + ' in the last week', 'Most recent: ' + bad[0].message + '.', { detail: bad.slice(0, 6).map((e) => new Date(e.time).toLocaleString() + '  -  ' + e.message).join('\n'), recommendation: 'Repeated unexpected shutdowns point at power, battery, heat or a hardware fault. Run Apple Diagnostics.' });
  for (const a of arr(cr.appCrashes)) {
    if (a.crashes + a.hangs >= 5) add('info', 'Stability', a.app + ' keeps crashing', plural(a.crashes, 'crash') + (a.hangs ? ' and ' + plural(a.hangs, 'hang') : '') + ' in the last 30 days.', { recommendation: 'Update or reinstall ' + a.app + '.' });
  }

  // ---------- Startup items & extensions ----------
  const items = arr((d.startup || {}).items);
  const third = items.filter((i) => !i.apple && i.enabled);
  const pups = items.filter((i) => PUP.test(i.name || '') || PUP.test(i.command || ''));
  for (const p of pups) add('critical', 'Security', 'Possible adware or scareware: ' + p.name, 'A startup item matches the name of known unwanted software.', { detail: (p.plistPath || '') + '\n' + (p.command || ''), recommendation: 'Remove it and the app it belongs to, then scan with Malwarebytes.', links: [{ label: 'Malwarebytes for Mac', url: 'https://www.malwarebytes.com/mac' }] });
  const unsigned = third.filter((i) => (i.signed === 'unsigned' || i.signed === 'invalid') && !pups.includes(i) && !i.missing && i.type !== 'Login item');
  if (unsigned.length) add('warning', 'Startup', plural(unsigned.length, 'unsigned startup item'), 'These run automatically but are not signed by an identified developer, so their origin cannot be verified.', { detail: unsigned.slice(0, 12).map((i) => i.name + '  ->  ' + (i.exePath || i.command || '')).join('\n'), recommendation: 'Check each one is something the customer installed on purpose (scripts and open-source tools are often unsigned). Disable anything unexplained in Startup Items.' });
  const orphans = third.filter((i) => i.missing && i.type !== 'Login item');
  if (orphans.length) add('info', 'Startup', plural(orphans.length, 'leftover startup item'), 'These point at programs that are no longer installed. Harmless, but macOS keeps trying to launch them.', { detail: orphans.slice(0, 12).map((i) => i.plistPath || i.name).join('\n'), recommendation: 'Safe to remove the leftover .plist files.' });
  if (third.length >= 20) add('info', 'Startup', third.length + ' third-party startup items', 'A lot of software launches itself in the background on this Mac, which slows start-up and uses memory.', { recommendation: 'Review the Startup Items tab and switch off what is not needed.', actions: [{ label: 'Login Items settings', token: 'login-items' }] });
  const kx = arr((d.devices || {}).kexts);
  if (kx.length) add('info', 'Stability', plural(kx.length, 'legacy kernel extension') + ' loaded', 'Third-party kernel extensions: ' + kx.map((k) => k.id).join(', ') + '.', { recommendation: 'Apple is retiring kernel extensions. Check each maker offers a current version, especially before a macOS upgrade.', explain: 'Legacy kernel extensions run inside the kernel, so a bug in one panics the whole Mac. They are the first suspects for panics after a macOS update.' });

  // ---------- Network / misc ----------
  if (num((info.network || {}).hostsCount) > 4) add('info', 'Network', 'Hosts file has extra entries', (info.network.hostsCount) + ' active lines in /etc/hosts (a clean Mac has 3). Extra entries can block or redirect sites.', { recommendation: 'Review /etc/hosts; ad-blockers and some licence cracks add lines here.', actions: [{ label: 'Open hosts file', token: 'hosts-file' }] });
  if ((info.network || {}).proxy) add('info', 'Network', 'A web proxy is configured', 'Traffic is going through ' + info.network.proxy + '.', { recommendation: 'Expected on some business networks; on a home Mac, check why.' });

  // ---------- Score & counts ----------
  const counts = { critical: 0, warning: 0, info: 0, ok: 0 };
  let penalty = 0;
  for (const f of findings) { counts[f.severity] = (counts[f.severity] || 0) + 1; penalty += SEVERITY_WEIGHT[f.severity] || 0; }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings, counts, score, summary: buildSummary(sys, counts) };
}

function buildSummary(sys, counts) {
  const parts = [];
  if (sys.model) parts.push(String(sys.model).trim());
  if (sys.caption) parts.push(String(sys.caption).trim() + (sys.version ? ' ' + sys.version : ''));
  if (sys.cpu) parts.push(String(sys.cpu).trim());
  if (sys.ramGB) parts.push(`${sys.ramGB} GB RAM`);
  if (sys.uptimeHours != null) parts.push(`up ${sys.uptimeHours}h`);
  let line = parts.join('  ·  ');
  if (counts.critical) line += `  —  ${counts.critical} critical issue${counts.critical === 1 ? '' : 's'} need attention`;
  else if (counts.warning) line += `  —  ${counts.warning} thing${counts.warning === 1 ? '' : 's'} to look at`;
  else line += '  —  no major issues found';
  return line;
}

module.exports = { evaluate, MACOS_ORDER };
