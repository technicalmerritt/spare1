'use strict';

(function () {
  const els = {};
  let data = null;
  let loading = false;

  function $(s) {
    return document.querySelector(s);
  }

  // PowerShell single items arrive as bare objects, not arrays.
  function arr(v) {
    return Array.isArray(v) ? v : v == null ? [] : [v];
  }

  function toast(message, kind) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3200);
  }

  async function load() {
    if (loading) return;
    loading = true;
    els.status.hidden = false;
    els.error.hidden = true;
    els.content.hidden = true;
    els.statusText.textContent = 'Gathering system information…';
    try {
      const res = await window.inform.run();
      if (!res || res.ok !== true) {
        showError(res ? res.error : 'Unknown error');
        return;
      }
      data = res.data;
      render(data);
    } catch (err) {
      showError((err && err.message) || String(err));
    } finally {
      loading = false;
    }
  }

  function showError(message) {
    els.status.hidden = true;
    els.content.hidden = true;
    els.errorDetail.textContent = message || '(no detail)';
    els.error.hidden = false;
  }

  // ---- Rendering helpers ----

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function card(title) {
    const c = el('section', 'info-card');
    c.appendChild(el('h3', 'info-card__title', title));
    return c;
  }

  function kvGrid(pairs) {
    const grid = el('div', 'kv');
    for (const [k, v] of pairs) {
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      grid.appendChild(el('div', 'kv__k', k));
      grid.appendChild(el('div', 'kv__v', String(v)));
    }
    return grid;
  }

  function table(headers, rows) {
    const t = el('table', 'info-table');
    const thead = el('thead');
    const htr = el('tr');
    headers.forEach((h) => htr.appendChild(el('th', null, h)));
    thead.appendChild(htr);
    t.appendChild(thead);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      r.forEach((cell) => tr.appendChild(el('td', null, cell == null ? '' : String(cell))));
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);
    return t;
  }

  function yesNo(v, yes = 'Yes', no = 'No') {
    return v === true ? yes : v === false ? no : null;
  }

  function render(d) {
    els.status.hidden = true;
    els.error.hidden = true;
    els.content.hidden = false;
    els.content.innerHTML = '';

    const os = d.os || {};
    const c = d.computer || {};
    const cpu = d.cpu || {};
    const b = d.board || {};
    const mem = d.memory || {};
    const sec = d.security || {};
    const net = d.network || {};
    const hist = d.history || {};

    // Operating System
    const osCard = card('Operating System');
    osCard.appendChild(
      kvGrid([
        ['Name', os.name],
        ['Version', os.version],
        ['Build', os.build],
        ['Architecture', os.arch],
        ['First set up', os.installDate],
        ['Last boot', os.lastBoot],
        ['Uptime', os.uptimeHours != null ? os.uptimeHours + ' hours' : null],
        ['Boot mode', os.bootMode],
        ['Logged-in user', os.loggedInUser],
        ['Activation Lock', os.activation],
        ['Computer name', os.computerName],
        ['Startup disk', os.bootVolume],
      ])
    );
    els.content.appendChild(osCard);

    // Hardware
    const hw = card('Hardware');
    hw.appendChild(
      kvGrid([
        ['Manufacturer', c.manufacturer],
        ['Model', c.model],
        ['Model identifier', c.systemType],
        ['Model number', c.modelNumber],
        ['Serial', c.serial],
        ['Chip / processor', cpu.name],
        ['Cores', cpu.perfCores ? (cpu.cores + ' (' + cpu.perfCores + ' performance + ' + cpu.effCores + ' efficiency)') : cpu.cores],
        ['System firmware', b.biosVersion],
        ['Security chip', b.securityChip],
        ['Memory', mem.totalGB != null ? mem.totalGB + ' GB' : null],
      ])
    );
    const mods = arr(mem.modules);
    if (mods.length) {
      hw.appendChild(el('h4', 'info-sub', 'Memory modules'));
      hw.appendChild(
        table(
          ['Slot', 'Capacity', 'Speed', 'Type / part'],
          mods.map((m) => [m.slot, m.capacityGB != null ? m.capacityGB + ' GB' : '', m.speedMHz ? m.speedMHz + ' MHz' : '', m.partNumber])
        )
      );
    }
    const gpus = arr(d.graphics);
    if (gpus.length) {
      hw.appendChild(el('h4', 'info-sub', 'Graphics & displays'));
      hw.appendChild(
        table(
          ['Graphics', 'Memory / Metal', 'Displays', 'Resolution'],
          gpus.map((g) => [g.name, [g.driverVersion, g.driverDate].filter(Boolean).join('  ·  '), (g.displays || []).join(', '), [g.resolution, g.refreshHz ? g.refreshHz + ' Hz' : ''].filter(Boolean).join(' @ ')])
        )
      );
    }
    els.content.appendChild(hw);

    // Disks & volumes
    const disks = arr(d.disks);
    const vols = arr(d.volumes);
    if (disks.length || vols.length) {
      const dk = card('Disks & volumes');
      if (disks.length) {
        dk.appendChild(
          table(
            ['Drive', 'Type', 'Bus', 'Size', 'Health', 'Wear'],
            disks.map((x) => [x.model, x.media, x.bus, x.sizeGB ? x.sizeGB + ' GB' : '', x.health, x.wearPct != null ? x.wearPct + '%' : ''])
          )
        );
      }
      if (vols.length) {
        dk.appendChild(el('h4', 'info-sub', 'Volumes'));
        dk.appendChild(
          table(
            ['Mounted at', 'Name', 'File system', 'Free', 'Size', 'Free %'],
            vols.map((v) => [v.drive, v.label, v.fs, v.freeGB + ' GB', v.sizeGB + ' GB', v.freePct + '%'])
          )
        );
      }
      els.content.appendChild(dk);
    }

    // Security
    const sc = card('Security');
    sc.appendChild(
      kvGrid([
        ['Default browser', d.defaultBrowser],
        ['FileVault (disk encryption)', sec.fileVault],
        ['System Integrity Protection', yesNo(sec.sip, 'On', 'OFF')],
        ['Gatekeeper', yesNo(sec.gatekeeper, 'On', 'OFF')],
        ['XProtect version', sec.xprotectVersion],
        ['Automatic update checks', yesNo(sec.autoCheck, 'On', 'Off')],
        ['Install macOS updates automatically', yesNo(sec.autoInstallMacOS, 'On', 'Off')],
        ['Install security responses automatically', yesNo(sec.autoInstallSecurity, 'On', 'Off')],
        ['Firewall stealth mode', yesNo(sec.firewallStealth, 'On', 'Off')],
      ])
    );
    const fw = arr(sec.firewall);
    if (fw.length) sc.appendChild(el('p', 'info-line', 'Firewall — ' + fw.map((f) => `${f.profile}: ${f.enabled ? 'on' : 'off'}`).join(', ')));
    const avs = arr(sec.avProducts);
    if (avs.length) sc.appendChild(el('p', 'info-line', 'Security software installed — ' + avs.map((a) => a.name).join(', ')));
    els.content.appendChild(sc);

    // Network
    const nc = card('Network');
    nc.appendChild(
      kvGrid([
        ['Network', net.status],
        ['Proxy', net.proxy || 'None'],
        ['Hosts-file entries', net.hostsCount],
      ])
    );
    const adapters = arr(net.adapters);
    if (adapters.length) {
      nc.appendChild(
        table(
          ['Service', 'Status', 'IPv4', 'MAC address', 'Configured by'],
          adapters.map((a) => [a.name || a.desc, a.status, a.ipv4, a.mac, a.dhcp])
        )
      );
    }
    els.content.appendChild(nc);

    // History
    const hc = card('Backup & history');
    hc.appendChild(
      kvGrid([
        ['Time Machine', hist.timeMachine],
        ['Last backup', hist.lastBackup],
        ['Kernel panics (30 days)', hist.panics30d],
      ])
    );
    const usb = arr(hist.usbDevices);
    if (usb.length) hc.appendChild(el('p', 'info-line', 'USB devices connected — ' + usb.slice(0, 12).join(', ')));
    els.content.appendChild(hc);

    // Installed programs
    const progs = arr(d.programs);
    const pc = card(`Installed apps (${progs.length})`);
    if (progs.length) {
      pc.appendChild(
        table(
          ['Name', 'Version', 'Developer', 'Source', 'Built for', 'Modified'],
          progs.map((p) => [p.name, p.version, p.publisher, p.source, p.arch, p.installed])
        )
      );
    } else {
      pc.appendChild(el('p', 'muted', 'No apps were listed.'));
    }
    els.content.appendChild(pc);
  }

  async function exportText() {
    if (!data) return;
    try {
      const p = await window.inform.exportText(data);
      if (p) toast('Saved:\n' + p);
    } catch (err) {
      toast('Export failed: ' + ((err && err.message) || err), 'error');
    }
  }

  async function openAssetModal() {
    if (!data) {
      toast('Let the information finish loading first.', 'error');
      return;
    }
    const tk = window.activeTicket && window.activeTicket.get();
    if (!tk || !tk.customerId) {
      toast('Set a ticket number in the top bar first (so we know the customer).', 'error');
      const input = document.getElementById('ticketInput');
      if (input) input.focus();
      return;
    }
    els.createAsset.disabled = true;
    try {
      const res = await window.syncro.assetTypes();
      if (!res || !res.ok) {
        toast((res && res.message) || 'Could not load asset types.', 'error');
        return;
      }
      if (!res.types.length) {
        toast('No asset types in Syncro yet — create one under Admin → Asset Types, then try again.', 'error');
        return;
      }
      els.assetType.innerHTML = '';
      for (const t of res.types) {
        const o = document.createElement('option');
        o.value = String(t.id);
        o.textContent = t.name;
        els.assetType.appendChild(o);
      }
      const c = data.computer || {};
      els.assetName.value = [c.manufacturer, c.model].filter(Boolean).join(' ').trim() || 'Mac';
      els.assetTarget.textContent = `Customer: ${tk.customerName}`;
      els.assetModal.hidden = false;
    } catch (err) {
      toast('Asset error: ' + ((err && err.message) || err), 'error');
    } finally {
      els.createAsset.disabled = false;
    }
  }

  function closeAssetModal() {
    els.assetModal.hidden = true;
  }

  async function doCreateAsset() {
    const tk = window.activeTicket && window.activeTicket.get();
    if (!tk || !tk.customerId) {
      toast('No customer — set a ticket first.', 'error');
      return;
    }
    const assetTypeId = parseInt(els.assetType.value, 10);
    const name = (els.assetName.value || '').trim() || 'Mac';
    const os = data.os || {};
    const c = data.computer || {};
    const cpu = data.cpu || {};
    const mem = data.memory || {};
    const board = data.board || {};
    const gpus = arr(data.graphics).map((x) => x.name).filter(Boolean).join('; ');
    const disks = arr(data.disks)
      .map((x) => [x.model, x.sizeGB ? x.sizeGB + ' GB' : '', x.media].filter(Boolean).join(' '))
      .join('; ');
    const ip = (arr(data.network && data.network.adapters).find((a) => a.ipv4) || {}).ipv4;
    const osStr = [os.name, os.displayVersion].filter(Boolean).join(' ');

    // Keys must match Syncro's Computer asset field names exactly to populate.
    // "Serial" / "Serial Number" = the BIOS/system serial (Dell/Lenovo service tag).
    const properties = {
      'Serial Number': c.serial,
      Serial: c.serial,
      OS: os.name ? (os.name + ' ' + (os.version || '') + (os.build ? ` (build ${os.build})` : '')) : undefined,
      CPU: cpu.name,
      RAM: mem.totalGB != null ? mem.totalGB + ' GB' : undefined,
      Video: gpus,
      Disks: disks,
      Board: c.systemType,
      BIOS: board.biosVersion,
      Installed: os.installDate,
      IP: ip,
    };
    Object.keys(properties).forEach((k) => (properties[k] == null || properties[k] === '') && delete properties[k]);

    els.assetCreate.disabled = true;
    try {
      const res = await window.syncro.createAsset({ customerId: tk.customerId, name, assetTypeId, serial: c.serial, properties });
      if (res && res.ok) {
        closeAssetModal();
        toast(res.message || 'Asset created.');
      } else {
        toast((res && res.message) || 'Could not create asset.', 'error');
      }
    } catch (err) {
      toast('Asset error: ' + ((err && err.message) || err), 'error');
    } finally {
      els.assetCreate.disabled = false;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#infoStatus');
    els.statusText = $('#infoStatusText');
    els.error = $('#infoError');
    els.errorDetail = $('#infoErrorDetail');
    els.content = $('#infoContent');
    els.refresh = $('#infoRefresh');
    els.export = $('#infoExport');
    els.retry = $('#infoRetry');
    els.createAsset = $('#infoCreateAsset');
    els.assetModal = $('#assetModal');
    els.assetType = $('#assetType');
    els.assetName = $('#assetName');
    els.assetTarget = $('#assetTarget');
    els.assetCreate = $('#assetCreate');
    els.assetCancel = $('#assetCancel');
    if (!els.content) return;

    els.refresh && els.refresh.addEventListener('click', load);
    els.retry && els.retry.addEventListener('click', load);
    els.export && els.export.addEventListener('click', exportText);
    els.createAsset && els.createAsset.addEventListener('click', openAssetModal);
    els.assetCreate && els.assetCreate.addEventListener('click', doCreateAsset);
    els.assetCancel && els.assetCancel.addEventListener('click', closeAssetModal);
    els.assetModal &&
      els.assetModal.addEventListener('click', (e) => {
        if (e.target === els.assetModal) closeAssetModal();
      });

    if (window.inform && window.inform.onProgress) {
      window.inform.onProgress((msg) => {
        if (loading) els.statusText.textContent = 'Gathering: ' + msg + '…';
      });
    }

    // Auto-load the front page on startup.
    load();
  });
})();
