<div align="center">

# 🏠 Lv Home (小驴管家)

**A family archive that reminds you before things expire** — the family & life butler plugin for SiYuan notes.

[![CI](https://github.com/ai68298100/siyuan-home/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-home/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-home)](https://github.com/ai68298100/siyuan-home/releases/latest) [![License](https://img.shields.io/github/license/ai68298100/siyuan-home)](./LICENSE)

Family archive · unified expiry reminder hub · household workspace

**[⬇️ Download](https://github.com/ai68298100/siyuan-home/releases/latest)** · **[🗺 Roadmap](./ROADMAP.md)** · **[📖 中文文档](./README.md)**

*Local-first · No plugin-owned telemetry · Data stays in your SiYuan workspace*

</div>

---

## ✨ What it solves

Certificates expire, medicine expires, insurance needs renewal, subscriptions auto-charge, birthdays (lunar ones too) get forgotten, kids' vaccination schedules are complex… and this information is scattered across chats, notes and memory.

**Lv Home brings it all into SiYuan notes**: one family ledger + one reminder hub that reaches out to you.

| Capability | What it means |
|---|---|
| ⏰ **Unified expiry reminders** | Certificates, medicine, policies, subscriptions, inspections, birthdays (lunar supported) — all derived automatically, lead time configurable per type (passport 1 year, medicine 30 days), overdue shown in red on top |
| 👥 **Members as first-class citizens** | Self / spouse / partner / children / elders / kin — every ledger is organized per member, filter "everything about my son" in one click |
| 🗃 **31 life modules** | People & records · assets & shopping · daily living · parenting & school · travel · media (details below) |
| 📋 **Rich detail drawer** | Type-specific certificate fields (ID/passport/permits/licences/qualifications/degrees/titles), full ID-card number with GB 11643 validation (region/birth/checksum), gender & birthday auto-fill, masked display, record share card (copy as image / download PNG / copy as text), quick camera/photo/PDF upload, same-origin attachment preview/download, on-demand SiYuan OCR for image attachments, renewal history, replacement chains & timeline journals |
| 📈 **Growth charts (parenting)** | Height/weight timelines with official WHO reference bands (P3–P97, 0–13 weeks weekly + 0–60 months), percentile on hover |
| 🛒 **Smart lists** | Shopping suggestions from low stock (editable, copy-to-clipboard), media update reminders, reciprocation reminders for received gifts |
| 📊 **Check-in & exam integration** | Display study streaks and accuracy from 小驴考试, check-in strength summaries from 小驴打卡 |
| 📤 **Data portability** | CSV export per module + bulk CSV import (column-mapping wizard, all modules), calendar (.ics) & contacts (.vcf) export, sanitized diagnostics bundle, settings JSON export/import with auto-backup, sample data generator |
| 🔒 **Local-first** | Records live in your SiYuan workspace; the plugin has no author-owned server or telemetry. SiYuan sync, collaboration, backups and marketplace downloads remain host-controlled |
| 🔗 **Native databases** | Ledgers are SiYuan attribute-view databases inside a dedicated notebook — open any ledger doc to edit, link or embed it in daily notes ("mom's passport" inside your journal) |
| 🧩 **Modules on demand** | Disabled modules create no data and stay out of the UI; parenting/school only suggested when you have kids |
| 🔌 **Ecosystem ready** | Quick capture sheet (⚡ / `N`, schema-driven, auto-provision), statusbar badge with scan-health pulse, service bridge (`window.LvHome`), contacts picker via 小驴人脉 |

Image OCR uses the engine configured in SiYuan Settings → OCR. It runs only when requested and does not require automatic OCR to be enabled. AI OCR asks before each run because the image is sent to the selected AI service. Results are saved to SiYuan OCR text and included in search; re-running replaces the previous result. Encrypted notebook images and PDFs are not supported, and OCR text is never written into ledger fields automatically.

## 🆕 What's new in v0.5.102

This release eliminates the longstanding "row identity pending / empty ledger" issue at its architectural root:

- **Fixed (Explicit Client itemID in addDetachedRow)**: Injected explicit client-generated `itemID` into `/api/av/addAttributeViewBlocks` requests, eliminating guessing and race conditions during kernel row creation;
- **Extended (Retry Backoff & Fresh Idempotency Key)**: Expanded polling to 5 stepped backoff attempts (up to 3.5s) to honor desktop SQLite transaction latencies, and reset operation idempotency keys on retry to prevent stale cache reuse;
- **Healed (Missing Columns & Primary Key Aliasing)**: Added "主键" to `COMMON_COLUMN_ALIASES.name` to match SiYuan's native database primary key column, and auto-provisioned missing columns before writing;
- **Validation**: 91 test suites, **809 unit tests passing**, TypeScript, Svelte, i18n (1956 keys), metadata, and package smoke all green.
## 📦 Install (v0.5.102)

1. Download `package.zip` from [Releases](https://github.com/ai68298100/siyuan-home/releases/latest)
2. SiYuan → Settings → Marketplace → Download → **Import** the zip
3. Enable the plugin → complete the 2-step onboarding (household → module picks and provisioning)
4. Press `Ctrl+Alt+H` anytime to open the hub

> **Validation status:** core data paths have automated tests and isolated-kernel coverage. The v0.5.102 GitHub Release is available; Android WebView behavior remains host-specific validation. `icon.png` and `preview.png` were redesigned for v0.3.13 (brand-gradient tile + geometric mark; dark overview with sample data).
> **Version note:** the tagged v0.5.102 package is the current GitHub release; local quality checks report 809 unit tests.
>
> Family sharing depends on SiYuan's collaboration, permissions, sync and conflict behavior. Test with non-sensitive data before sharing; this plugin does not provide a separate permission system.
>
> Privacy & FAQ: [privacy statement](https://github.com/ai68298100/siyuan-home/blob/main/docs/privacy.md) · [FAQ](https://github.com/ai68298100/siyuan-home/blob/main/docs/FAQ.md)

## 🧩 Module Overview (6 groups, 31 modules)

<details open>
<summary><b>People & Records</b> — Members (always on) · Certificates · Medical Records · Social Security · Insurance · Certifications · Pets</summary>

Rule-based expiry reminders (passport 1y / license 90d / endorsements), checkups & vaccine book, retirement countdown, policy ledger, renewal cycles, pet deworming
</details>

<details open>
<summary><b>Assets & Shopping</b> — Physical Assets · Digital Assets · Shopping Log · Memberships · Contracts</summary>

Location hierarchy & warranty tracking, account assets with password-location index (never passwords), tracking numbers & pickup codes, prepaid balances, contract expiry
</details>

<details open>
<summary><b>Daily Living</b> — Medicine Cabinet · Stock & Pantry · Gift Ledger · Chores · Dining · Addresses · Bookmarks · Snippets · House & Schedule</summary>

Medicine expiry + stock, pantry low-stock, gift net-balance per person, recurring chores, recipes & dislikes, payment days & lunar anniversaries, emergency checklist
</details>

<details open>
<summary><b>Parenting & School</b> — Parenting · Schooling (K→college) · Allowance & Lucky Money</summary>

National immunization schedule (22 doses), growth records, school phases & milestones, tuition payments, multi-account allowance
</details>

<details open>
<summary><b>Travel & Vehicles</b> — Vehicles · Transit Cards · Trip Plans · Bookings · Packing Lists · Trip Journal</summary>

Vehicle profiles, separate refueling and charging logs, consumption and cost statistics. Fuel economy uses full-to-full intervals; charging consumption is an estimate across full-charge cycles, and incomplete data is labeled clearly. Also includes service/inspection/insurance/battery reminders, itinerary timeline, voucher archive and document self-check.
</details>

<details open>
<summary><b>Media Library</b> — Movies / TV / Variety / Books / Comics / Novels</summary>

Want/doing/done states, ratings & progress, source links
</details>

> 🧮 **Modules on demand**: all 31 modules are schema-driven — enabling one provisions its database and joins the reminder hub automatically. Full list in [MODULES.md](./MODULES.md).

## 🚫 Explicitly NOT doing

Full accounting · password vaults · official data integrations · real-time travel info · barcode wallets · telemedicine · media streaming

> Lv Home stays at the **ledger + reminders + archive** layer — professional tools do the rest.

## 🗺 Roadmap

The v0.5.1 release is available on GitHub, with static isolated-kernel gates and Chrome walkthrough coverage for the main UI, mobile layouts, accessibility, recovery paths and performance. The next feature slice should optimize the five-minute path from a member to a first reminder and its source record. Pinyin search, webhooks, QR labels, AI and family collaboration remain an observation pool until host capability and user evidence are available.

| Phase | Content |
|---|---|
| ✅ v0.5.102 (current) | Fix row identity pending & empty ledger, explicit itemID injection, primary key aliases, 809 tests |
| v0.5.101 | Overview & calendar day task block export, full screen task coverage, 809 tests |
| v0.5.100 | Batch copy task list, drawer task block copy, task manager bi-directional completion, 809 tests |
| v0.5.99 | SiYuan task block integration, task manager bridge getReminders, 808 tests |
| v0.5.98 | Direct plan date tag & badge interaction, scheduled handling shortcuts, 804 tests |
| v0.5.97 | Settings draft discard, dual-column sticky pinning in wide ledgers, 804 tests |
| v0.5.96 | Pinned ledger bar, draft switch guard, 279.77KB gzip bundle slimming, 804 tests |
| v0.5.95 | Calendar overdue day ring, settings instant module search, sticky first column, 804 tests |
| v0.5.94 | Ledger inline editing shortcuts, dynamic query match pill, 804 tests |
| v0.5.93 | Settings unsaved changes breathing indicator, configuration loss prevention, 804 tests |
| v0.5.92 | Member due alert direct expansion, calendar week view narrow adaptation, 804 tests |
| v0.5.91 | On-screen weekly pulse day filtering, Alt+K capture shortcut, 804 tests |
| v0.5.90 | Ledger toolbar responsive flow bugfix, member filter chip tactility, 804 tests |
| v0.5.89 | Direct ledger navigation from overview reminders, memo deletion warning, 804 tests |
| v0.5.88 | Module group accordion handle elevation, card hover lift, 804 tests |
| v0.5.87 | Nested confirm mask frosted glass, end-to-end workflow usability auditing, 804 tests |
| v0.5.86 | Color palette purification, elimination of color-mix impurities, 804 tests |
| v0.5.85 | System-wide semantic color palette, zero hardcoded theme color leaks, 804 tests |
| v0.5.84 | Page-by-page micro-refinements, vehicle hover elevation, retirement gradients |
| v0.5.83 | Onboarding role capsule tactility, activity stream badge refinement, 804 tests |
| v0.5.82 | Quick capture action footer alignment, button consistency, 804 tests |
| v0.5.81 | Unified hero header architecture, calendar bar card elevation, 804 tests |
| v0.5.80 | Empty state actionable guidance, auto-collapsing toolbar menu, 804 tests |
| v0.5.79 | All-surface Bento micro-interactions, AAA focus rings, modal button hierarchy |
| v0.5.78 | Glassmorphic modal scrim, obsidian pulse strip capsule, topbar elevation |
| v0.5.77 | Self-contained design system, complete decoupling from third-party themes |
| v0.5.76 | Modal styling deduplication across reminders & ledger, 804 tests |
| v0.5.75 | Drawer styling deduplication and bundle slimming, 804 tests |
| v0.5.74 | Universal modal Enter-key shortcuts, keyboard-first loop closure, 804 tests |
| v0.5.73 | Event stream Enter shortcuts, unrestricted draft discard, 804 tests |
| v0.5.72 | Ledger creator button lockup fix, draft reset ergonomics, 803 tests |
| v0.5.71 | Onboarding wizard and dashboard structural separation, 803 tests |
| v0.5.70 | Duplicate as new record dual-mode healing, auto-collapse more menu, 803 tests |
| v0.5.69 | Fix confirm dialog z-index inversion, row identity SQLite fallback, footer cutoff fix |
| v0.5.68 | Comprehensive example placeholders library across 31 modules, 802 tests |
| v0.5.67 | Quick-capture footer vertical text wrap fix, realistic example placeholders |
| v0.5.66 | Fix quick-capture vehicle stall, tabbar centering & pill alignment, hero whitespace compacting |
| v0.5.65 | Batch concurrency locks, cross-module rescan sync, 801 tests |
| v0.5.64 | Drawer styling deduplication, bundle size headroom, 801 tests |
| v0.5.63 | Memo Enter shortcuts, natural-language date parsing E2E, 801 tests |
| v0.5.62 | 800-test milestone, smart title date/amount extraction E2E |
| v0.5.61 | Quick-capture primary block fallback, E2E suite expanded to 799 tests |
| v0.5.60 | Member card menu contacts fallback, E2E suite expanded to 798 tests |
| v0.5.59 | Reminder value extraction decoupling, legacy storage E2E closure |
| v0.5.58 | E2E matrix expansion, legacy non-standard date healing, CSV header alignment |
| v0.5.57 | Eliminate blank data after entry, dual-mode cell unwrapping, vehicle column aliases |
| v0.5.56 | Ecosystem Integration Directive 100% compliance, iconLvHome mark closure |
| v0.5.55 | Native block focus & highlight on locate, toolbar interaction feedback closures |
| v0.5.54 | Network timeout recovery, detail drawer cell null-safety |
| v0.5.53 | Virtual scrolling jitter prevention, defensive cell access null-safety |
| v0.5.52 | CSV alias auto-alignment, Spotlight multi-dimension ranking, row log Enter shortcut |
| v0.5.51 | Stepper number parsing & rescan, invalid date NaN defense, table purity |
| v0.5.50 | Missing column perception & auto-repair, batch debounce protection, safe CSV export |
| v0.5.49 | Per-module instant repair, smart candidate document sensing, full cell data tolerance |
| v0.5.48 | Eliminate first-step provisioning failures, multi-level path self-healing, column alias compatibility |
| v0.5.47 | Dual-track contacts picker fallback, standalone stability, marketplace cadence |
| v0.5.46 | Ecosystem Integration Directive: 4 aliases, iconLvHome mark, mobile keyboard avoidance |
| v0.5.45 | Code stability review: global SQL injection sanitization, pre-registration cleanup |
| v0.5.44 | Multi-platform toolbar & status bar lifecycle closure, active ghost node convergence |
| v0.5.43 | Fix duplicate top bar icons after reload, active DOM deduplication, onunload cleanup |
| v0.5.42 | Deep SiYuan editor integration: Slash commands (/), block icon ingest, block embeds |
| v0.5.41 | Command Palette suite (8 commands), clean single top bar entry with right-click menu |
| v0.5.40 | Official lifecycle contract alignment, top bar context menu, URL scheme, AttributeView integration |
| v0.5.39 | Top bar & UI debounce hardening, native interactive doc card, block-level editor highlight |
| v0.5.38 | Official onDataChanged hook implementation, eliminate reload loops on wizard provisioning |
| v0.5.37 | Deep cross-scene UI craftsmanship: Spotlight keyboard navigation, inline steppers, 4px urgency rails |
| v0.5.36 | Deep prototype design alignment: Bento dual-temp cards, Weekly Pulse Strip, Achievements Badges |
| v0.5.35 | UI/UX deep refinement: vector icon migration, top bar micro-interactions, batch bar frosted glass |
| v0.5.34 | Break automatic reload loop, fix search button click, refactor overview stat card and settings sidebar |
| v0.5.33 | Eliminate repeated welcome popups, auto-heal onboarding status for existing users, eager state persistence |
| v0.5.32 | Fix quick capture confirmation dialog obstruction, elevate global Dialog z-index, native in-sheet confirmation |
| v0.5.31 | Fix browser Headers non-ISO-8859-1 exception that crashed document and notebook creation; GitHub Release published |
| v0.5.30 | Re-engineer provisioning pipeline (Issue #45 fix), guaranteed notebook activation, legacy ledger auto-adoption engine |
| v0.5.29 | Quick capture dual-mode routing (events vs ledger), Spotlight search (Ctrl+K), shortage to shopping ledger, bind existing docs |
| v0.5.28 | Fix Issue #39 settings save retry failure, default blank ledgers, top bar avatar alignment, quick templates, and batch management |
| 🔜 Next | Task workbench, evidence center, inbox, health recovery |
| 🔭 Later | Family collaboration, template packs, yearly family report, AI capabilities |

Full plan: [ROADMAP.md](./ROADMAP.md)

## 🤝 Ecosystem

Works with the Lv plugin family: **Check-in** (numeric tracking), **Contacts** (technicians/teachers/doctors), **Quick Switch** (bookmarks/snippets), **Web Clipper** (archiving).

## 🛠 Development

```bash
pnpm install
pnpm run dev      # dev (app + kernel watch)
pnpm run build    # dist/ + package.zip
pnpm run check    # 5-layer gate (types + svelte + i18n + meta + audit)
pnpm run smoke    # release package and single-file loader smoke checks
pnpm test         # unit tests (789)
```

- Setup & conventions: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Release quality: CI runs check/test/build/smoke/size-gate on every push & PR
- Regression checklist: [docs/testing/v0.2.md](./docs/testing/v0.2.md)
- Questions and bug reports: [SUPPORT.md](./SUPPORT.md) · Security reports: [SECURITY.md](./SECURITY.md)

## 📚 Documentation

| Category | Docs |
|---|---|
| Usage | [FAQ](https://github.com/ai68298100/siyuan-home/blob/main/docs/FAQ.md) · [Privacy](https://github.com/ai68298100/siyuan-home/blob/main/docs/privacy.md) · [Migration](https://github.com/ai68298100/siyuan-home/blob/main/docs/migration.md) · [Glossary](https://github.com/ai68298100/siyuan-home/blob/main/docs/glossary.en.md) |
| Design | [01 Architecture](./docs/design/01-架构总览.md) · [02 Data model](./docs/design/02-数据模型与模块规格.md) · [03 Reminder hub](./docs/design/03-提醒中枢.md) · [07 Visual language](./docs/design/07-视觉设计语言.md) · [Index](./docs/design/00-index.md) |
| Interactive prototype | [prototype/index.html](./prototype/index.html) (open in browser — dark/light themes, 7 screens incl. style guide) |

## License

[MIT](./LICENSE) · Third-party data & notices: [NOTICE.md](./NOTICE.md) (WHO Child Growth Standards, CC BY-NC 3.0 IGO)

<div align="center">

*Start with one certificate — let the hub remember, so you don't have to.*

</div>

---

### 🌐 中文

**小驴管家** —— 思源笔记的家庭与生活管家：31 个 schema 驱动的生活模块（证件/药品/保单/订阅/上学/旅行/影音…）、统一到期提醒中枢、按成员组织、本地优先零遥测。完整介绍见 [中文文档](./README.md)。
