import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Design System A11y & High-Contrast Contracts (Epoch 5)', () => {
  const scssPath = path.resolve(__dirname, '../../src/styles/design-system.scss');
  const indexPath = path.resolve(__dirname, '../../src/index.scss');
  const scssContent = fs.readFileSync(scssPath, 'utf8');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  it('declares forced-colors: active block with system color mappings', () => {
    expect(scssContent).toContain('@media (forced-colors: active)');
    expect(scssContent).toMatch(/--lv-accent:\s*Highlight;/);
    expect(scssContent).toMatch(/--lv-accent-contrast:\s*HighlightText;/);
    expect(scssContent).toMatch(/--lv-border:\s*CanvasText;/);
    expect(scssContent).toMatch(/--lv-line:\s*CanvasText;/);
    expect(scssContent).toMatch(/--lv-surface:\s*Canvas;/);
    expect(scssContent).toMatch(/--lv-canvas:\s*Canvas;/);
    expect(scssContent).toMatch(/--lv-tx:\s*CanvasText;/);
    expect(scssContent).toMatch(/--b3-theme-primary:\s*Highlight;/);
    expect(scssContent).toMatch(/--b3-theme-on-primary:\s*HighlightText;/);
    expect(scssContent).toMatch(/--b3-theme-background:\s*Canvas;/);
    expect(scssContent).toMatch(/--b3-border-color:\s*CanvasText;/);
  });

  it('declares card and workspace panel 1px CanvasText borders under forced-colors', () => {
    expect(scssContent).toMatch(/\.lv-card,\s*\.lv-mod,\s*\.lv-chip/);
    expect(scssContent).toMatch(/\.lv-tabbar,\s*\.lv-hero/);
    expect(scssContent).toMatch(/border:\s*1px\s+solid\s+CanvasText;/);
  });

  it('declares modal sheets, drawers, and body dialogs 2px CanvasText border and Canvas background', () => {
    expect(scssContent).toMatch(/\.lv-modal\s+\.lv-sheet,\s*\.lv-drawer\s*\{[^}]*border:\s*2px\s+solid\s+CanvasText;\s*background:\s*Canvas;/);
    expect(indexContent).toMatch(/\.b3-dialog__container\s*\{[^}]*border:\s*2px\s+solid\s+CanvasText\s*!important;\s*background:\s*Canvas\s*!important;/);
  });

  it('maps primary buttons and active navigation to Highlight and HighlightText', () => {
    expect(scssContent).toMatch(/\.lv-btn\.primary,\s*\.b3-button--primary,\s*\.lv-hero-open\s*\{[^}]*background:\s*Highlight\s*!important;\s*color:\s*HighlightText\s*!important;/);
    expect(scssContent).toMatch(/\.lv-tabs__item\.is-active,\s*\.lv-tabs__item\[aria-selected="true"\]/);
    expect(scssContent).toMatch(/outline:\s*2px\s+solid\s+Highlight\s*!important;/);
  });

  it('enforces accessible focus-visible rings with outline-color and offset', () => {
    expect(scssContent).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+Highlight\s*!important;\s*outline-color:\s*Highlight\s*!important;\s*outline-offset:\s*2px;/);
  });

  it('preserves visual indicators and state affordances with forced-color-adjust: none', () => {
    expect(scssContent).toMatch(/\.lv-avatar,\s*\.lv-miniava,\s*\.lv-mi,\s*\.lv-focus-icon/);
    expect(scssContent).toMatch(/input\[type="checkbox"\]\.b3-switch/);
    expect(scssContent).toMatch(/svg\s*\{[^}]*forced-color-adjust:\s*none;/);
  });

  it('declares prefers-contrast: more block with enhanced borders and focus outlines', () => {
    expect(scssContent).toContain('@media (prefers-contrast: more)');
    expect(scssContent).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px\s+solid\s+var\(--b3-theme-primary\);/);
    expect(scssContent).toMatch(/\.lv-tabs__item\.is-active,\s*\.lv-tabs__item\.on/);
  });

  it('declares prefers-reduced-motion: reduce block for motion sensitivity', () => {
    expect(scssContent).toContain('@media (prefers-reduced-motion: reduce)');
    expect(scssContent).toMatch(/animation:\s*none\s*!important/);
  });

  it('preserves essential container query breakpoints for mobile & split panes', () => {
    expect(scssContent).toContain('@container lv-home (max-width: 760px)');
    expect(scssContent).toContain('@container lv-home (max-width: 640px)');
    expect(scssContent).toContain('@container lv-home (max-width: 400px)');
  });

  it('tab-panel 顶栏主页签左右两侧具备对称弹性占位，实现完美水平居中', () => {
    const tabPanelPath = path.resolve(__dirname, '../../src/panels/tab-panel.svelte');
    const tabPanelContent = fs.readFileSync(tabPanelPath, 'utf8');
    // 品牌区与 tabs 之间有 fn__flex-1 弹性占位，tabs 与右侧 actions 之间也有 fn__flex-1
    expect(tabPanelContent).toMatch(/<\/div>\s*<span class="fn__flex-1"[^>]*><\/span>\s*<div class="lv-tabs"/);
    expect(tabPanelContent).toMatch(/<\/div>\s*<span class="fn__flex-1"><\/span>\s*<!--/);
  });

  it('交互控件声明 touch-action: manipulation 消除触控设备 300ms 点击延迟', () => {
    expect(scssContent).toMatch(/touch-action:\s*manipulation;/);
  });

  it('UI_ICON_PATHS 全部矢量图标均声明有效非空路径', async () => {
    const { UI_ICON_PATHS } = await import('@/ui/icons');
    for (const [name, pathStr] of Object.entries(UI_ICON_PATHS)) {
      expect(typeof pathStr, `icon ${name} 路径须为 string`).toBe('string');
      expect(pathStr.length, `icon ${name} 路径非空`).toBeGreaterThan(5);
    }
  });

  it('触屏设备 (@media (hover: none)) 下关键可交互控件满足 44px 最小触控目标规范', () => {
    expect(scssContent).toContain('@media (hover: none)');
    expect(scssContent).toMatch(/\.lv-setnav__item\s*\{[^}]*min-height:\s*44px;/);
    expect(scssContent).toMatch(/\.lv-event-subbtn,\s*\.lv-capture-mode-btn\s*\{[^}]*min-height:\s*44px;/);
    expect(scssContent).toMatch(/\.lv-settings__footer\s*:is\(\.b3-button,\s*\.lv-btn\)\s*\{[^}]*min-height:\s*44px;/);
    expect(scssContent).toMatch(/\.lv-batch-bar\s*\.b3-button\s*\{[^}]*min-height:\s*44px;/);
    expect(scssContent).toMatch(/\.lv-activity-footer\s*\.lv-iconbtn,\s*\.lv-tabbar-actions\s*\.lv-iconbtn\s*\{[^}]*width:\s*44px;\s*height:\s*44px;/);
  });

  it('index.scss 声明设置页与容器 640px / 400px 响应式断点', () => {
    expect(indexContent).toContain('@container lv-home (max-width: 640px)');
    expect(indexContent).toContain('@container lv-home (max-width: 400px)');
  });

  it('主视图与交互面板按钮消除操作系统依赖的字符 Emoji 与符号 (+, ＋, ✕, ↺, ●)', () => {
    const filesToCheck = [
      '../../src/panels/settings.svelte',
      '../../src/panels/settings-reminders-tab.svelte',
      '../../src/panels/quick-event-flow.svelte',
      '../../src/panels/screens/ledger-toolbar.svelte',
      '../../src/panels/screens/overview-upcoming-list.svelte',
      '../../src/panels/screens/calendar.svelte',
      '../../src/panels/screens/reminder-controls-bar.svelte',
      '../../src/panels/screens/members.svelte',
      '../../src/core/drawer-domain-sections.ts',
      '../../src/core/growth-dialog.ts',
      '../../src/core/emergency-card-dialog.ts',
      '../../src/core/ledger-detail-drawer.ts',
      '../../src/core/location-dialog.ts',
      '../../src/core/life-index.ts',
      '../../src/core/media.ts',
    ];

    for (const rel of filesToCheck) {
      const fullPath = path.resolve(__dirname, rel);
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content).not.toMatch(/>\s*●\s*\{/);
      expect(content).not.toMatch(/>\s*↺\s*\{/);
      expect(content).not.toMatch(/>\s*＋\s*\{/);
      expect(content).not.toMatch(/>\s*✕\s*</);
      expect(content).not.toMatch(/>\s*×\s*</);
      expect(content).not.toMatch(/>\s*[＋+]\s*\{t\(/);
      expect(content).not.toMatch(/textContent\s*=\s*`[＋+]/);
      expect(content).not.toMatch(/textContent\s*=\s*`\${t\("ledger\.openDoc"\)}\s*→`/);
      expect(content).not.toMatch(/innerHTML\s*=\s*`<span[^>]*>[✔] /);
      expect(content).not.toMatch(/innerHTML\s*=.*[★]/);
    }
  });

  it('核心专业分析模态框接入 bindDialogA11y 实现焦点与 Escape 逃生路线闭环', () => {
    const dialogFiles = [
      '../../src/core/spotlight-dialog.ts',
      '../../src/core/location-dialog.ts',
      '../../src/core/favors-dialog.ts',
      '../../src/core/emergency-card-dialog.ts',
      '../../src/core/life-index.ts',
      '../../src/core/media.ts',
      '../../src/core/bind-dialog.ts',
      '../../src/core/batch-dialog.ts',
      '../../src/core/waste-dialog.ts',
      '../../src/core/subscriptions.ts',
      '../../src/core/utility-tiers.ts',
      '../../src/core/valuation.ts',
      '../../src/core/store-dialog.ts',
      '../../src/core/meal-plan.ts',
      '../../src/core/medicine-dosing.ts',
      '../../src/core/emergency-kit.ts',
      '../../src/core/member-timeline.ts',
      '../../src/core/rewards-dialog.ts',
      '../../src/core/sharecard-dialog.ts',
      '../../src/core/ledger-detail-drawer.ts',
    ];

    for (const rel of dialogFiles) {
      const fullPath = path.resolve(__dirname, rel);
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content).toContain('bindDialogA11y');
    }
  });
});
