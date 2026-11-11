'use strict';

// macOS devices: what is plugged in (USB, Thunderbolt), paired Bluetooth
// devices, and the third-party kernel/system extensions that stand in for
// "drivers" on a Mac. Read-only.

const { run, profiler, arr, clean } = require('./util');

function flatten(items, bus, out) {
  for (const it of arr(items)) {
    if (!it) continue;
    const isDevice = it.vendor_id || it.product_id || it.manufacturer || it.USBDeviceKeyVendorID || it.USBDeviceKeyProductID;
    const name = clean(it._name || '', 90);
    if (isDevice && name) {
      out.push({
        name, manufacturer: clean(it.manufacturer || it.USBDeviceKeyVendorName || '', 60), bus: bus || '',
        speed: clean(String(it.device_speed || it.USBDeviceKeyLinkSpeed || '').replace(/_/g, ' '), 30),
        serial: clean(it.serial_num || it.USBDeviceKeySerialNumber || '', 40),
        vendorId: clean(it.vendor_id || it.USBDeviceKeyVendorID || '', 40), productId: clean(it.product_id || it.USBDeviceKeyProductID || '', 20),
        builtIn: /^yes$/i.test(String(it['Built-in_Device'] || '')) || /apple inc|^apple$/i.test(String(it.manufacturer || '')) && /internal|keyboard \/ trackpad|T2|controller|FaceTime/i.test(name),
      });
    }
    if (it._items) flatten(it._items, bus || clean(it._name || '', 40), out);
  }
  return out;
}

function bluetooth(sp) {
  const out = [];
  for (const root of arr(sp)) {
    for (const key of ['device_connected', 'device_not_connected', 'device_title']) {
      for (const entry of arr(root && root[key])) {
        for (const name of Object.keys(entry || {})) {
          const d = entry[name] || {};
          const batt = d.device_batteryLevelMain || d.device_batteryLevel || d.device_batteryLevelCase || '';
          out.push({ name: clean(name, 60), connected: key === 'device_connected' || /yes/i.test(String(d.device_connected || '')), type: clean(d.device_minorType || d.device_majorType || '', 30), address: clean(d.device_address || d.device_addr || '', 20), battery: clean(String(batt), 10), firmware: clean(d.device_firmwareVersion || '', 20) });
        }
      }
    }
  }
  return out;
}

async function kexts() {
  // Loaded kernel extensions that are not Apple's. Legacy kexts are being phased out by macOS.
  let r = await run('/usr/bin/kmutil', ['showloaded', '--list-only'], { timeoutMs: 15000 });
  if (r.code !== 0 || !r.out.trim()) r = await run('/usr/sbin/kextstat', ['-l'], { timeoutMs: 15000 });
  const out = []; const seen = new Set();
  for (const ln of r.out.split('\n')) {
    const m = /\s([A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+){2,})\s+\(([^)]+)\)/.exec(ln);
    if (!m || /^com\.apple\./.test(m[1]) || seen.has(m[1])) continue;
    seen.add(m[1]); out.push({ id: m[1], version: clean(m[2], 30) });
  }
  return out;
}

async function sysexts() {
  const r = await run('/usr/bin/systemextensionsctl', ['list'], { timeoutMs: 15000 });
  const out = [];
  for (const ln of r.out.split('\n')) {
    // enabled active teamID bundleID (version) name [state]
    const m = /^\s*(\*?)\s*(\*?)\s*([A-Z0-9]{10})\s+(\S+)\s+\(([^)]*)\)\s+(.*?)\s+\[(.+)\]\s*$/.exec(ln);
    if (!m) continue;
    out.push({ id: m[4], teamId: m[3], version: clean(m[5], 30), name: clean(m[6], 60), state: clean(m[7], 40), enabled: m[1] === '*', active: m[2] === '*' });
  }
  return out;
}

async function runDevices() {
  const out = { generatedAt: new Date().toISOString() };
  const [u1, tb, bt, kx, sx] = await Promise.all([
    profiler(['SPUSBDataType'], 25000), profiler(['SPThunderboltDataType'], 25000), profiler(['SPBluetoothDataType'], 25000), kexts(), sysexts(),
  ]);
  let usb = flatten(u1.SPUSBDataType, '', []);
  if (!usb.length) { const u2 = await profiler(['SPUSBHostDataType'], 25000); usb = flatten(u2.SPUSBHostDataType, '', []); }
  out.usb = usb;
  const tbd = [];
  const walkTb = (items) => { for (const it of arr(items)) { if (!it) continue; if (it.vendor_name_key && it.device_name_key && !/^Mac/i.test(String(it.device_name_key))) tbd.push({ name: clean(it.device_name_key, 60), manufacturer: clean(it.vendor_name_key, 40), bus: clean(it._name || '', 40) }); if (it._items) walkTb(it._items); } };
  walkTb(tb.SPThunderboltDataType);
  out.thunderbolt = tbd;
  out.bluetooth = bluetooth(bt.SPBluetoothDataType);
  out.kexts = kx;
  out.sysexts = sx;
  // "Problems" on a Mac: legacy third-party kernel extensions, and system extensions waiting for approval.
  const problems = [];
  for (const k of kx) problems.push({ name: k.id, class: 'Kernel extension', manufacturer: '', errorCode: 'legacy-kext', status: 'Loaded', detail: 'A legacy third-party kernel extension (version ' + k.version + '). Apple is phasing these out; they are a common cause of kernel panics after a macOS update. Check the maker has a current version.' });
  for (const s of sx) if (/waiting|user/i.test(s.state)) problems.push({ name: s.name || s.id, class: 'System extension', manufacturer: s.teamId, errorCode: 'needs-approval', status: s.state, detail: 'This system extension is installed but waiting for approval in System Settings › Privacy & Security, so the app that needs it will not work fully.' });
  out.problems = problems;
  out.problemCount = problems.length;
  out.totalDevices = usb.length + tbd.length + out.bluetooth.length;
  return out;
}

module.exports = { runDevices };
