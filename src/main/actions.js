'use strict';

// Opens a small, fixed whitelist of macOS settings panes and built-in apps on
// request from a finding. The renderer can only ask for a known token - never
// an arbitrary command.

const { shell } = require('electron');
const { spawn } = require('node:child_process');
const os = require('node:os');

// macOS 13 (Darwin 22) replaced System Preferences with System Settings and
// renamed every pane, so each token carries both addresses.
const modern = () => (parseInt(String(os.release()).split('.')[0], 10) || 0) >= 22;
const PANES = {
  'software-update': ['x-apple.systempreferences:com.apple.Software-Update-Settings.extension', 'x-apple.systempreferences:com.apple.preferences.softwareupdate'],
  'storage-settings': ['x-apple.systempreferences:com.apple.settings.Storage', null],
  'login-items': ['x-apple.systempreferences:com.apple.LoginItems-Settings.extension', 'x-apple.systempreferences:com.apple.preferences.users'],
  'filevault': ['x-apple.systempreferences:com.apple.preference.security?FileVault', 'x-apple.systempreferences:com.apple.preference.security?FDE'],
  'firewall': ['x-apple.systempreferences:com.apple.Network-Settings.extension?Firewall', 'x-apple.systempreferences:com.apple.preference.security?Firewall'],
  'time-machine': ['x-apple.systempreferences:com.apple.Time-Machine-Settings.extension', 'x-apple.systempreferences:com.apple.prefs.backup'],
  'battery-settings': ['x-apple.systempreferences:com.apple.Battery-Settings.extension', 'x-apple.systempreferences:com.apple.preference.battery'],
  'privacy-security': ['x-apple.systempreferences:com.apple.preference.security', 'x-apple.systempreferences:com.apple.preference.security'],
  'network-settings': ['x-apple.systempreferences:com.apple.Network-Settings.extension', 'x-apple.systempreferences:com.apple.preference.network'],
  'bluetooth-settings': ['x-apple.systempreferences:com.apple.BluetoothSettings', 'x-apple.systempreferences:com.apple.preferences.Bluetooth'],
};
const APPS = {
  'activity-monitor': '/System/Applications/Utilities/Activity Monitor.app',
  'disk-utility': '/System/Applications/Utilities/Disk Utility.app',
  console: '/System/Applications/Utilities/Console.app',
  'system-information': '/System/Applications/Utilities/System Information.app',
  terminal: '/System/Applications/Utilities/Terminal.app',
};

function openWith(args) {
  try { spawn('/usr/bin/open', args, { detached: true, stdio: 'ignore' }).unref(); return true; } catch { return false; }
}

async function openToken(token) {
  if (PANES[token]) {
    const url = modern() ? PANES[token][0] : PANES[token][1];
    if (!url) return openWith(['-a', 'Storage Management']);
    await shell.openExternal(url);
    return true;
  }
  if (APPS[token]) return openWith([APPS[token]]);
  if (token === 'hosts-file') return openWith(['-a', 'TextEdit', '/etc/hosts']);
  if (token === 'diagnostic-reports') return openWith(['/Library/Logs/DiagnosticReports']);
  if (token === 'user-diagnostic-reports') return openWith([os.homedir() + '/Library/Logs/DiagnosticReports']);
  return false;
}

async function openUrl(url) {
  try {
    const u = new URL(String(url));
    // Only ever hand https/http links to the system browser (never file:, etc.).
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      await shell.openExternal(u.href);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

module.exports = { openToken, openUrl };
