'use strict';

// macOS battery health (read-only): cycle count, maximum capacity, Apple's own
// condition verdict, temperature and charger details. Capacities are in mAh.

const { run, profiler, arr, num, clean } = require('./util');

// `ioreg -rn AppleSmartBattery` prints `"Key" = value` lines.
function ioregMap(text) {
  const m = {}; const re = /^\s*"([^"]+)"\s*=\s*(.+)$/gm; let x;
  while ((x = re.exec(text || '')) !== null) { if (!(x[1] in m)) m[x[1]] = x[2].trim().replace(/^"|"$/g, ''); }
  return m;
}

async function runBattery() {
  const out = { generatedAt: new Date().toISOString(), unit: 'mAh' };
  const [sp, io] = await Promise.all([
    profiler(['SPPowerDataType'], 30000),
    run('/usr/sbin/ioreg', ['-rn', 'AppleSmartBattery'], { timeoutMs: 10000 }),
  ]);
  const reg = ioregMap(io.out);
  let info = null, charger = null;
  for (const s of arr(sp.SPPowerDataType)) {
    if (!s) continue;
    if (s.sppower_battery_health_info || s.sppower_battery_charge_info) info = s;
    if (s._name === 'sppower_ac_charger_information') charger = s;
  }
  const hasReg = reg.CycleCount != null || reg.DesignCapacity != null;
  out.hasBattery = !!(info || hasReg);
  out.batteries = [];
  if (out.hasBattery) {
    const health = (info && info.sppower_battery_health_info) || {};
    const charge = (info && info.sppower_battery_charge_info) || {};
    const model = (info && info.sppower_battery_model_info) || {};
    const design = num(reg.DesignCapacity);
    // Apple silicon reports MaxCapacity as a percentage; the real figure is AppleRawMaxCapacity.
    let full = num(reg.AppleRawMaxCapacity);
    if (full == null) { const mc = num(reg.MaxCapacity); if (mc != null && mc > 200) full = mc; }
    if (full == null) full = num(reg.NominalChargeCapacity);
    const maxPct = num(health.sppower_battery_health_maximum_capacity);
    let wear = null;
    if (maxPct != null) wear = Math.round((100 - maxPct) * 10) / 10;
    else if (design && full) wear = Math.round((1 - full / design) * 1000) / 10;
    if (wear != null && wear < 0) wear = 0;
    const tempRaw = num(reg.Temperature);
    const cond = clean(health.sppower_battery_health || '', 40);
    out.batteries.push({
      id: clean(model.sppower_battery_device_name || reg.DeviceName || '', 60),
      manufacturer: clean(model.sppower_battery_manufacturer || reg.Manufacturer || 'Apple', 40),
      serial: clean(model.sppower_battery_serial_number || reg.Serial || reg.BatterySerialNumber || '', 40),
      chemistry: 'Lithium-ion',
      designCapacity: design,
      fullChargeCapacity: full,
      cycleCount: num(health.sppower_battery_cycle_count) != null ? num(health.sppower_battery_cycle_count) : num(reg.CycleCount),
      maxCycles: num(reg.DesignCycleCount9C) || 1000,
      wearPct: wear,
      maximumCapacityPct: maxPct != null ? maxPct : (wear != null ? Math.round(100 - wear) : null),
      condition: cond === 'Good' ? 'Normal' : cond,
      temperatureC: tempRaw != null ? Math.round((tempRaw / 100) * 10) / 10 : null,
      voltage: num(reg.Voltage) != null ? Math.round(num(reg.Voltage) / 10) / 100 : null,
      firmware: clean(model.sppower_battery_firmware_version || '', 20) || null,
    });
    out.currentChargePct = num(charge.sppower_battery_state_of_charge) != null ? num(charge.sppower_battery_state_of_charge) : num(reg.CurrentCapacity);
    out.charging = /true|yes/i.test(String(charge.sppower_battery_is_charging || reg.IsCharging || ''));
  } else { out.currentChargePct = null; out.charging = false; }
  out.onACPower = charger ? /true|yes/i.test(String(charger.sppower_battery_charger_connected || '')) : /yes|true/i.test(String(reg.ExternalConnected || ''));
  out.charger = charger && out.onACPower ? {
    watts: num(charger.sppower_ac_charger_watts), name: clean(charger.sppower_ac_charger_name || '', 60) || null,
    manufacturer: clean(charger.sppower_ac_charger_manufacturer || '', 40) || null,
  } : null;
  return out;
}

module.exports = { runBattery, ioregMap };
