'use strict';

// macOS drive health (read-only). Lists physical disks with their SMART
// verdict from macOS itself, and - when smartmontools is installed - the full
// NVMe health log or ATA attribute table, in the shape the Drive Health tab
// already renders.

const fs = require('node:fs');
const path = require('node:path');
const { run, profiler, plistFrom, arr, gb, num, clean, firstExisting } = require('./util');

let extraBinDir = null;
function configure(o) { if (o && typeof o.binDir === 'string') extraBinDir = o.binDir; }
function smartctlPath() {
  const c = ['/opt/homebrew/bin/smartctl', '/opt/homebrew/sbin/smartctl', '/usr/local/bin/smartctl', '/usr/local/sbin/smartctl', '/opt/local/sbin/smartctl'];
  if (extraBinDir) c.unshift(path.join(extraBinDir, 'smartctl'));
  return firstExisting(c);
}

async function smart(exe, bsd) {
  if (!exe) return null;
  const r = await run(exe, ['-j', '-a', '/dev/' + bsd], { timeoutMs: 20000 });
  const s = r.out.indexOf('{'); if (s < 0) return null;
  try { return JSON.parse(r.out.slice(s)); } catch { return null; }
}

function fromSmart(j) {
  const o = { attrs: [], nvme: null, source: 'none' };
  if (!j) return o;
  const n = j.nvme_smart_health_information_log;
  if (n) {
    o.nvme = {
      criticalWarning: num(n.critical_warning) || 0, percentageUsed: num(n.percentage_used), availableSpare: num(n.available_spare),
      spareThreshold: num(n.available_spare_threshold), temperatureC: num(n.temperature),
      dataUnitsWritten: num(n.data_units_written), dataUnitsRead: num(n.data_units_read), powerCycles: num(n.power_cycles),
      powerOnHours: num(n.power_on_hours), unsafeShutdowns: num(n.unsafe_shutdowns), mediaErrors: num(n.media_errors),
    };
    o.source = 'nvme-log';
  }
  const t = j.ata_smart_attributes && j.ata_smart_attributes.table;
  if (Array.isArray(t) && t.length) {
    o.attrs = t.map((a) => ({ id: num(a.id), value: num(a.value), worst: num(a.worst), threshold: num(a.thresh), raw: a.raw ? num(a.raw.value) : null })).filter((a) => a.id);
    o.source = 'ata-passthrough';
  }
  o.passed = j.smart_status ? j.smart_status.passed : null;
  o.tempC = j.temperature ? num(j.temperature.current) : null;
  o.hours = j.power_on_time ? num(j.power_on_time.hours) : null;
  o.cycles = num(j.power_cycle_count);
  o.model = clean(j.model_name || '', 60); o.serial = clean(j.serial_number || '', 40); o.firmware = clean(j.firmware_version || '', 20);
  o.rpm = num(j.rotation_rate);
  return o;
}

async function runDrives() {
  const out = { generatedAt: new Date().toISOString() };
  const exe = smartctlPath();
  out.smartEngine = !!exe;
  out.smartctl = exe || null;
  const [list, apfs, sp] = await Promise.all([
    plistFrom('/usr/sbin/diskutil', ['list', '-plist', 'physical'], 20000),
    plistFrom('/usr/sbin/diskutil', ['apfs', 'list', '-plist'], 20000),
    profiler(['SPNVMeDataType', 'SPSerialATADataType', 'SPStorageDataType'], 45000),
  ]);
  // APFS containers are synthesized disks; map each back to its physical disk.
  const containerOf = {};
  for (const c of arr(apfs && apfs.Containers)) {
    const store = arr(c && c.PhysicalStores)[0];
    const phys = store && String(store.DeviceIdentifier || '').replace(/s\d+$/, '');
    if (c && c.ContainerReference && phys) containerOf[c.ContainerReference] = phys;
  }
  const hw = {};
  const index = (lst, bus) => { for (const c of arr(lst)) for (const d of arr(c && c._items)) if (d && d.bsd_name) hw[d.bsd_name] = Object.assign({ _bus: bus }, d); };
  index(sp.SPNVMeDataType, 'NVMe'); index(sp.SPSerialATADataType, 'SATA');
  const volsByDisk = {};
  for (const v of arr(sp.SPStorageDataType)) {
    if (!v || !v.bsd_name || !v.size_in_bytes) continue;
    const mp = String(v.mount_point || '');
    if (mp !== '/' && !/^\/Volumes\//.test(mp)) continue;
    const whole = String(v.bsd_name).replace(/s\d+$/, '');
    const phys = containerOf[whole] || whole;
    (volsByDisk[phys] = volsByDisk[phys] || []).push({ drive: mp, label: clean(v._name || '', 50), freeGB: gb(v.free_space_in_bytes), sizeGB: gb(v.size_in_bytes), fs: clean(v.file_system || '', 20) });
  }
  const whole = arr(list && list.WholeDisks);
  const drives = [];
  for (const bsd of whole) {
    const info = (await plistFrom('/usr/sbin/diskutil', ['info', '-plist', bsd], 15000)) || {};
    if (info.VirtualOrPhysical === 'Virtual') continue;
    const h = hw[bsd] || {};
    const s = fromSmart(await smart(exe, bsd));
    const status = String(info.SMARTStatus || h.smart_status || '');
    let health = 'Unknown';
    if (/verified/i.test(status) || s.passed === true) health = 'Healthy';
    if (/failing/i.test(status) || s.passed === false) health = 'Unhealthy';
    const solid = info.SolidState === true || /solid/i.test(String(h.spsata_medium_type || '')) || h._bus === 'NVMe';
    const bus = clean(info.BusProtocol || h._bus || '', 30);
    drives.push({
      number: parseInt(String(bsd).replace(/\D+/g, ''), 10) || 0,
      bsd,
      model: s.model || clean(h.device_model || info.MediaName || info.IORegistryEntryName || bsd, 60),
      serial: s.serial || clean(h.device_serial || '', 40) || null,
      firmware: s.firmware || clean(h.device_revision || '', 20) || null,
      interface: bus,
      mediaType: solid ? 'SSD' : (info.SolidState === false ? 'HDD' : 'Unspecified'),
      busType: /nvme|pci|fabric/i.test(bus) ? 'NVMe' : bus,
      internal: info.Internal === true,
      removable: info.RemovableMediaOrExternalDevice === true || info.Internal === false,
      sizeGB: gb(info.TotalSize || info.Size || h.size_in_bytes, 0),
      health,
      smartStatus: status || null,
      spindleSpeed: s.rpm || null,
      temperatureC: s.nvme && s.nvme.temperatureC != null ? s.nvme.temperatureC : s.tempC,
      powerOnHours: s.nvme && s.nvme.powerOnHours != null ? s.nvme.powerOnHours : s.hours,
      powerCycles: s.nvme && s.nvme.powerCycles != null ? s.nvme.powerCycles : s.cycles,
      wearPct: s.nvme ? s.nvme.percentageUsed : null,
      readErrors: null, writeErrors: null,
      smartSource: s.source !== 'none' ? s.source : (/verified|failing/i.test(status) ? 'macos-status' : 'none'),
      smartAttributes: s.attrs,
      nvme: s.nvme,
      trim: h.spnvme_trim_support || h.spsata_trim_support || null,
      volumes: volsByDisk[bsd] || [],
    });
  }
  out.drives = drives;
  return out;
}

// Quick sequential write/read test on the startup volume's temp folder (or a
// chosen mount point). Creates one temporary file and always removes it.
async function speedTest(mount, onProgress) {
  const os = require('node:os');
  const dir = mount && mount !== '/' ? mount : os.tmpdir();
  const file = path.join(dir, '.tm-speedtest-' + process.pid + '-' + Date.now() + '.bin');
  const chunk = Buffer.alloc(8 * 1024 * 1024, 0xA5);
  for (let i = 0; i < chunk.length; i += 4096) chunk.writeUInt32LE((Math.random() * 0xffffffff) >>> 0, i);
  const total = 64; // x 8 MB = 512 MB
  let fd = null;
  try {
    if (onProgress) onProgress('Writing 512 MB…');
    fd = fs.openSync(file, 'w');
    let t0 = process.hrtime.bigint();
    for (let i = 0; i < total; i++) fs.writeSync(fd, chunk);
    fs.fsyncSync(fd);
    const writeS = Number(process.hrtime.bigint() - t0) / 1e9;
    fs.closeSync(fd); fd = null;
    await run('/usr/sbin/purge', [], { timeoutMs: 15000 }); // drop the cache if permitted (no-op otherwise)
    if (onProgress) onProgress('Reading it back…');
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(chunk.length);
    t0 = process.hrtime.bigint();
    let read = 0;
    for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) break; read += n; }
    const readS = Number(process.hrtime.bigint() - t0) / 1e9;
    const mb = (total * chunk.length) / 1e6;
    return { ok: true, path: dir, sizeMB: Math.round(mb), writeMBps: Math.round(mb / writeS), readMBps: Math.round((read / 1e6) / readS), note: 'Read speed can be inflated by the file cache.' };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    try { if (fd != null) fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

module.exports = { runDrives, speedTest, configure, smartctlPath, fromSmart };
