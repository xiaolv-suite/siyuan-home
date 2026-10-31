> **Beta Note**: Lv Home is undergoing continuous and stable refinement. Community feedback and feature requests are welcome in QQ Group **871707735**.
> The current build **v0.5.188** is protected by 175 test suites (1,151 automated unit tests) and 5 strict quality gates, safe and ready for daily production use.

<div align="center">

# 🏠 Lv Home (小驴管家)
### 24/7 Family Life Butler & Expiry Reminder Hub in SiYuan Note

**Private Family Archive · Member-Centric Perspective · Fact-Derived Expiry Reminders · Closed-Loop Action Workflow**

[![CI](https://github.com/ai68298100/siyuan-home/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-home/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/version-v0.5.188-blue)](./CHANGELOG.md)
[![Tests](https://img.shields.io/badge/tests-1151%20passed-brightgreen)](./CHANGELOG.md)
[![License](https://img.shields.io/github/license/ai68298100/siyuan-home)](./LICENSE)

[⬇️ Download](https://github.com/ai68298100/siyuan-home/releases/latest) · [📖 Usage FAQ](./docs/FAQ.md) · [📖 Glossary](./docs/glossary.md) · [🗺 Roadmap](./ROADMAP.md) · [🌐 中文文档](./README.md)

*Local-First · Zero External Cloud Dependencies · Zero Telemetry · Data Stays Strictly in Your SiYuan Workspace*

</div>

---

## 💡 The Problem It Solves

**Lv Home is a family and life management operating system built right into SiYuan Note. It consolidates scattered certificates, prescription medicine expiration dates, vehicle energy consumption, asset depreciation, recurring subscriptions, and family member profiles into native, local, searchable databases. More importantly, it derives multi-stage expiry alerts automatically from objective facts, preventing critical deadlines from slipping through the cracks.**

Have you ever faced these scenarios:
- Passports, driver's licenses, or IDs expired unnoticed until the exact moment you needed to travel or complete government paperwork;
- Prescription medications expired before being finished, or duplicate purchases occurred due to messy storage;
- Vehicle annual inspections or insurance policies lapsed, leading to traffic fines;
- Auto-renewing software subscriptions or credit card annual fees silently charged for months without awareness;
- Elders' lunar birthdays were forgotten, or complex children's vaccination schedules were missed;
- Stored items could not be found, wasting time turning drawers upside down.

Lv Home does not ask you to record cumbersome daily journals. Instead, it relies on an automated **"Log once as fact ➔ System derives all reminders automatically"** loop to keep your household organized effortlessly.

---

## 🌟 Core Capabilities Overview

| Domain | Key Capabilities & Features | User Value |
|---|---|---|
| **🏠 Overview Dashboard** | Bento-style dark accent card, weekly pulse rhythm, family milestone achievements, fast member-perspective toggle | Instant grasp of urgent tasks upon opening each day; eliminate core risks at a glance |
| **⏰ Expiry Reminder Hub** | Dual-date model (objective deadline vs. subjective plan-date), list & calendar grid double views, multi-stage tiered warnings, saved named views, iCalendar (.ics) export & Markdown weekly digest | Total prevention of overdue tasks; agile day-of planning like Things 3; seamless syncing with phone calendars |
| **🗂️ 31 Life Ledgers** | Covering certificates, vehicles, health, insurance, medicine, assets, contracts, chores, and schooling; virtualized high-performance table, multi-column sorting, full-field search | Structured fact repository; attachment and invoice receipts; embeddable as native SiYuan attribute views in notes |
| **👥 Member Archive** | Family role tree (self, spouse, children, elders, pets), local avatar storage, solar & lunar birthday conversion, single-member record drill-down, vCard export | Drill down into all certificates, assets, vitals, and tasks per member without blind spots |
| **🔍 Spotlight Search** | Universal `Ctrl+K` hotkey launcher, preloaded pinyin fuzzy indexing, keyword `<mark>` highlighting, and keyboard navigation | Locate any household item, certificate number, or storage location in milliseconds |
| **⚡ Quick Capture** | Global `N` key trigger, natural language date parsing (e.g. "pick up health checkup tomorrow afternoon"), multi-line continuous capture | Capture thoughts and events immediately without breaking current reading or note-taking flow |
| **📍 Storage Location Index** | Cross-module item storage index with reverse search (e.g. search by "study", "master bedroom", "storage box", "garage") | Never turn drawers upside down again; locate any item instantly |
| **🛡️ Privacy & Safety** | Guest Mode masking sensitive financial numbers and IDs, family Emergency Card (blood type, allergies, contacts), safe Trash recovery | Safe presentation in public; fast response during emergencies; lossless recovery from accidental deletions |

---

## 🚀 First 3 Minutes: Quick Start Guide

Experience Lv Home's core loop of "Record fact ➔ System derives reminders" in 3 simple steps:

### Step 1: Install & Complete Onboarding
1. In SiYuan Note, open **Settings ➔ Marketplace ➔ Plugins**, search for **siyuan-home**, install and enable it;
2. Click the topbar 🏠 icon or press `Ctrl+Alt+H` to open the Lv Home panel;
3. Select your household setup in the onboarding wizard (e.g. Self, Spouse, Child). The system automatically creates your family profiles and initializes relevant modules.

### Step 2: Register Your First Certificate
1. Switch to the **Family Ledger** tab (shortcut `3`), and select **Certificates** from the module dropdown;
2. Click **＋ New Record** in the upper right corner, and select "ID Card" or "Passport";
3. Enter the certificate name, holder (choose the member created in step 1), document number, and expiry date, then click **Save**.

### Step 3: View the Auto-Generated Reminder Hub
1. Switch to the **Reminders** hub (shortcut `2`);
2. The newly added certificate is automatically placed into the reminder schedule: colored badges appear when approaching expiration;
3. Click to **Complete**, **Snooze 7 days**, or **Plan Today**. You can also click the copy button to format it as a native SiYuan task block (`* [ ] Task`) and paste it into your daily journal!

---

## 🖥️ Panel Anatomy & Structure

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Lv Home Screen Architecture                     │
├───────────────┬──────────────────┬─────────────────┬───────────────────┤
│ 🏠 Overview   │ ⏰ Reminders Hub │ 🗂️ Family Ledger│ 👥 Members        │
├───────────────┼──────────────────┼─────────────────┼───────────────────┤
│ · Bento Hero  │ · List & Calendar│ · 31 Modules    │ · Family Profiles │
│ · Fast Tools  │ · Dual-Date Model│ · Virtual Table │ · Solar/Lunar Bday│
│ · Next 7 Days │ · Tiered Alerts  │ · Pinyin Search │ · Member Drilldown│
│ · Recent Feed │ · Batch Actions  │ · Import/Export │ · vCard Export    │
└───────────────┴──────────────────┴─────────────────┴───────────────────┘
```

1. **🏠 Overview**: Family morning report and situation dashboard. Features a midnight-navy high-contrast hero card for urgent items, quick access to storage lookups, emergency cards, life resilience indexes, and weekly pulse rhythm.
2. **⏰ Expiry Reminder Hub**: Centralized schedule for all module expiration dates. Switch between list view and native calendar grid (month/week); decouple objective deadlines from today's plan dates; save custom filters as named views; export iCalendar (.ics) or Markdown digests.
3. **🗂️ Family Ledger**: Comprehensive structured data manager. 31 life categories backed by native SiYuan attribute views; comfortable/compact table densities; batch deletion with safe trash snapshot recovery; CSV bulk import/export.
4. **👥 Members**: Household profile center. Tracks blood types, emergency contacts, solar & lunar birthdays; click any card to inspect all certificates, insurance policies, and tasks belonging to that member.
5. **⚡ Quick Capture (`N`)**: Centered fast capture sheet for logging events or records without interrupting current workflows; includes natural language date parsing and Alt+K continuous flow.
6. **🔍 Spotlight Search (`Ctrl+K`)**: Universal life spotlight search with instant pinyin matching and direct document jumping.

---

## ⚙️ Settings Reference (Defaults & Impact)

Click the gear icon (⚙) in the topbar to configure Lv Home:

| Category | Option | Path | Default | Purpose & Behavioral Impact |
|---|---|---|---|---|
| **Modules** | Module Toggles | Settings ➔ Modules | 6 Core Modules Active | Toggle activation of the 31 modules. Disabling a module **only hides its entry and never deletes existing ledger data**. Re-enabling restores all records. |
| **Members** | Member Editor | Settings ➔ Members | Empty (Wizard generated) | Add, edit, or remove household members. Removing a member prompts for confirmation and only unbinds relations while preserving ledger rows. |
| **Reminders** | Daily Digest Hour | Settings ➔ Reminders ➔ Schedule | `8` (08:00) | Hour of the day when opening SiYuan posts the daily expiration summary toast. Supports one-click reset to default. |
| **Reminders** | Silent Hours | Settings ➔ Reminders ➔ Schedule | `22 → 8` (22:00 to 08:00) | No popup notifications will disturb the user during this period. Supports one-click reset to default. |
| **Reminders** | Custom Lead Days | Settings ➔ Reminders ➔ Lead Days | Built-in per rule (e.g. 30 days) | Override advance alert days per rule (e.g. license 90 days). Leaving an input blank restores module default. Includes a one-click button to reset all overrides. |
| **Reminders** | Webhook Push | Settings ➔ Reminders ➔ Webhook | Disabled (Empty URL) | Push daily summaries and overdue counts directly to your own self-hosted Bark or ntfy server without passing through any third party. |
| **Data & Migration** | Target Notebook | Settings ➔ Data ➔ Migration | Default (Auto-creates 「🏠 小驴管家」) | Destination notebook where native attribute view documents are created. Can be switched to any personal notebook. |
| **Data & Migration** | Settings Export & Import | Settings ➔ Data ➔ Migration | — | Export settings as a JSON file for backup or cross-device migration. Automatically creates a backup snapshot before importing. |
| **Data & Migration** | Safe Trash | Settings ➔ Data ➔ Trash | Holds up to 50 snapshots | Retains full row snapshots from single and batch deletions. Losslessly restore records to their ledgers; clear trash prompts for double confirmation. |
| **Data & Migration** | Demo Data | Settings ➔ Data ➔ Demo Data | — | Generate sanitized demo data to explore capabilities; provides a one-click clean button to remove demo rows without residue. |
| **About & Diagnostic** | Health Check & Rebuild | Settings ➔ About & Diagnostics | — | Scan attribute view integrity and repair missing schema columns; reset onboarding wizard. |

---

## ⌨️ Keyboard Shortcuts Reference

| Shortcut | Trigger Context | Description |
|---|---|---|
| `Ctrl+Alt+H` | Global (anywhere in SiYuan) | Open or focus the Lv Home main panel |
| `N` or `Alt+N` | While Lv Home is focused | Open the **⚡ Quick Capture** sheet |
| `Ctrl+K` | While Lv Home is focused | Open the **🔍 Spotlight Search** dialog |
| `1` / `2` / `3` / `4` | While Lv Home is focused | Switch screens: 1-Overview, 2-Reminders, 3-Ledger, 4-Members |
| `Esc` | Any modal / drawer open | Dismiss the topmost modal, release background scroll lock, and restore focus |
| `Enter` | Capture form / search input | Submit record / search (does not trigger during IME composition) |
| `Alt+K` | Inside Quick Capture sheet | Keep Context: saves the record and remains open for continuous entry |

---

## ❓ Frequently Asked Questions (FAQ)

### Q1: What happens if a database column is accidentally deleted in SiYuan?
**A**: Data remains intact thanks to Lv Home's **self-healing engine**. When missing columns are detected, a yellow alert bar appears at the top of the ledger table. Clicking **"Auto-fix Columns"** (or selecting "Rebuild all ledgers" in Settings) will automatically recreate missing columns and restore bindings in SiYuan.

### Q2: How can I recover an accidentally deleted ledger record?
**A**: Open **Settings ➔ Data & Migration ➔ Trash**. Lv Home saves complete snapshots of the last 50 deleted records (including all cell data). Click **"Restore"** on the target entry to write it back to your SiYuan database losslessly.

### Q3: Why didn't I receive an expiry popup notification?
**A**: Check the following:
1. Is current system time inside your configured **Silent Hours** (default 22:00 to 08:00)?
2. Is **"Today Silent"** activated for the day?
3. Is the relevant module enabled in Settings (disabled modules do not trigger scans)?

### Q4: How does multi-device synchronization (PC & Mobile) work?
**A**: Lv Home is built on SiYuan's native storage protocol and listens to WebSocket events. When SiYuan syncs data across devices, Lv Home receives `sync` and `dataChanges` events and runs a throttled refresh. Reminders and ledgers update seamlessly without restarting the plugin.

---

## 🔒 Data Location & Privacy Statement

- **Local-First & Data Sovereignty**:
  - Settings are saved in your workspace: `data/storage/petal/siyuan-home/settings.json`;
  - Runtime cache is stored in: `data/storage/petal/siyuan-home/hub-runtime.json`;
  - All ledger records live inside native SiYuan documents and attribute views in your notebooks.
- **Zero Telemetry & Offline Operation**:
  - The plugin contains **no author-owned cloud servers, external APIs, analytics, or telemetry code**;
  - All data remains strictly inside your local SiYuan workspace and is synchronized only via SiYuan's native end-to-end encryption.
  - The only external network call is the optional user-configured private Webhook URL (e.g. self-hosted Bark), which only transmits sanitized alert counts and titles directly to your endpoint.

---

## 📦 Compatibility & Installation

### Host Requirements
- **SiYuan Note**: `>= v3.8.4`
- **Supported OS**: Windows, macOS, Linux, Android, iOS, HarmonyOS, Docker Web.

### Installation Methods
- **Method 1: SiYuan Marketplace (Recommended)**
  Open SiYuan Note, navigate to **Settings ➔ Marketplace ➔ Plugins**, search for `siyuan-home` or `小驴管家`, and click Install.
- **Method 2: Offline Manual Installation**
  1. Download the latest `package.zip` from [GitHub Releases](https://github.com/ai68298100/siyuan-home/releases/latest);
  2. Unzip and rename the folder to `siyuan-home`;
  3. Move it to your SiYuan workspace plugins directory: `data/plugins/siyuan-home/`;
  4. Restart SiYuan Note and enable it under **Settings ➔ Plugins**.

---

## 📝 Changelog

### v0.5.188 (2026-10-31 · Current Version)
- **Fixed (Native SiYuan Document Materialization, Column Order & Cross-Panel Linkage)**:
  - Aligned the `data-av-id` and `data-node-id` (`dbRefs.avId`) on `<div data-type="NodeAttributeView">` via Kramdown IAL `{: id="${avIdSeed}"}` in `createAttributeView`, ensuring native SiYuan ledger documents in the notebook tree render all columns and rows directly inside Protyle;
  - Chained `previousKeyID` across `ensureColumns` and `addAttributeViewColumn` so columns in native SiYuan AttributeView tables appear in natural schema order after the `Primary Key` column instead of reversed;
  - Fixed `showTabDocs(docId, blockId)` to open the ledger document `docId` when `blockId` is a detached AV item ID (`isDetached: true`), and focus/highlight `blockId` when it is a bound document block;
  - Connected Overview Bento `Focus Today` card click to filter Reminders by 7-day/overdue scope, refreshed active ledgers upon Quick Capture shopping/snippet saves, added feedback toast on unchanged drawer saves, and right-aligned Member Editor action buttons on desktop.

<details>
<summary><b>View Historical Releases (v0.5.187 and earlier)</b></summary>

- **v0.5.187 (2026-10-31)**: Fixed Dark Mode button/pill contrast (`1.86:1` ➔ `9.8:1`), Vehicle Card quick Fuel/Charging dialog timing, inline `+/-` quantity steppers on `stock`/`medicine`/`shopping`, and end-to-end Guest Mode filtering & write protection.

- **v0.5.186 (2026-10-31)**: Added `scripts/e2e-isolated.mjs` cold-workspace Chrome e2e suite and fixed 8 production defects (Terser `booleans_as_integers`, Go empty-cell phantom overdue alerts, empty ledger `$effect` loop, onboarding member `avItemId` sync, certificate scalar fields, Quick Event Flow auto-close, Overview location search race, and Guest Mode reactivity).

- **v0.5.185 (2026-10-31)**: Unified cross-module ledger writes via `ledger-writer.ts`, aligned Quick Capture logs with drawers, streamlined UI shell, standardized 100% modal focus traps via `modal-shell.ts`, and inlined a zero-dependency ISO 18004 QR encoder.

- **v0.5.184 (2026-10-31)**: Fixed Terser `pure_getters` production reactivity freeze, trash runtime fingerprint persistence, adhoc memo snooze/mute handling, and completed dual recurrence anchors + Quick Add `*cycle` / priority / tag loop.

- **v0.5.183 (2026-10-30)**: Bento dark accent card, action/data dual-color separation, one-click reminder setting defaults restore, lossless batch delete snapshots, and bundle size optimization.
- **v0.5.182 (2026-10-29)**: `saveRuntime` exclusive lock against race conditions, midnight date normalization, expired medication critical alert, and mobile/ultrawide layout refinements.
- **v0.5.175 ~ v0.5.181 (2026-10-29)**: Modularized view models (`ledger-record-view-model`, `ledger-view-model`, `reminders-view-model`), `runtime-store`, and `plugin-entrypoints`.

See full history in [CHANGELOG.md](./CHANGELOG.md).

</details>

---

## 📄 License

Distributed under the **[MIT License](./LICENSE)**. Data sovereignty and control over your life archive always belong to you.
