'use strict';

// macOS networking: connection summary with plain-English gotchas, a ping
// quality test and a local-network device sweep. Same result shapes as the
// Windows version so the Networking tab renders them unchanged.

const dns = require('node:dns').promises;
const { run, profiler, arr, num, clean, mapLimit } = require('./util');

function line(text, re) { const m = re.exec(text || ''); return m ? m[1].trim() : ''; }

async function hardwarePorts() {
  const r = await run('/usr/sbin/networksetup', ['-listallhardwareports'], { timeoutMs: 10000 });
  const out = [];
  for (const block of r.out.split(/\n\s*\n/)) {
    const name = line(block, /Hardware Port:\s*(.+)/), dev = line(block, /Device:\s*(.+)/);
    if (name && dev) out.push({ name, dev, mac: line(block, /Ethernet Address:\s*(.+)/) });
  }
  return out;
}

async function wifiInfo() {
  const sp = await profiler(['SPAirPortDataType'], 20000);
  for (const root of arr(sp.SPAirPortDataType)) for (const i of arr(root && root.spairport_airport_interfaces)) {
    const c = i && i.spairport_current_network_information;
    if (!c) continue;
    const sn = String(c.spairport_signal_noise || '');
    return {
      iface: clean(i._name || '', 12), ssid: clean(c._name || '', 60), mode: clean(c.spairport_network_phymode || '', 30),
      channel: clean(String(c.spairport_network_channel || ''), 40),
      security: clean(String(c.spairport_security_mode || '').replace(/^spairport_security_mode_/, '').replace(/_/g, ' '), 40),
      signal: num(line(sn, /(-?\d+)\s*dBm/)), noise: num(line(sn, /\/\s*(-?\d+)\s*dBm/)), rate: num(c.spairport_network_rate),
    };
  }
  return null;
}

async function info() {
  const [route, ports, dnsOut, wifi, fw] = await Promise.all([
    run('/sbin/route', ['-n', 'get', 'default'], { timeoutMs: 8000 }),
    hardwarePorts(),
    run('/usr/sbin/scutil', ['--dns'], { timeoutMs: 8000 }),
    wifiInfo(),
    profiler(['SPFirewallDataType'], 15000),
  ]);
  const gateway = line(route.out, /gateway:\s*(\S+)/);
  const primary = line(route.out, /interface:\s*(\S+)/);
  const servers = [];
  { const re = /nameserver\[\d+\]\s*:\s*(\S+)/g; let m; while ((m = re.exec(dnsOut.out)) !== null) { if (/\./.test(m[1]) && servers.indexOf(m[1]) < 0) servers.push(m[1]); } }
  const adapters = [];
  let ipv4 = '';
  for (const p of ports) {
    const ic = await run('/sbin/ifconfig', [p.dev], { timeoutMs: 5000 });
    if (!/status:\s*active/.test(ic.out)) continue;
    const ip = line(ic.out, /inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (p.dev === primary) ipv4 = ip;
    const media = line(ic.out, /media:\s*(.+)/);
    adapters.push({ name: p.name, desc: p.dev + (ip ? '  ·  ' + ip : ''), mac: p.mac, speed: clean(media.replace(/^autoselect\s*/i, '').replace(/[()<>]/g, ''), 40), ifIndex: 0, dev: p.dev });
  }
  if (!ipv4 && adapters.length) ipv4 = line((await run('/sbin/ifconfig', [adapters[0].dev], { timeoutMs: 5000 })).out, /inet\s+(\d+\.\d+\.\d+\.\d+)/);

  const warnings = [];
  let internet = null;
  if (ipv4 && !/^169\.254\./.test(ipv4)) {
    const p = await run('/sbin/ping', ['-c', '2', '-t', '3', '1.1.1.1'], { timeoutMs: 6000 });
    internet = / [12] packets received/.test(p.out);
  }
  const profiles = [];
  if (primary) {
    const port = ports.find((p) => p.dev === primary);
    const isWifi = wifi && wifi.iface === primary;
    profiles.push({ name: isWifi && wifi.ssid ? wifi.ssid : (port ? port.name : primary), category: isWifi ? 'Wi-Fi' : (port ? port.name : 'Wired'), ipv4: internet === true ? 'Internet' : internet === false ? 'No internet' : 'Unknown', ipv6: '', alias: primary, ifIndex: 0 });
  }
  if (!adapters.length) warnings.push({ id: 'offline', sev: 'bad', title: 'No active network connection', detail: 'Neither Wi-Fi nor Ethernet is connected. Check Wi-Fi is on and joined to a network, or the cable/adapter.', fix: '' });
  if (/^169\.254\./.test(ipv4)) warnings.push({ id: 'apipa', sev: 'bad', title: 'Self-assigned IP address (169.254.x.x)', detail: 'This Mac did not get an address from a router/DHCP server, so it is effectively off the network. Check the router, forget and rejoin the Wi-Fi network, or renew the DHCP lease in Network settings.', fix: '' });
  if (!gateway && ipv4 && !/^169\.254\./.test(ipv4)) warnings.push({ id: 'nogw', sev: 'warn', title: 'No router (default gateway)', detail: 'There is an IP address but no router set, so internet and other-subnet traffic cannot route.', fix: '' });
  if (!servers.length && ipv4) warnings.push({ id: 'nodns', sev: 'warn', title: 'No DNS server configured', detail: 'Without DNS, names will not resolve even if the connection otherwise works.', fix: '' });
  if (internet === false && gateway) warnings.push({ id: 'noint', sev: 'warn', title: 'No internet access', detail: 'This Mac is on the local network but could not reach the internet. Check the router and the line.', fix: '' });
  if (wifi && wifi.signal != null && wifi.signal <= -72) warnings.push({ id: 'weakwifi', sev: wifi.signal <= -80 ? 'bad' : 'warn', title: 'Weak Wi-Fi signal (' + wifi.signal + ' dBm)', detail: 'The signal from the router is weak here, which causes slow speeds and drop-outs. Move closer, remove obstructions, or add an access point.', fix: '' });
  if (wifi && wifi.security && /none|open|wep|^wpa personal$/i.test(wifi.security)) warnings.push({ id: 'wifisec', sev: 'warn', title: 'Wi-Fi security is weak (' + wifi.security + ')', detail: 'This network is open or uses outdated encryption, so traffic can be intercepted. Set the router to WPA2 or WPA3.', fix: '' });
  const fwState = String((arr(fw.SPFirewallDataType)[0] || {}).spfirewall_globalstate || '');
  if (/allow_all/i.test(fwState)) warnings.push({ id: 'fwoff', sev: 'warn', title: 'macOS firewall is turned off', detail: 'Fine behind a home router, but worth turning on for a laptop that joins public Wi-Fi. System Settings › Network › Firewall.', fix: '' });

  return { ok: true, isAdmin: true, adapters, profiles, ipv4, gateway, dns: servers, primaryIndex: 0, primary, wifi, warnings };
}

function validTarget(t) { return typeof t === 'string' && /^[A-Za-z0-9][A-Za-z0-9.\-:]{0,252}$/.test(t); }

async function ping(target) {
  const t = String(target || '').trim();
  if (!t) return { ok: false, error: 'no-target' };
  if (!validTarget(t)) return { ok: false, error: 'That does not look like a host name or IP address.' };
  const r = await run('/sbin/ping', ['-c', '10', '-i', '0.2', '-t', '14', t], { timeoutMs: 20000 });
  const sent = num(line(r.out, /(\d+) packets transmitted/)) || 10;
  const recv = num(line(r.out, /(\d+) packets received/)) || 0;
  const times = []; const re = /time=([\d.]+)\s*ms/g; let m;
  while ((m = re.exec(r.out)) !== null) times.push(parseFloat(m[1]));
  let min = 0, max = 0, avg = 0, jit = 0;
  if (times.length) {
    min = Math.min(...times); max = Math.max(...times);
    avg = Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10;
    if (times.length > 1) { let d = 0; for (let i = 1; i < times.length; i++) d += Math.abs(times[i] - times[i - 1]); jit = Math.round((d / (times.length - 1)) * 10) / 10; }
  }
  return { ok: true, target: t, sent, received: recv, lossPct: sent ? Math.round(((sent - recv) / sent) * 100) : 100, minMs: min, maxMs: max, avgMs: avg, jitterMs: jit };
}

async function discover(onProgress) {
  const i = await info();
  const ip = i.ipv4;
  if (!ip || /^169\.254\./.test(ip)) return { ok: false, error: 'no-subnet' };
  const base = ip.replace(/\.\d+$/, '.');
  if (onProgress) onProgress('Scanning ' + base + '0/24 ...');
  const addrs = []; for (let n = 1; n <= 254; n++) addrs.push(base + n);
  const res = await mapLimit(addrs, 48, async (a) => {
    const r = await run('/sbin/ping', ['-c', '1', '-t', '1', a], { timeoutMs: 2500 });
    const m = /time=([\d.]+)\s*ms/.exec(r.out);
    return m ? { ip: a, ms: Math.round(parseFloat(m[1])) } : null;
  });
  const alive = res.filter(Boolean);
  const arp = await run('/usr/sbin/arp', ['-an'], { timeoutMs: 8000 });
  const macs = {}; { const re = /\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]+)/gi; let m; while ((m = re.exec(arp.out)) !== null) macs[m[1]] = m[2]; }
  const hosts = await mapLimit(alive, 16, async (h) => {
    let name = '';
    try { const n = await Promise.race([dns.reverse(h.ip), new Promise((r) => setTimeout(() => r([]), 1500))]); name = clean((n && n[0]) || '', 80); } catch { /* ignore */ }
    return { ip: h.ip, name, ms: h.ms, mac: macs[h.ip] || '' };
  });
  if (onProgress) onProgress('Found ' + hosts.length + ' device(s).');
  return { ok: true, subnet: base + '0/24', count: hosts.length, hosts };
}

module.exports = { info, ping, discover, validTarget };
