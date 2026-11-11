'use strict';

(function () {
  const els = {};
  let loaded = false;
  let loading = false;
  let lastBattery = null;

  function $(s) { return document.querySelector(s); }
  function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
  function num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function healthClass(p) { return p >= 80 ? 'good' : p >= 50 ? 'warn' : 'bad'; }
  function metric(label, value, cls) {
    const b = el('div', 'metric' + (cls ? ' metric--' + cls : ''));
    b.appendChild(el('div', 'metric__val', value));
    b.appendChild(el('div', 'metric__lbl', label));
    return b;
  }

  async function load() {
    if (loading) return;
    loading = true; loaded = true;
    els.status.hidden = false; els.error.hidden = true; els.content.hidden = true;
    try {
      const res = await window.battery.list();
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

  function batteryCard(b, data) {
    const wear = num(b.wearPct);
    const health = Math.max(1, Math.min(100, Math.round(100 - wear)));
    const card = el('section', 'drive-card');

    const head = el('div', 'drive-head');
    const title = el('div', 'drive-title');
    title.appendChild(el('h3', null, b.manufacturer ? (b.manufacturer + ' battery') : 'Battery'));
    title.appendChild(el('div', 'drive-sub', [b.chemistry, b.id].filter(Boolean).join('  ·  ')));
    head.appendChild(title);

    const ring = el('div', 'drive-health drive-health--' + healthClass(health));
    ring.style.setProperty('--pct', health);
    const inner = el('div', 'drive-health__inner');
    inner.append(el('span', 'drive-health__pct', health + '%'), el('small', null, 'Health'));
    ring.appendChild(inner);
    head.appendChild(ring);
    card.appendChild(head);

    const strip = el('div', 'metric-strip');
    strip.appendChild(metric('Wear', wear + ' %', healthClass(health)));
    if (b.condition) strip.appendChild(metric('macOS says', b.condition, /normal/i.test(b.condition) ? 'good' : 'bad'));
    if (b.cycleCount != null) strip.appendChild(metric('Cycle count', num(b.cycleCount) + (b.maxCycles ? ' of ' + b.maxCycles : ''), b.maxCycles && num(b.cycleCount) >= b.maxCycles ? 'bad' : ''));
    if (b.fullChargeCapacity) strip.appendChild(metric('Full charge', b.fullChargeCapacity + ' mAh'));
    if (b.designCapacity) strip.appendChild(metric('Design capacity', b.designCapacity + ' mAh'));
    if (b.temperatureC != null) strip.appendChild(metric('Temperature', b.temperatureC + ' °C', b.temperatureC >= 45 ? 'bad' : b.temperatureC >= 38 ? 'warn' : 'good'));
    if (data.currentChargePct != null) strip.appendChild(metric('Charge now', num(data.currentChargePct) + ' %' + (data.onACPower ? ' (AC)' : '')));
    card.appendChild(strip);

    const specs = el('div', 'kv drive-specs');
    const add = (k, v) => { if (v == null || v === '') return; specs.append(el('div', 'kv__k', k), el('div', 'kv__v', String(v))); };
    add('Serial', b.serial);
    add('Chemistry', b.chemistry);
    add('Maximum capacity', b.maximumCapacityPct != null ? b.maximumCapacityPct + '% of new' : null);
    add('Voltage', b.voltage ? b.voltage + ' V' : null);
    add('Charger', data.charger ? [data.charger.watts ? data.charger.watts + ' W' : '', data.charger.name || ''].filter(Boolean).join('  ·  ') : (data.onACPower ? 'Connected' : 'Not connected'));
    card.appendChild(specs);

    let verdict = 'Battery is in good health.';
    if (/service|replace/i.test(b.condition || '')) verdict = 'macOS itself is recommending service for this battery. Quote a replacement.';
    else if (wear >= 40) verdict = 'Heavily worn — the pack holds well under 60% of its design capacity. Recommend replacement.';
    else if (wear >= 25) verdict = 'Noticeable wear — runtime will be clearly reduced. Flag to the customer.';
    else if (wear >= 20) verdict = 'Below 80% of original capacity - the point Apple treats a battery as consumed. Flag to the customer.';
    else if (wear >= 10) verdict = 'Some wear, normal for a MacBook of this age.';
    card.appendChild(el('p', 'muted', verdict));

    return card;
  }

  function buildSyncroHtml() {
    const e = window.tmEsc || ((s) => s);
    const data = lastBattery || {};
    const out = ['<p><strong>TM Toolset — Battery Health</strong><br>' + e(new Date().toLocaleString()) + '</p>'];
    if (!data.hasBattery) {
      out.push('<p>No battery detected (desktop or no battery present).</p>');
    } else {
      for (const b of arr(data.batteries)) {
        const wear = num(b.wearPct);
        out.push('<p><strong>' + e(b.manufacturer || 'Battery') + '</strong> — health <strong>' + Math.round(100 - wear) + '%</strong>, wear ' + wear + '%' +
          (b.cycleCount != null ? ', ' + e(b.cycleCount) + ' cycles' : '') +
          (b.condition ? ', condition: ' + e(b.condition) : '') +
          (b.fullChargeCapacity && b.designCapacity ? ', full charge ' + e(b.fullChargeCapacity) + ' mAh of ' + e(b.designCapacity) + ' mAh design' : '') + '</p>');
      }
    }
    out.push('<p><em>Generated by TM Toolset · Technical Merritt Computer Services</em></p>');
    return out.join('\n');
  }

  function render(data) {
    lastBattery = data;
    if (data && data.error) {
      showError(data.error + (data.line ? '  (line ' + data.line + ': ' + (data.near || '') + ')' : ''));
      return;
    }
    els.status.hidden = true; els.error.hidden = true; els.content.hidden = false;
    els.content.innerHTML = '';
    if (!data.hasBattery) {
      const box = el('section', 'crash-summary');
      box.appendChild(el('h2', null, 'No battery detected'));
      box.appendChild(el('p', 'muted', 'This looks like a desktop Mac (iMac, Mac mini, Mac Studio or Mac Pro), or the battery is not reporting. Battery health only applies to MacBooks.'));
      els.content.appendChild(box);
      return;
    }
    for (const b of arr(data.batteries)) els.content.appendChild(batteryCard(b, data));
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#batteryStatus');
    els.error = $('#batteryError');
    els.errorDetail = $('#batteryErrorDetail');
    els.content = $('#batteryContent');
    els.refresh = $('#batteryRefresh');
    els.syncro = $('#batterySyncro');
    if (!els.content) return;
    els.refresh && els.refresh.addEventListener('click', load);
    els.syncro && els.syncro.addEventListener('click', () => {
      if (!loaded) { load().then(() => window.tmSyncroPost(els.syncro, 'TM Toolset — Battery Health', buildSyncroHtml())); }
      else window.tmSyncroPost(els.syncro, 'TM Toolset — Battery Health', buildSyncroHtml());
    });
    const tab = document.querySelector('.tab[data-tab="battery"]');
    if (tab) tab.addEventListener('click', () => { if (!loaded) load(); });
  });
})();
