'use strict';

// macOS system information. Returns the same shape the Information tab was
// built around on Windows (os / computer / cpu / board / memory / graphics /
// disks / volumes / security / network / history / programs), filled from
// system_profiler and the built-in command-line tools. Read-only.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, profiler, readPlistFile, arr, gb, num, clean, home } = require('./util');

const BROWSERS = {
  'com.apple.safari': 'Safari', 'com.google.chrome': 'Google Chrome', 'org.mozilla.firefox': 'Mozilla Firefox',
  'com.microsoft.edgemac': 'Microsoft Edge', 'com.brave.browser': 'Brave', 'com.operasoftware.opera': 'Opera',
  'company.thebrowser.browser': 'Arc', 'com.vivaldi.vivaldi': 'Vivaldi', 'com.duckduckgo.macos.browser': 'DuckDuckGo',
};
// Third-party security products, detected by their app bundle.
const AV_APPS = [
  ['Malwarebytes', ['Malwarebytes.app', 'Malwarebytes Anti-Malware.app']], ['Sophos', ['Sophos/Sophos Endpoint.app', 'Sophos Home.app', 'Sophos Endpoint.app']],
  ['Bitdefender', ['Bitdefender/Antivirus for Mac.app', 'Bitdefender Virus Scanner.app', 'Bitdefender/Endpoint Security for Mac.app']],
  ['Avast', ['Avast.app', 'Avast Security.app']], ['AVG', ['AVG AntiVirus.app', 'AVGAntivirus.app']],
  ['Norton', ['Norton 360.app', 'Norton Security.app']], ['McAfee', ['McAfee Total Protection.app', 'McAfee Endpoint Security for Mac.app', 'McAfee LiveSafe - Internet Security.app']],
  ['ESET', ['ESET Cyber Security.app', 'ESET Endpoint Security.app', 'ESET Endpoint Antivirus.app', 'ESET Cyber Security Pro.app']],
  ['Intego', ['Intego/VirusBarrier.app']], ['Kaspersky', ['Kaspersky Anti-Virus For Mac.app', 'Kaspersky.app']],
  ['Trend Micro', ['Trend Micro Antivirus.app', 'TrendMicroSecurity.app']], ['Webroot', ['Webroot SecureAnywhere.app']],
  ['CrowdStrike Falcon', ['Falcon.app']], ['SentinelOne', ['SentinelOne/SentinelOne Extensions.app']],
  ['Microsoft Defender', ['Microsoft Defender.app', 'Microsoft Defender ATP.app']], ['Emsisoft', ['Emsisoft Anti-Malware.app']],
  ['Avira', ['Avira Security.app', 'Avira.app']], ['F-Secure', ['F-Secure/F-Secure.app', 'WithSecure/WithSecure Elements.app']],
];

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function ymdhm(d) { return ymd(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function line(text, re) { const m = re.exec(text || ''); return m ? m[1].trim() : ''; }

// Friendly "MacBook Pro (14-inch, 2021)" name, when macOS has cached it.
async function marketingName() {
  const p = await readPlistFile(path.join(home(), 'Library/Preferences/com.apple.SystemProfiler.plist'));
  const names = p && p['CPU Names'];
  if (names && typeof names === 'object') { const k = Object.keys(names)[0]; if (k && names[k]) return clean(names[k], 80); }
  return '';
}

async function defaultBrowser() {
  const p = await readPlistFile(path.join(home(), 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist'));
  for (const h of arr(p && p.LSHandlers)) {
    if (h && String(h.LSHandlerURLScheme || '').toLowerCase() === 'https' && h.LSHandlerRoleAll) {
      const id = String(h.LSHandlerRoleAll).toLowerCase();
      return BROWSERS[id] || h.LSHandlerRoleAll;
    }
  }
  return 'Safari';
}

function parseCores(v) {
  // Apple silicon: "proc 10:8:2" (total:performance:efficiency). Intel: a number.
  const m = /proc\s+(\d+):(\d+):(\d+)/.exec(String(v || ''));
  if (m) return { total: Number(m[1]), perf: Number(m[2]), eff: Number(m[3]) };
  const n = num(v); return n ? { total: n } : {};
}

async function memoryUsedPct() {
  const r = await run('/usr/bin/vm_stat', [], { timeoutMs: 5000 });
  const page = num(line(r.out, /page size of (\d+) bytes/)) || 16384;
  const g = (k) => num(line(r.out, new RegExp(k + ':\\s+(\\d+)'))) || 0;
  const used = (g('Pages active') + g('Pages wired down') + g('Pages occupied by compressor')) * page;
  const total = os.totalmem();
  return total ? Math.max(0, Math.min(100, Math.round((used / total) * 100))) : null;
}

function flattenUsb(items, out) {
  for (const it of arr(items)) {
    if (!it) continue;
    if (it._name && (it.vendor_id || it.manufacturer || it.product_id || it.USBDeviceKeyVendorID)) out.push(clean(it._name, 80));
    if (it._items) flattenUsb(it._items, out);
  }
  return out;
}

async function security() {
  const [fv, sip, gk, xp1, xp2, auto] = await Promise.all([
    run('/usr/bin/fdesetup', ['status'], { timeoutMs: 8000 }),
    run('/usr/bin/csrutil', ['status'], { timeoutMs: 8000 }),
    run('/usr/sbin/spctl', ['--status'], { timeoutMs: 8000 }),
    readPlistFile('/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist'),
    readPlistFile('/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist'),
    readPlistFile('/Library/Preferences/com.apple.SoftwareUpdate.plist'),
  ]);
  const fvText = fv.out + fv.err, gkText = gk.out + gk.err, sipText = sip.out + sip.err;
  const avProducts = [];
  for (const [name, bundles] of AV_APPS) {
    for (const b of bundles) { try { if (fs.existsSync(path.join('/Applications', b))) { avProducts.push({ name, active: true }); break; } } catch { /* ignore */ } }
  }
  const xp = xp1 || xp2 || {};
  const a = auto || {};
  const bool = (v) => (v === true || v === 1 ? true : v === false || v === 0 ? false : null);
  return {
    fileVault: /FileVault is On/i.test(fvText) ? 'On' : /FileVault is Off/i.test(fvText) ? 'Off' : (/Encryption in progress/i.test(fvText) ? 'Encrypting' : null),
    sip: /status:\s*enabled/i.test(sipText) ? true : /status:\s*disabled/i.test(sipText) ? false : null,
    gatekeeper: /assessments enabled/i.test(gkText) ? true : /assessments disabled/i.test(gkText) ? false : null,
    xprotectVersion: clean(xp.CFBundleShortVersionString || '', 20) || null,
    autoCheck: bool(a.AutomaticCheckEnabled),
    autoDownload: bool(a.AutomaticDownload),
    autoInstallMacOS: bool(a.AutomaticallyInstallMacOSUpdates),
    autoInstallSecurity: bool(a.CriticalUpdateInstall),
    avProducts,
  };
}

async function timeMachine() {
  const d = await run('/usr/bin/tmutil', ['destinationinfo'], { timeoutMs: 10000 });
  const text = d.out + d.err;
  const names = []; const re = /^Name\s*:\s*(.+)$/gm; let m;
  while ((m = re.exec(text)) !== null) names.push(clean(m[1], 60));
  const configured = names.length > 0;
  let last = null;
  if (configured) {
    // Needs Full Disk Access on recent macOS; silently absent without it.
    const l = await run('/usr/bin/tmutil', ['latestbackup'], { timeoutMs: 10000 });
    const mm = /(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(l.out);
    if (mm) last = `${mm[1]}-${mm[2]}-${mm[3]} ${mm[4]}:${mm[5]}`;
  }
  return { configured, destinations: names, lastBackup: last };
}

function countPanics(days) {
  const since = Date.now() - days * 86400000; let n = 0;
  for (const dir of ['/Library/Logs/DiagnosticReports', path.join(home(), 'Library/Logs/DiagnosticReports')]) {
    let files = []; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!/\.panic$/i.test(f) && !/^Kernel[-_].*\.(ips|panic)$/i.test(f)) continue;
      try { if (fs.statSync(path.join(dir, f)).mtimeMs >= since) n++; } catch { /* ignore */ }
    }
  }
  return n;
}

async function runInform(onProgress) {
  const step = (s) => { if (onProgress) { try { onProgress(s); } catch { /* ignore */ } } };
  const out = { generatedAt: new Date().toISOString(), platform: 'macOS' };

  step('Operating system');
  const [sw, sp, friendly, boot, usedPct] = await Promise.all([
    run('/usr/bin/sw_vers', [], { timeoutMs: 8000 }),
    profiler(['SPSoftwareDataType', 'SPHardwareDataType', 'SPMemoryDataType', 'SPDisplaysDataType', 'SPStorageDataType', 'SPNVMeDataType', 'SPSerialATADataType', 'SPNetworkDataType', 'SPFirewallDataType', 'SPiBridgeDataType'], 60000),
    marketingName(),
    run('/usr/sbin/sysctl', ['-n', 'kern.boottime'], { timeoutMs: 5000 }),
    memoryUsedPct(),
  ]);
  const soft = arr(sp.SPSoftwareDataType)[0] || {};
  const hard = arr(sp.SPHardwareDataType)[0] || {};
  const bootSec = num(line(boot.out, /sec\s*=\s*(\d+)/));
  const bootDate = bootSec ? new Date(bootSec * 1000) : new Date(Date.now() - os.uptime() * 1000);
  let installDate = null;
  try { installDate = ymd(fs.statSync('/var/db/.AppleSetupDone').birthtime); } catch { /* ignore */ }
  const version = line(sw.out, /ProductVersion:\s*(.+)/);
  const lock = String(hard.activation_lock_status || '');
  out.os = {
    name: line(sw.out, /ProductName:\s*(.+)/) || 'macOS',
    displayVersion: clean(String(soft.os_version || '').replace(/^macOS\s*/i, '').replace(/\s*\(.*\)$/, ''), 40) || version,
    version,
    build: line(sw.out, /BuildVersion:\s*(.+)/),
    arch: os.arch() === 'arm64' ? 'Apple silicon (arm64)' : 'Intel (x86_64)',
    installDate,
    lastBoot: ymdhm(bootDate),
    uptimeHours: Math.round(((Date.now() - bootDate.getTime()) / 3600000) * 10) / 10,
    bootMode: soft.boot_mode === 'normal_boot' ? 'Normal' : soft.boot_mode === 'safe_boot' ? 'Safe mode' : clean(soft.boot_mode || '', 30),
    registeredUser: null,
    loggedInUser: clean(soft.user_name || os.userInfo().username, 80),
    activation: /enabled/i.test(lock) ? 'On (Find My is protecting this Mac)' : /disabled/i.test(lock) ? 'Off' : null,
    bootVolume: clean(soft.boot_volume || '', 60),
    kernel: clean(soft.kernel_version || '', 60),
    computerName: clean(soft.local_host_name || os.hostname(), 80),
  };

  step('Hardware');
  const cores = parseCores(hard.number_processors);
  const intel = !hard.chip_type;
  const bridge = arr(sp.SPiBridgeDataType)[0] || {};
  out.computer = {
    manufacturer: 'Apple',
    model: friendly || clean(hard.machine_name || '', 60),
    systemType: clean(hard.machine_model || '', 40),
    modelNumber: clean(hard.model_number || '', 40) || null,
    serial: clean(hard.serial_number || '', 40),
    domain: null,
    partOfDomain: false,
  };
  out.cpu = {
    name: clean(hard.chip_type || [hard.cpu_type, hard.current_processor_speed].filter(Boolean).join(' '), 80) || (os.cpus()[0] || {}).model,
    cores: cores.total || os.cpus().length,
    logical: os.cpus().length,
    perfCores: cores.perf || null,
    effCores: cores.eff || null,
    maxClockMHz: null,
    socket: null,
  };
  out.board = {
    manufacturer: null,
    product: null,
    biosVendor: 'Apple',
    biosVersion: clean(hard.boot_rom_version || '', 60),
    biosDate: null,
    osLoader: clean(hard.os_loader_version || '', 40) || null,
    secureBoot: null,
    tpm: intel ? /T2/i.test(String(bridge.ibridge_model_name || '')) : true,
    securityChip: intel ? (clean(bridge.ibridge_model_name || '', 60) || 'None (no T2 chip)') : 'Secure Enclave (Apple silicon)',
  };
  const modules = [];
  for (const m of arr(sp.SPMemoryDataType)) {
    if (!m) continue;
    if (m._items) {
      for (const s of arr(m._items)) {
        if (!s || /empty/i.test(String(s.dimm_size || ''))) continue;
        modules.push({ slot: clean(s._name || '', 40), capacityGB: num(s.dimm_size), speedMHz: num(s.dimm_speed), manufacturer: clean(s.dimm_manufacturer || '', 40), partNumber: clean(s.dimm_part_number || s.dimm_type || '', 40) });
      }
    } else if (m.SPMemoryDataType || m.dimm_type) {
      modules.push({ slot: 'Built in (not upgradeable)', capacityGB: num(m.SPMemoryDataType), speedMHz: null, manufacturer: clean(m.dimm_manufacturer || '', 40), partNumber: clean(m.dimm_type || '', 40) });
    }
  }
  out.memory = { totalGB: Math.round((os.totalmem() / 1073741824) * 10) / 10, usedPct, modules };
  out.graphics = [];
  for (const g of arr(sp.SPDisplaysDataType)) {
    if (!g) continue;
    const displays = arr(g.spdisplays_ndrvs);
    const first = displays[0] || {};
    const res = String(first._spdisplays_resolution || first._spdisplays_pixels || '');
    out.graphics.push({
      name: clean(g.sppci_model || g._name || '', 80),
      driverVersion: clean(g.spdisplays_vram || g._spdisplays_vram || g.spdisplays_vram_shared || '', 30) || null,
      driverDate: clean(String(g.spdisplays_mtlgpufamilysupport || '').replace(/^spdisplays_/, '').replace(/metal/i, 'Metal '), 20) || null,
      resolution: clean(res.replace(/\s*@.*$/, ''), 30) || null,
      refreshHz: num(line(res, /@\s*([\d.]+)\s*Hz/)) || null,
      displays: displays.map((d) => clean(d._name || '', 60)).filter(Boolean),
    });
  }

  step('Disks and volumes');
  const drives = [];
  const addDrives = (list, bus) => {
    for (const c of arr(list)) for (const d of arr(c && c._items)) {
      if (!d) continue;
      drives.push({
        model: clean(d.device_model || d._name || '', 60), media: /rotational/i.test(String(d.spsata_medium_type || '')) ? 'HDD' : 'SSD', bus,
        sizeGB: gb(d.size_in_bytes, 0), health: d.smart_status === 'Verified' ? 'Healthy' : (d.smart_status ? clean(d.smart_status, 20) : 'Unknown'), wearPct: null, tempC: null,
      });
    }
  };
  addDrives(sp.SPNVMeDataType, 'NVMe');
  addDrives(sp.SPSerialATADataType, 'SATA');
  out.disks = drives;
  out.volumes = [];
  for (const v of arr(sp.SPStorageDataType)) {
    if (!v || !v.size_in_bytes) continue;
    const mp = String(v.mount_point || '');
    if (mp !== '/' && !/^\/Volumes\//.test(mp)) continue;
    // Skip macOS's own tiny system images (cryptexes, update assets).
    if (/cryptex/i.test(mp) || Number(v.size_in_bytes) < 1e9) continue;
    const size = Number(v.size_in_bytes), free = Number(v.free_space_in_bytes) || 0;
    out.volumes.push({ drive: mp, label: clean(v._name || '', 50), fs: clean(v.file_system || '', 20), sizeGB: gb(size), freeGB: gb(free), freePct: size ? Math.round((free / size) * 100) : 0 });
  }

  step('Security');
  out.defaultBrowser = await defaultBrowser();
  const sec = await security();
  const fw = arr(sp.SPFirewallDataType)[0] || {};
  const fwState = String(fw.spfirewall_globalstate || '');
  sec.firewall = fwState ? [{ profile: 'macOS firewall', enabled: !/allow_all/i.test(fwState) }] : [];
  sec.firewallStealth = /yes/i.test(String(fw.spfirewall_stealthenabled || '')) ? true : (fw.spfirewall_stealthenabled ? false : null);
  out.security = sec;

  step('Network');
  const adapters = [];
  let proxy = '';
  for (const n of arr(sp.SPNetworkDataType)) {
    if (!n) continue;
    const ip = arr(n.ip_address)[0] || arr(n.IPv4 && n.IPv4.Addresses)[0] || null;
    const px = n.Proxies || {};
    if (!proxy && ip && (px.HTTPEnable === 1 || px.HTTPSEnable === 1)) proxy = clean((px.HTTPSProxy || px.HTTPProxy || '') + (px.HTTPSPort || px.HTTPPort ? ':' + (px.HTTPSPort || px.HTTPPort) : ''), 80);
    if (!ip && !(n.Ethernet && n.Ethernet['MAC Address'])) continue;
    adapters.push({
      name: clean(n._name || '', 50), desc: clean(n.hardware || n.type || '', 40), status: ip ? 'Connected' : 'Not connected',
      mac: clean((n.Ethernet && n.Ethernet['MAC Address']) || '', 20), speed: clean((n.Ethernet && n.Ethernet.MediaSubType) || '', 30),
      ipv4: ip, dhcp: clean((n.IPv4 && n.IPv4.ConfigMethod) || '', 20), iface: clean(n.interface || '', 12),
    });
  }
  let hostsCount = null;
  try { hostsCount = fs.readFileSync('/etc/hosts', 'utf8').split('\n').filter((l) => /^\s*[^#\s]/.test(l)).length; } catch { /* ignore */ }
  out.network = { status: adapters.some((a) => a.ipv4) ? 'Connected' : 'Not connected', proxy, hostsCount, adapters };

  step('History');
  const tm = await timeMachine();
  let usb = [];
  try {
    const u = await profiler(['SPUSBDataType'], 20000);
    usb = flattenUsb(u.SPUSBDataType, []);
    if (!usb.length) { const u2 = await profiler(['SPUSBHostDataType'], 20000); usb = flattenUsb(u2.SPUSBHostDataType, []); }
  } catch { /* ignore */ }
  out.history = {
    timeMachine: tm.configured ? 'Set up (' + tm.destinations.join(', ') + ')' : 'Not set up',
    timeMachineConfigured: tm.configured,
    lastBackup: tm.lastBackup,
    panics30d: countPanics(30),
    usbDevices: Array.from(new Set(usb)),
  };

  step('Applications');
  out.programs = [];
  try {
    const a = await profiler(['SPApplicationsDataType'], 90000);
    const SRC = { apple: 'Apple', mac_app_store: 'App Store', identified_developer: 'Identified developer', unknown: 'Unknown (unsigned)' };
    for (const p of arr(a.SPApplicationsDataType)) {
      if (!p || !p._name) continue;
      const where = String(p.path || '');
      // Only apps a person would recognise: the Applications folders, not helper apps buried in Library.
      if (!/^\/Applications\/|^\/Users\/[^/]+\/Applications\//.test(where) || /\.app\/.*\.app$/.test(where)) continue;
      const signer = arr(p.signed_by)[0] || '';
      out.programs.push({
        name: clean(p._name, 80), version: clean(p.version || '', 30),
        publisher: clean(String(signer).replace(/^Developer ID Application:\s*/i, '').replace(/\s*\([A-Z0-9]{10}\)\s*$/, ''), 60) || SRC[p.obtained_from] || '',
        installed: p.lastModified ? String(p.lastModified).slice(0, 10) : null,
        source: SRC[p.obtained_from] || clean(p.obtained_from || '', 30),
        arch: /arm/i.test(String(p.arch_kind || '')) ? (/i64/i.test(String(p.arch_kind)) ? 'Universal' : 'Apple silicon') : (/i64|intel/i.test(String(p.arch_kind || '')) ? 'Intel' : clean(String(p.arch_kind || '').replace(/^arch_/, ''), 20)),
        path: clean(where, 200),
      });
    }
    out.programs.sort((x, y) => x.name.localeCompare(y.name));
  } catch { /* ignore */ }

  step('Finishing up');
  return out;
}

module.exports = { runInform };
