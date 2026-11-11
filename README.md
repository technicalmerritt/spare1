# TM Toolset for Mac

The macOS edition of **TM Toolset**, the technician diagnostic suite by
**Technical Merritt Computer Services**. Built with [Electron](https://www.electronjs.org/)
and sharing its interface, theming, licensing and Syncro integration with the
[Windows edition](https://github.com/technicalmerritt/tm-toolset).

Where the Windows app runs PowerShell collectors, this one reads the same
information from macOS's own tools (`system_profiler`, `diskutil`, `ioreg`,
`pmset`, `launchctl`, the diagnostic reports and the unified log) and hands it
to the same screens.

## What works in 0.1

| Tab | On the Mac |
|---|---|
| Overview | Quick tiles for drives, battery, panics, extensions and network, plus the Health Passport |
| Issue Scanner | Mac rule set: macOS support status, pending updates, FileVault / SIP / Gatekeeper, disk space, SSD health, Time Machine, battery, memory pressure, thermal throttling, kernel panics, unsigned or leftover startup items, adware names, MDM and Activation Lock |
| Information | macOS, hardware, memory, graphics, disks, security, network, backup and installed apps; export to text; create a Syncro asset |
| Storage › Drive Health | SMART verdict for every drive; full NVMe / ATA health log when smartmontools is installed; read/write speed test |
| Battery | Maximum capacity, cycle count against the rated limit, macOS's own condition, temperature, charger |
| Startup Items | Launch agents, launch daemons and Open at Login items with signature checks; enable / disable |
| Crash Analysis | Kernel panics explained, apps that keep crashing, shutdown causes |
| Devices | USB, Thunderbolt, Bluetooth; third-party system and kernel extensions |
| Networking | Status and gotchas, internet speed test, ping quality, local device sweep |
| Apple Devices | iPhone / iPad over USB (needs libimobiledevice) |
| Shared with Windows | Theming and white-labelling, Syncro tickets, licensing and trial, Customer Report, Board Repair library, Industry News, Microsoft 365 feed, Tools, Activity Log, Feedback, Settings |

Not ported yet (hidden in this edition): Diagnose, Repairs, Debloat, Drivers,
BIOS / UEFI, Disk Tools, Backup & Clone, and the drive surface and
counterfeit-capacity tests.

## Run it on a Mac

Needs [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm start
```

Optional extras that unlock more data:

```bash
brew install smartmontools
```

```bash
brew install libimobiledevice
```

The first time you open Startup Items, macOS asks whether TM Toolset may
control System Events. That is how the Open at Login list is read. Declining
only hides those items.

## Check the collectors without the app

```bash
npm test
```

```bash
npm run collect -- --scan
```

`npm run collect -- --full` prints everything each collector read, which is
the most useful thing to attach to a bug report.

## Build the app

```bash
npm run dist
```

This produces a universal (Apple silicon + Intel) `.dmg` in `release/`.
Without an Apple Developer ID the build is unsigned: it runs on the Mac that
built it, but other Macs will block it until it is signed and notarised.

## Licensing

Same scheme as the Windows edition: a 14-day trial, then a per-user licence
verified offline. The embedded public key is the same, so a licence issued for
the Windows app also activates this one.

## Data & config

Settings live in `~/Library/Application Support/TM Toolset` (the app never
writes inside its own bundle). **Settings → Config** opens the folder.
