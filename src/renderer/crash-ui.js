'use strict';

// Crash Analysis tab (macOS): kernel panics with the reason explained in plain
// English, apps that keep crashing or hanging, and why the Mac last shut down.
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
  function fmtTime(t) { const d = new Date(t); return isNaN(d) ? String(t || '') : d.toLocaleString(); }

  async function load() {
    if (loading) return;
    loading = true; loaded = true;
    els.status.hidden = false; els.error.hidden = true; els.content.hidden = true;
    try {
      const res = await window.crash.list();
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

  function panicCard(p) {
    const card = el('section', 'crash-card');
    const head = el('div', 'crash-card__head');
    const left = el('div');
    left.appendChild(el('h3', null, p.title || 'Kernel panic'));
    left.appendChild(el('div', 'crash-sub', fmtTime(p.time)));
    head.appendChild(left);
    const badge = el('div', 'crash-code');
    badge.appendChild(el('span', 'crash-code__hex', 'Kernel panic'));
    head.appendChild(badge);
    card.appendChild(head);
    if (p.why) card.appendChild(el('p', 'crash-plain', p.why));
    if (p.fix) {
      const grid = el('div', 'crash-grid');
      const c = el('div', 'crash-col');
      c.appendChild(el('h4', 'crash-col__h', 'What to try'));
      c.appendChild(el('p', null, p.fix));
      grid.appendChild(c);
      if (arr(p.thirdPartyKexts).length) {
        const c2 = el('div', 'crash-col');
        c2.appendChild(el('h4', 'crash-col__h', 'Third-party extensions involved'));
        const ul = el('ul'); for (const k of p.thirdPartyKexts) ul.appendChild(el('li', null, k));
        c2.appendChild(ul);
        grid.appendChild(c2);
      }
      card.appendChild(grid);
    }
    const meta = el('div', 'crash-meta');
    const add = (k, v) => { if (!v) return; meta.append(el('span', 'crash-meta__k', k), el('span', 'crash-meta__v', String(v))); };
    add('Panic reason', p.reason);
    add('Report file', p.name);
    add('Size', p.sizeKB != null ? p.sizeKB + ' KB' : null);
    if (meta.children.length) card.appendChild(meta);
    return card;
  }

  function render(data) {
    last = data;
    els.status.hidden = true; els.error.hidden = true; els.content.hidden = false;
    els.content.innerHTML = '';
    const panics = arr(data.dumps), apps = arr(data.appCrashes), events = arr(data.events);

    const summary = el('section', 'crash-summary');
    summary.appendChild(el('h2', null, panics.length ? (panics.length + ' kernel panic' + (panics.length === 1 ? '' : 's') + ' on record') : 'No kernel panics on record'));
    const bits = [];
    bits.push(apps.length ? (apps.length + ' app' + (apps.length === 1 ? '' : 's') + ' crashed or hung in the last 30 days') : 'no app crashes in the last 30 days');
    if (data.shutdownScanPending) bits.push('still reading the system log for shutdown causes - press Refresh in a minute');
    else bits.push(num(data.abnormalShutdowns) + ' abnormal shutdown' + (num(data.abnormalShutdowns) === 1 ? '' : 's') + ' in the last week');
    summary.appendChild(el('p', 'muted', bits.join('  ·  ') + '.'));
    if (!panics.length) summary.appendChild(el('p', 'muted', 'A kernel panic is the Mac equivalent of a blue screen: macOS hits an error it cannot recover from and restarts. macOS keeps the reports in /Library/Logs/DiagnosticReports.'));
    els.content.appendChild(summary);

    for (const p of panics) els.content.appendChild(panicCard(p));

    if (events.length) {
      els.content.appendChild(el('h3', 'crash-section', 'Why the Mac shut down (last 7 days)'));
      const tl = el('div', 'crash-timeline');
      for (const e of events) {
        const row = el('div', 'crash-ev crash-ev--' + (e.kind === 'power' ? 'power' : 'other'));
        row.appendChild(el('div', 'crash-ev__time', fmtTime(e.time)));
        const body = el('div', 'crash-ev__body');
        body.appendChild(el('div', 'crash-ev__tag', e.kind === 'power' ? 'Abnormal shutdown' : 'Normal'));
        body.appendChild(el('div', 'crash-ev__msg', e.message || ''));
        row.appendChild(body);
        tl.appendChild(row);
      }
      els.content.appendChild(tl);
      els.content.appendChild(el('p', 'muted', 'macOS logs a cause code at each start-up. Apple does not publish what the codes mean; these are the commonly accepted readings.'));
    }

    if (apps.length) {
      const sec = el('section', 'info-card');
      sec.appendChild(el('h3', 'info-card__title', 'Apps crashing or hanging (last 30 days)'));
      const t = el('table', 'info-table');
      const thead = el('thead'); const htr = el('tr');
      ['App', 'Crashes', 'Hangs', 'Most recent'].forEach((h) => htr.appendChild(el('th', null, h)));
      thead.appendChild(htr); t.appendChild(thead);
      const tb = el('tbody');
      for (const a of apps) { const tr = el('tr'); [a.app, a.crashes, a.hangs, fmtTime(a.last)].forEach((c) => tr.appendChild(el('td', null, String(c)))); tb.appendChild(tr); }
      t.appendChild(tb); sec.appendChild(t);
      els.content.appendChild(sec);
    }
  }
  function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }

  function buildSyncroHtml() {
    const e = window.tmEsc || ((s) => s);
    const d = last || {};
    const out = ['<p><strong>TM Toolset — Crash Analysis (Mac)</strong><br>' + e(new Date().toLocaleString()) + '</p>'];
    const panics = arr(d.dumps);
    if (!panics.length) out.push('<p>No kernel panics on record.</p>');
    else {
      out.push('<p><strong>' + panics.length + ' kernel panic' + (panics.length === 1 ? '' : 's') + ':</strong></p><ul>');
      for (const p of panics.slice(0, 10)) out.push('<li><strong>' + e(p.title) + '</strong> — ' + e(fmtTime(p.time)) + (arr(p.thirdPartyKexts).length ? ' (third-party: ' + e(p.thirdPartyKexts.join(', ')) + ')' : '') + '<br><em>' + e(p.fix || '') + '</em></li>');
      out.push('</ul>');
    }
    const bad = arr(d.events).filter((x) => x.kind === 'power');
    if (bad.length) { out.push('<p><strong>Abnormal shutdowns (7 days):</strong></p><ul>'); for (const ev of bad.slice(0, 10)) out.push('<li>' + e(fmtTime(ev.time)) + ' — ' + e(ev.message) + '</li>'); out.push('</ul>'); }
    const apps = arr(d.appCrashes).filter((a) => a.crashes + a.hangs >= 3);
    if (apps.length) out.push('<p><strong>Unstable apps:</strong> ' + apps.map((a) => e(a.app) + ' (' + (a.crashes + a.hangs) + ')').join(', ') + '</p>');
    out.push('<p><em>Generated by TM Toolset · Technical Merritt Computer Services</em></p>');
    return out.join('\n');
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#crashStatus');
    els.error = $('#crashError');
    els.errorDetail = $('#crashErrorDetail');
    els.content = $('#crashContent');
    els.refresh = $('#crashRefresh');
    els.syncro = $('#crashSyncro');
    if (!els.content) return;
    els.refresh && els.refresh.addEventListener('click', load);
    els.syncro && els.syncro.addEventListener('click', () => {
      if (!loaded) { load().then(() => window.tmSyncroPost(els.syncro, 'TM Toolset — Crash Analysis', buildSyncroHtml())); }
      else window.tmSyncroPost(els.syncro, 'TM Toolset — Crash Analysis', buildSyncroHtml());
    });
    const tab = document.querySelector('.tab[data-tab="crash"]');
    if (tab) tab.addEventListener('click', () => { if (!loaded) load(); });
  });
})();
