import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * IME 合成期守卫契约（R18 全生态专项 / R19 固化为回归保护）：
 * 输入框挂载的 Enter/Escape/Arrow 键盘流必须在 isComposing || keyCode === 229 时
 * 整体让路给输入法，防止拼音候选确认键被误判为提交/导航。
 */
describe('IME Input Guard Contracts (R18/R19)', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
  const guard = /(?:e|event)\.isComposing\s*\|\|\s*(?:e|event)\.keyCode === 229/g;
  const count = (src: string) => (src.match(guard) || []).length;

  it('inline-edit: 行内编辑保存与 Escape 恢复在合成期让路', () => {
    expect(count(read('src/core/inline-edit.ts'))).toBe(1);
  });

  it('spotlight-dialog: 聚焦搜索的 ArrowDown/Enter 导航在合成期让路', () => {
    expect(count(read('src/core/spotlight-dialog.ts'))).toBe(1);
  });
});
