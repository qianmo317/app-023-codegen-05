// jsdom 冒烟：验证 Preview 渲染、条件变化立即重算、调整建议按钮可用、打印区同构。
// （CI 另有真浏览器 Playwright E2E；本地沙箱缺 chromium 系统库跑不了浏览器。）
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Preview } from '../src/pages/Preview';
import { newEmptyScore, scoreFromPattern, PATTERNS } from '../src/lib/factory';
import { saveScore } from '../src/lib/storage';
import type { Score } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

async function renderAndWait(node: React.ReactNode) {
  await act(async () => {
    createRoot(container).render(node);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60)); // 等 IndexedDB getScore
  });
}
const $ = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const setNumber = (id: string, value: string) =>
  act(async () => {
    const input = $(id) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
const click = (id: string) =>
  act(async () => {
    $(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  });

describe('Preview 冒烟', () => {
  it('渲染急急风：1 页、汇总与页码、标题存在', async () => {
    const s: Score = scoreFromPattern(PATTERNS.find((p) => p.name === '急急风')!);
    await saveScore(s);
    await renderAndWait(<Preview scoreId={s.id} />);
    expect($('preview-page')).not.toBeNull();
    expect($('pv-page-count')!.textContent).toContain('1');
    expect($('pv-header')!.textContent).toContain('急急风');
    expect($('pv-page-1')).not.toBeNull();
    expect(container.querySelectorAll('.pv-margin').length).toBe(1);
    expect(container.querySelectorAll('.pv-pages .pv-pageno').length).toBe(1);
    expect($('pv-ok')!.textContent).toContain('4');
    expect($('pv-dist-page-1')!.textContent).toContain('1–4');
  });

  it('每行 2 小节、16 小节 → 4 页（7 乐器行每页 2 系统），标题只在第 1 页', async () => {
    const s = newEmptyScore('冒烟', 4, 16);
    await saveScore(s);
    await renderAndWait(<Preview scoreId={s.id} />);
    expect($('pv-page-count')!.textContent).toContain('1');
    await setNumber('pv-maxbars', '2');
    expect($('pv-page-count')!.textContent).toContain('4');
    expect($('pv-dist-page-1')!.textContent).toContain('1–4');
    expect($('pv-dist-page-4')!.textContent).toContain('13–16');
    expect(container.querySelectorAll('[data-testid="pv-header"]').length).toBe(1);
    expect($('pv-page-2')!.textContent).not.toContain('冒烟');
  });

  it('切纵向 → 重算（页面属性切换、物理宽变化）', async () => {
    const s = newEmptyScore('冒烟纵向', 4, 24);
    await saveScore(s);
    await renderAndWait(<Preview scoreId={s.id} />);
    const widthBefore = ($('pv-width') as HTMLInputElement).value;
    await act(async () => {
      const sel = $('pv-orientation') as HTMLSelectElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(sel, 'portrait');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect($('preview-page')!.getAttribute('data-orientation')).toBe('portrait');
    expect(($('pv-width') as HTMLInputElement).value).not.toBe(widthBefore);
  });

  it('窄可用宽 → 告警面板出现，一键加宽后恢复', async () => {
    const s = newEmptyScore('冒烟窄宽', 4, 4);
    await saveScore(s);
    await renderAndWait(<Preview scoreId={s.id} />);
    expect($('pv-ok')).not.toBeNull();
    await setNumber('pv-width', '120');
    expect($('pv-warn-panel')).not.toBeNull();
    await click('pv-widen-all');
    expect($('pv-ok')).not.toBeNull();
  });

  it('偏长小节（基准 6 拍、每行 1 个名义槽 → 4 拍小节把行挤超宽）：出现建议，点独占一行', async () => {
    const s = newEmptyScore('冒烟偏长', 4, 8);
    await saveScore(s);
    await renderAndWait(<Preview scoreId={s.id} />);
    // 名义每小节 6 拍、每行 4 个 → 名义槽比 4 拍小节宽，正常不溢出；改每行 1 个且基准 6 拍：
    // 可用宽只够 1 个 6 拍槽，4 拍小节虽短于槽，但 1 行就 1 个小节 → 不会溢出。
    // 真正制造偏长：基准拍数调小（名义槽变窄）+ 每行多放，由窄宽触发。
    // 基准拍数调小会同时把「每行最多」重置为该基准的建议值，所以要最后再手改每行 8 个
    await setNumber('pv-bpb', '1'); // 名义 1 拍槽：4 拍小节宽出 3 拍 → 偏长
    await setNumber('pv-maxbars', '8'); // 一行 8 个 4 拍小节 → 必然溢出
    expect($('pv-warn-panel')).not.toBeNull();
    expect($('pv-advice-0')).not.toBeNull();
    expect(Number($('pv-solo-pages-0')!.textContent)).toBeGreaterThanOrEqual(1);
    expect(Number($('pv-widen-pages-0')!.textContent)).toBeGreaterThanOrEqual(1);
    await click('pv-solo-0');
    const firstSvg = $('pv-1-0')!;
    const barsInFirstRow = Array.from(firstSvg.querySelectorAll('[data-bar-index]')).map((g) =>
      (g as SVGGElement).dataset.barIndex,
    );
    expect(barsInFirstRow).toEqual(['0']); // 第 0 小节被强制独占第一行
    expect(firstSvg.querySelector('[data-testid^="pv-1-0-warn-"]')).not.toBeNull();
  });

  it('打印区页数与屏幕一致、打印按钮存在', async () => {
    const s = newEmptyScore('冒烟打印', 4, 16);
    await saveScore(s);
    await renderAndWait(<Preview scoreId={s.id} />);
    await setNumber('pv-maxbars', '2');
    expect($('pv-print-page-1')).not.toBeNull();
    expect($('pv-print-page-4')).not.toBeNull();
    expect($('pv-do-print')!.textContent).toContain('打印');
  });
});
