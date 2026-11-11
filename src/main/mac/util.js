'use strict';

// Shared helpers for the macOS collectors: run a command without ever
// throwing, read system_profiler JSON, and parse XML property lists.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

// Run a program (never through a shell). Always resolves:
// { out, err, code, timedOut }. `input` is written to stdin when given.
function run(cmd, args, opts) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs || 20000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args || [], { env: Object.assign({}, process.env, { LC_ALL: 'en_US.UTF-8' }, o.env || {}) });
    } catch (e) {
      resolve({ out: '', err: String((e && e.message) || e), code: -1, timedOut: false });
      return;
    }
    if (o.onChild) { try { o.onChild(child); } catch { /* ignore */ } }
    let out = '', err = '', done = false, size = 0;
    const max = o.maxBytes || 96 * 1024 * 1024;
    const finish = (code, timedOut) => { if (done) return; done = true; clearTimeout(timer); resolve({ out, err, code, timedOut: !!timedOut }); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } finish(-1, true); }, timeoutMs);
    child.stdout.on('data', (d) => { size += d.length; if (size <= max) out += d.toString(); });
    child.stderr.on('data', (d) => { if (err.length < 200000) err += d.toString(); });
    child.on('error', (e) => { err += String((e && e.message) || e); finish(-1, false); });
    child.on('close', (code) => finish(code == null ? -1 : code, false));
    if (o.input != null) { try { child.stdin.end(o.input); } catch { /* ignore */ } }
  });
}

// system_profiler -json for one or more data types. Unknown types (they vary
// between macOS releases) are simply absent from the result.
async function profiler(types, timeoutMs) {
  const list = Array.isArray(types) ? types : [types];
  const r = await run('/usr/sbin/system_profiler', ['-json'].concat(list), { timeoutMs: timeoutMs || 45000 });
  const s = r.out.indexOf('{');
  if (s < 0) return {};
  try { return JSON.parse(r.out.slice(s)); } catch { return {}; }
}

// ---- XML property list parser (handles dict/array/string/number/bool/date/data) ----
function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function parsePlist(xml) {
  if (!xml || typeof xml !== 'string') return null;
  const re = /<(\/?)(dict|array|key|string|integer|real|date|data|true|false|plist)(\s[^>]*)?(\/?)>/g;
  const stack = [];
  let root, key = null, m, textStart = -1, textTag = null;
  const place = (v) => {
    const top = stack[stack.length - 1];
    if (!top) { if (root === undefined) root = v; return; }
    if (Array.isArray(top.v)) top.v.push(v);
    else { if (top.key != null) { top.v[top.key] = v; top.key = null; } }
  };
  while ((m = re.exec(xml)) !== null) {
    const closing = m[1] === '/', tag = m[2], selfClose = m[4] === '/';
    if (tag === 'plist') continue;
    if (tag === 'dict' || tag === 'array') {
      if (selfClose) { place(tag === 'dict' ? {} : []); continue; }
      if (!closing) { const v = tag === 'dict' ? {} : []; place(v); stack.push({ v, key: null }); }
      else stack.pop();
      continue;
    }
    if (tag === 'true' || tag === 'false') { place(tag === 'true'); continue; }
    if (selfClose) { if (tag === 'key') { const t = stack[stack.length - 1]; if (t) t.key = ''; } else place(tag === 'string' || tag === 'data' || tag === 'date' ? '' : 0); continue; }
    if (!closing) { textStart = re.lastIndex; textTag = tag; continue; }
    if (textTag !== tag || textStart < 0) continue;
    const raw = unescapeXml(xml.slice(textStart, m.index));
    textStart = -1; textTag = null;
    if (tag === 'key') { const t = stack[stack.length - 1]; if (t) t.key = raw; key = raw; continue; }
    if (tag === 'integer') place(parseInt(raw.trim(), 10));
    else if (tag === 'real') place(parseFloat(raw.trim()));
    else if (tag === 'data') place(raw.replace(/\s+/g, ''));
    else place(raw);
  }
  void key;
  return root === undefined ? null : root;
}

// Read any plist file (binary or XML) as a JS object, or null.
async function readPlistFile(file) {
  try { if (!fs.existsSync(file)) return null; } catch { return null; }
  const r = await run('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', file], { timeoutMs: 8000 });
  if (r.code !== 0) return null;
  return parsePlist(r.out);
}
// Run a command that prints an XML plist and parse it.
async function plistFrom(cmd, args, timeoutMs) {
  const r = await run(cmd, args, { timeoutMs: timeoutMs || 20000 });
  return parsePlist(r.out);
}

function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
function gb(bytes, dp) { const n = Number(bytes); if (!Number.isFinite(n)) return null; const f = Math.pow(10, dp == null ? 1 : dp); return Math.round((n / 1e9) * f) / f; }
function num(v) { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^0-9.+-]/g, '')); return Number.isFinite(n) ? n : null; }
function clean(s, max) { const t = String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').trim(); return max && t.length > max ? t.slice(0, max) : t; }
function firstExisting(paths) { for (const p of paths) { try { if (fs.existsSync(p)) return p; } catch { /* ignore */ } } return null; }
// Run `fn` over items with a concurrency cap.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  const worker = async () => { for (;;) { const n = i++; if (n >= items.length) return; try { out[n] = await fn(items[n], n); } catch { out[n] = null; } } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, worker));
  return out;
}
// Darwin 22 = macOS 13 (Ventura), where System Preferences became System Settings.
function darwinMajor() { return parseInt(String(os.release()).split('.')[0], 10) || 0; }
const home = () => os.homedir();

module.exports = { run, profiler, parsePlist, readPlistFile, plistFrom, arr, gb, num, clean, firstExisting, mapLimit, darwinMajor, home };
