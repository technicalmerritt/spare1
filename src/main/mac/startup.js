'use strict';

// macOS startup items: launch agents and daemons (user and machine-wide) and
// classic "Open at Login" items, each with its enabled state, the program it
// runs and who signed it. Toggling uses launchctl enable/disable, which is
// reversible and takes effect at the next login or restart.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, readPlistFile, arr, clean, mapLimit, home } = require('./util');

const LABEL_OK = /^[A-Za-z0-9._\-]+$/;

function uid() { try { return os.userInfo().uid; } catch { return 501; } }

// `launchctl print-disabled <domain>` -> { label: true|false } (true = disabled)
async function disabledMap(domain) {
  const r = await run('/bin/launchctl', ['print-disabled', domain], { timeoutMs: 8000 });
  const m = {}; const re = /"([^"]+)"\s*=>\s*(true|false|disabled|enabled)/g; let x;
  while ((x = re.exec(r.out)) !== null) m[x[1]] = x[2] === 'true' || x[2] === 'disabled';
  return m;
}

async function signature(exe) {
  const o = { signed: '', signer: '', publisher: '', apple: false };
  if (!exe) return o;
  try { if (!fs.existsSync(exe)) return o; } catch { return o; }
  const d = await run('/usr/bin/codesign', ['-dv', '--verbose=2', exe], { timeoutMs: 8000 });
  const text = d.err + d.out;
  if (/not signed at all/i.test(text)) { o.signed = 'unsigned'; return o; }
  const auth = /Authority=(.+)/.exec(text);
  if (auth) {
    o.signer = clean(auth[1].replace(/^Developer ID Application:\s*/i, '').replace(/^Apple Development:\s*/i, '').replace(/\s*\([A-Z0-9]{10}\)\s*$/, ''), 80);
    o.apple = /^(Software Signing|Apple Mac OS Application Signing)$/i.test(auth[1].trim());
    o.publisher = o.apple ? 'Apple' : o.signer;
  } else if (/Signature=adhoc/i.test(text)) { o.signer = 'ad-hoc (no identity)'; }
  if (!auth && !/Signature=adhoc/i.test(text) && !/Identifier=/.test(text)) return o;
  const v = await run('/usr/bin/codesign', ['--verify', exe], { timeoutMs: 15000 });
  o.signed = v.code === 0 ? (auth ? 'valid' : 'unsigned') : 'invalid';
  return o;
}

async function plistItems(dir, type, scope, domain, disabled) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.plist$/i.test(f)); } catch { return []; }
  const out = await mapLimit(files, 6, async (f) => {
    const file = path.join(dir, f);
    const p = (await readPlistFile(file)) || {};
    const label = clean(p.Label || f.replace(/\.plist$/i, ''), 160);
    const args = arr(p.ProgramArguments).map(String);
    const exe = String(p.Program || args[0] || '');
    const off = disabled[label] === true || p.Disabled === true;
    return {
      id: type + '|' + domain + '|' + label, name: label, type, command: clean(p.Program ? [p.Program].concat(args.slice(1)).join(' ') : args.join(' '), 400),
      location: dir.replace(home(), '~'), scope, enabled: !off, exePath: exe, plistPath: file, label, domain,
      runAtLoad: p.RunAtLoad === true, keepAlive: p.KeepAlive != null && p.KeepAlive !== false,
    };
  });
  return out.filter(Boolean);
}

async function loginItems() {
  // Asks System Events; macOS may show a one-time "wants to control System Events" prompt.
  const script = 'tell application "System Events" to get the {name, path} of every login item';
  const r = await run('/usr/bin/osascript', ['-s', 's', '-e', script], { timeoutMs: 12000 });
  if (r.code !== 0) return [];
  const m = /^\{\{(.*)\},\s*\{(.*)\}\}\s*$/s.exec(r.out.trim());
  if (!m) return [];
  const split = (s) => { const a = []; const re = /"((?:[^"\\]|\\.)*)"|missing value/g; let x; while ((x = re.exec(s)) !== null) a.push(x[1] == null ? '' : x[1]); return a; };
  const names = split(m[1]), paths = split(m[2]);
  return names.map((n, i) => ({
    id: 'login|' + n, name: n, type: 'Login item', command: paths[i] || '', location: 'Open at Login (System Settings)', scope: 'User', enabled: true,
    exePath: paths[i] || '', loginName: n, loginPath: paths[i] || '',
  }));
}

// A .app bundle's real executable, for signature checks.
function bundleExe(p) {
  if (!/\.app\/?$/i.test(p)) return p;
  try {
    const dir = path.join(p, 'Contents/MacOS');
    const f = fs.readdirSync(dir)[0];
    return f ? path.join(dir, f) : p;
  } catch { return p; }
}

async function runList() {
  const u = uid();
  const [userOff, sysOff] = await Promise.all([disabledMap('gui/' + u), disabledMap('system')]);
  const groups = await Promise.all([
    plistItems(path.join(home(), 'Library/LaunchAgents'), 'Launch agent', 'User', 'gui/' + u, userOff),
    plistItems('/Library/LaunchAgents', 'Launch agent', 'Machine', 'gui/' + u, userOff),
    plistItems('/Library/LaunchDaemons', 'Launch daemon', 'Machine', 'system', sysOff),
    loginItems(),
  ]);
  const items = [].concat(...groups);
  await mapLimit(items, 6, async (it) => {
    const s = await signature(bundleExe(it.exePath));
    it.signed = s.signed; it.signer = s.signer; it.publisher = s.publisher; it.apple = s.apple;
    try { it.missing = !!it.exePath && !fs.existsSync(it.exePath); } catch { it.missing = false; }
  });
  return { items, note: 'Background items added by apps through System Settings › General › Login Items are managed there; macOS does not let other apps list them without an administrator password.' };
}

async function toggle(item, enable) {
  if (!item || !item.type) return { ok: false, message: 'Nothing to toggle.' };
  try {
    if (item.type === 'Login item') {
      const name = String(item.loginName || ''), p = String(item.loginPath || '');
      if (!name || /["\\]/.test(name) || /["\\]/.test(p)) return { ok: false, message: 'That login item has a name macOS will not accept here.' };
      const script = enable
        ? 'tell application "System Events" to make login item at end with properties {path:"' + p + '", hidden:false}'
        : 'tell application "System Events" to delete login item "' + name + '"';
      if (enable && !p) return { ok: false, message: 'No path recorded for that item, so it cannot be added back.' };
      const r = await run('/usr/bin/osascript', ['-e', script], { timeoutMs: 15000 });
      return r.code === 0 ? { ok: true } : { ok: false, message: clean(r.err || 'macOS refused the change.', 200) };
    }
    const label = String(item.label || '');
    const domain = String(item.domain || '');
    if (!LABEL_OK.test(label) || !/^(system|gui\/\d+)$/.test(domain)) return { ok: false, message: 'Unexpected item identifier.' };
    const verb = enable ? 'enable' : 'disable';
    const target = domain + '/' + label;
    if (domain === 'system') {
      // Machine-wide: macOS asks for an administrator password.
      const script = 'do shell script "/bin/launchctl ' + verb + ' ' + target + '" with administrator privileges';
      const r = await run('/usr/bin/osascript', ['-e', script], { timeoutMs: 120000 });
      if (r.code !== 0) return { ok: false, message: /User cancel/i.test(r.err) ? 'Cancelled.' : clean(r.err || 'macOS refused the change.', 200) };
      return { ok: true, message: 'Takes effect at the next restart.' };
    }
    const r = await run('/bin/launchctl', [verb, target], { timeoutMs: 15000 });
    return r.code === 0 ? { ok: true, message: 'Takes effect at the next login.' } : { ok: false, message: clean(r.err || 'launchctl refused the change.', 200) };
  } catch (e) { return { ok: false, message: (e && e.message) || String(e) }; }
}

module.exports = { runList, toggle, signature, bundleExe };
