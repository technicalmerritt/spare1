'use strict';

// Devices tab (macOS): what is connected over USB, Thunderbolt and Bluetooth,
// plus the third-party kernel and system extensions that act as drivers.
(function () {
  const els = {};
  let loaded = false;
  let loading = false;
  let last = null;

  function $(s) { return document.querySelector(s); }
  function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function table(headers, rows) {
    const t = el('table', 'info-table');
    const thead = el('thead'); const htr = el('tr');
    headers.forEach((h) => htr.appendChild(el('th', null, h)));
    thead.appendChild(htr); t.appendChild(thead);
    const tb = el('tbody');
    for (const r of rows) { const tr = el('tr'); r.forEach((c) => tr.appendChild(el('td', null, c == null ? '' : String(c)))); tb.appendChild(tr); }
    t.appendChild(tb);
    return t;
  }
  function card(title, body) {
    const c = el('section', 'info-card');
    c.appendChild(el('h3', 'info-card__title', title));
    c.appendChild(body);
    return c;
  }

  async function load() {
    if (loading) return;
    loading = true; loaded = true;
    els.status.hidden = false; els.error.hidden = true; els.content.hidden = true;
    try {
      const res = await window.devices.list();
      if (!res || res.ok !== true) { showError(res ? res.error : 'Unknown error'); return; }
      render(res.data || {});
    } catch (e) { showError((e && e.message) || String(e)); }
    finally { loading = false; }
  }
  function showError(msg) {
    els.status.hidden = true; els.content.hidden = true;
    els.errorDetail.textContent = msg || '(no detail)';
    els.error.hidden = false;
  }

  function render(data) {
    last = data;
    els.status.hidden = true; els.error.hidden = true; els.content.hidden = false;
    els.content.innerHTML = '';
    const problems = arr(data.problems);
    const summary = el('section', 'crash-summary');
    summary.appendChild(el('h2', null, problems.length ? (problems.length + ' extension' + (problems.length === 1 ? '' : 's') + ' to review') : 'No extension problems'));
    summary.appendChild(el('p', 'muted', 'Macs do not use separate drivers for most hardware. What matters instead is third-party kernel and system extensions, which run with deep system access. ' + (data.totalDevices != null ? data.totalDevices + ' connected or paired device(s) found.' : '')));
    els.content.appendChild(summary);

    for (const p of problems) {
      const c = el('section', 'crash-card');
      const head = el('div', 'crash-card__head');
      const left = el('div');
      left.appendChild(el('h3', null, p.name));
      left.appendChild(el('div', 'crash-sub', p.status || ''));
      head.appendChild(left);
      const badge = el('div', 'crash-code'); badge.appendChild(el('span', 'crash-code__hex', p.class)); head.appendChild(badge);
      c.appendChild(head);
      c.appendChild(el('p', 'crash-plain', p.detail || ''));
      els.content.appendChild(c);
    }

    const usb = arr(data.usb);
    els.content.appendChild(card('USB devices (' + usb.length + ')', usb.length
      ? table(['Device', 'Maker', 'Speed', 'Serial'], usb.map((u) => [u.name, u.manufacturer, u.speed, u.serial]))
      : el('p', 'muted', 'Nothing connected over USB.')));
    const tb = arr(data.thunderbolt);
    if (tb.length) els.content.appendChild(card('Thunderbolt devices (' + tb.length + ')', table(['Device', 'Maker', 'Port'], tb.map((t) => [t.name, t.manufacturer, t.bus]))));
    const bt = arr(data.bluetooth);
    els.content.appendChild(card('Bluetooth devices (' + bt.length + ')', bt.length
      ? table(['Device', 'Type', 'Status', 'Battery'], bt.map((b) => [b.name, b.type, b.connected ? 'Connected' : 'Paired, not connected', b.battery]))
      : el('p', 'muted', 'No paired Bluetooth devices.')));
    const sx = arr(data.sysexts);
    els.content.appendChild(card('System extensions (' + sx.length + ')', sx.length
      ? table(['Extension', 'Identifier', 'Version', 'State'], sx.map((s) => [s.name, s.id, s.version, s.state]))
      : el('p', 'muted', 'No third-party system extensions installed.')));
    const kx = arr(data.kexts);
    els.content.appendChild(card('Legacy kernel extensions (' + kx.length + ')', kx.length
      ? table(['Identifier', 'Version'], kx.map((k) => [k.id, k.version]))
      : el('p', 'muted', 'No third-party kernel extensions loaded - the ideal state on a modern Mac.')));
  }

  function buildSyncroHtml() {
    const e = window.tmEsc || ((s) => s);
    const d = last || {};
    const out = ['<p><strong>TM Toolset — Devices &amp; Extensions (Mac)</strong><br>' + e(new Date().toLocaleString()) + '</p>'];
    const problems = arr(d.problems);
    if (!problems.length) out.push('<p>No extension problems.</p>');
    else { out.push('<ul>'); for (const p of problems) out.push('<li><strong>' + e(p.name) + '</strong> (' + e(p.class) + ') — ' + e(p.detail || '') + '</li>'); out.push('</ul>'); }
    out.push('<p>USB: ' + (arr(d.usb).map((u) => e(u.name)).join(', ') || 'none') + '</p>');
    out.push('<p><em>Generated by TM Toolset · Technical Merritt Computer Services</em></p>');
    return out.join('\n');
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#devicesStatus');
    els.error = $('#devicesError');
    els.errorDetail = $('#devicesErrorDetail');
    els.content = $('#devicesContent');
    els.refresh = $('#devicesRefresh');
    els.syncro = $('#devicesSyncro');
    if (!els.content) return;
    els.refresh && els.refresh.addEventListener('click', load);
    els.syncro && els.syncro.addEventListener('click', () => {
      if (!loaded) { load().then(() => window.tmSyncroPost(els.syncro, 'TM Toolset — Devices', buildSyncroHtml())); }
      else window.tmSyncroPost(els.syncro, 'TM Toolset — Devices', buildSyncroHtml());
    });
    const tab = document.querySelector('.tab[data-tab="devices"]');
    if (tab) tab.addEventListener('click', () => { if (!loaded) load(); });
  });
})();
