// E2E —— 模拟真实用户点击：建谱 → 录入 → 试听 → 调速 → 持久化 → 打印 → 性能
import { expect, test, type Page } from '@playwright/test';

async function createEmptyScore(page: Page, title: string) {
  await page.goto('#/');
  await page.getByTestId('new-title').fill(title);
  await page.getByTestId('btn-create').click();
  await expect(page.getByTestId('editor-page')).toBeVisible();
}

test.describe('曲目列表', () => {
  test('新建空白谱进入编辑器', async ({ page }) => {
    await createEmptyScore(page, 'E2E 开道锣');
    await expect(page.getByTestId('score-title')).toHaveValue('E2E 开道锣');
    await expect(page.getByTestId('grid')).toBeVisible();
  });
});

test.describe('录入与齐奏', () => {
  test('点击格子 + 键盘落字 + 数字换时值 + 休止', async ({ page }) => {
    await createEmptyScore(page, 'E2E 录入');
    // 选中 0 小节 0 格，按 z → 鼓·咚（整拍）
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('z');
    await expect(page.getByTestId('grid-glyph-0-0-gu')).toBeVisible();
    // 光标自动前进到 4 格；按 2 切半拍，再按 a → 小锣·才 落在 4 格处
    await page.keyboard.press('2');
    await page.keyboard.type('a');
    await expect(page.getByTestId('grid-glyph-0-4-xiaoluo')).toBeVisible();
    // 0 休止
    await page.keyboard.press('0');
    await page.waitForTimeout(100);
    // 齐奏：回到 0 格，v → 大锣·哐 与 咚 同列
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('v');
    await expect(page.getByTestId('grid-glyph-0-0-daluo')).toBeVisible();
  });

  test('验收：齐奏多乐器落在同一列（x 坐标相同）', async ({ page }) => {
    await createEmptyScore(page, 'E2E 齐奏');
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('z'); // 鼓
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('v'); // 大锣
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('f'); // 钹
    const xs = await page.evaluate(() => {
      const out: number[] = [];
      for (const id of ['gu', 'daluo', 'bo']) {
        const el = document.querySelector(`[data-testid="grid-glyph-0-0-${id}"] text`) as SVGTextElement | null;
        const g = el?.closest('g') as SVGGElement | null;
        if (el) {
          const bb = (g ?? el).getBoundingClientRect();
          out.push(bb.x + bb.width / 2);
        }
      }
      return out;
    });
    expect(xs.length).toBe(3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1); // 同一列
  });
});

test.describe('曲牌库', () => {
  test('一键载入急急风并显示齐奏列', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await expect(page.getByTestId('score-title')).toHaveValue('急急风');
    await expect(page.getByTestId('grid-glyph-0-0-daluo')).toBeVisible(); // 哐
    await expect(page.getByTestId('grid-glyph-0-0-xiaoluo')).toBeVisible(); // 才
    await expect(page.getByTestId('grid-glyph-0-0-bo')).toBeVisible(); // 七
    await expect(page.locator('[data-testid="grid-bar-0"]')).toBeVisible();
  });

  test('载入收头（跨小节切分）后小节铺满', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-shutou').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    const bars = await page.locator('[data-testid^="grid-bar-"]').count();
    expect(bars).toBe(2);
  });
});

test.describe('试听', () => {
  test('播放 → 当前拍高亮 → 停止；+/− 调 BPM', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await page.getByTestId('btn-play').click();
    await expect(page.getByTestId('grid-highlight')).toBeVisible({ timeout: 3000 });
    await page.getByTestId('btn-play').click(); // 停止
    await expect(page.getByTestId('grid-highlight')).toHaveCount(0);

    const bpm0 = await page.getByTestId('bpm-value').textContent();
    await page.getByTestId('bpm-up').click();
    await page.getByTestId('bpm-up').click();
    const bpm1 = Number(await page.getByTestId('bpm-value').textContent());
    expect(bpm1).toBe(Number(bpm0) + 4);
    await page.getByTestId('bpm-down').click();
    expect(Number(await page.getByTestId('bpm-value').textContent())).toBe(Number(bpm0) + 2);
  });

  test('验收：调度时刻偏差 < 10ms（读取 __scheduled 钩子）', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await page.getByTestId('btn-play').click();
    // 等待调度器排入足够事件（ctx resume 完成后 lookahead 持续填窗）
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => (window as unknown as { __scheduled?: () => { time: number }[] }).__scheduled?.().length ?? 0,
          ),
        { timeout: 8000, intervals: [200] },
      )
      .toBeGreaterThan(10);
    const deltas = await page.evaluate(() => {
      const evs = (window as unknown as { __scheduled?: () => { time: number }[] }).__scheduled?.() ?? [];
      const uniq = [...new Set(evs.map((e) => e.time))].sort((a, b) => a - b);
      const per = 60 / 152 / 4; // 急急风 BPM 152 每格秒数
      const errs: number[] = [];
      for (let i = 1; i < uniq.length; i++) {
        const n = Math.round((uniq[i] - uniq[i - 1]) / per);
        errs.push(Math.abs(uniq[i] - uniq[i - 1] - n * per));
      }
      return errs;
    });
    expect(deltas.length).toBeGreaterThan(3);
    for (const e of deltas) expect(e).toBeLessThan(0.01); // < 10ms
    await page.getByTestId('btn-play').click();
  });

  test('独奏/静音切换', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await page.getByTestId('solo-daluo').click();
    await expect(page.getByTestId('solo-daluo')).toHaveClass(/on/);
    await page.getByTestId('mute-gu').click();
    await expect(page.getByTestId('mute-gu')).toHaveClass(/on/);
  });
});

test.describe('持久化', () => {
  test('刷新后曲目与谱面不丢（IndexedDB）', async ({ page }) => {
    await createEmptyScore(page, 'E2E 持久化');
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('z');
    await expect(page.getByTestId('grid-glyph-0-0-gu')).toBeVisible();
    await page.waitForTimeout(800); // 等自动保存
    await page.reload();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await expect(page.getByTestId('score-title')).toHaveValue('E2E 持久化');
    await expect(page.getByTestId('grid-glyph-0-0-gu')).toBeVisible();
  });

  test('曲目列表展示与删除', async ({ page }) => {
    await createEmptyScore(page, 'E2E 待删除');
    await page.goto('#/');
    const row = page.locator('tr', { hasText: 'E2E 待删除' });
    await expect(row).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await row.getByTestId(/del-sc_/).click();
    await expect(page.locator('tr', { hasText: 'E2E 待删除' })).toHaveCount(0);
  });
});

test.describe('打印', () => {
  test('打印视图：A4 横排、简谱对照开关、打印/PNG 按钮', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await page.getByTestId('btn-print').click();
    await expect(page.getByTestId('print-page')).toBeVisible();
    const bars = await page.locator('[data-testid^="print-bar-"]').count();
    expect(bars).toBe(4);
    // 4 个小节一行放下（SVG 宽度 ≤ A4 内容宽 1047 + 行标）
    const w = await page.evaluate(() => (document.querySelector('[data-testid="print"]') as SVGSVGElement).width.baseVal.value);
    expect(w).toBeLessThanOrEqual(1047 + 64 + 2);
    // 简谱对照
    await page.getByTestId('chk-jianpu').check();
    await expect(page.locator('[data-testid^="print-jianpu-"]').first()).toBeVisible();
    // window.print 被调用
    await page.evaluate(() => {
      (window as unknown as { print: () => void }).print = () => {
        (window as unknown as { __printed?: boolean }).__printed = true;
      };
    });
    await page.getByTestId('btn-do-print').click();
    expect(await page.evaluate(() => (window as unknown as { __printed?: boolean }).__printed)).toBe(true);
  });
});

test.describe('分页预演', () => {
  test('入口、页数汇总、页边页码、标题只在第一页', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await page.getByTestId('btn-preview').click();
    await expect(page.getByTestId('preview-page')).toBeVisible();
    // 急急风 4 个 2/4 小节：横向每行 16 → 1 行（系统较高但首屏可容纳）
    await expect(page.getByTestId('pv-page-count')).toContainText('1');
    // 页边与页码
    await expect(page.locator('.pv-margin')).toHaveCount(1);
    await expect(page.locator('.pv-pages .pv-pageno')).toContainText('1');
    // 标题与速度说明只出现在第一页
    await expect(page.getByTestId('pv-header')).toContainText('急急风');
    await expect(page.locator('.pv-header .pv-sub')).toContainText('152');
  });

  test('改任一条件立即重算：每行 2 小节 → 8 行 → 4 页，标题只在第 1 页', async ({ page }) => {
    await createEmptyScore(page, 'E2E 预演重算');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '+4 小节' }).click(); // 16 小节
    await page.waitForTimeout(500); // 等自动保存
    await page.getByTestId('btn-preview').click();
    await expect(page.getByTestId('preview-page')).toBeVisible();
    await expect(page.getByTestId('pv-page-count')).toContainText('1');
    // 每行改为 2 小节 → 8 行；7 乐器行时横向每页 2 行 → 4 页
    await page.getByTestId('pv-maxbars').fill('2');
    await expect(page.getByTestId('pv-page-count')).toContainText('4');
    await expect(page.locator('[data-testid^="pv-page-"]')).toHaveCount(4);
    // 每页放哪几个小节（每行 2、每页 2 行 = 每页 4 小节）
    await expect(page.getByTestId('pv-dist-page-1')).toContainText('1–4');
    await expect(page.getByTestId('pv-dist-page-4')).toContainText('13–16');
    // 标题区只在第一页
    await expect(page.getByTestId('pv-header')).toHaveCount(1);
    await expect(page.getByTestId('pv-page-2')).not.toContainText('E2E 预演重算');
  });

  test('切纵向：页数重算、可用宽输入生效', async ({ page }) => {
    await createEmptyScore(page, 'E2E 预演纵向');
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '+4 小节' }).click(); // 24 小节
    await page.waitForTimeout(500);
    await page.getByTestId('btn-preview').click();
    const widthBefore = await page.getByTestId('pv-width').inputValue();
    await page.getByTestId('pv-orientation').selectOption('portrait');
    await expect(page.getByTestId('preview-page')).toHaveAttribute('data-orientation', 'portrait');
    // 纵向默认可用宽（190mm）与横向（277mm）不同，输入框随之切换
    await expect(page.getByTestId('pv-width')).not.toHaveValue(widthBefore);
  });

  test('窄可用宽 → 超界告警 → 加宽解除，并给出调整后页数', async ({ page }) => {
    await createEmptyScore(page, 'E2E 超界');
    await page.waitForTimeout(500);
    await page.getByTestId('btn-preview').click();
    await expect(page.getByTestId('pv-ok')).toBeVisible();
    // 把可用宽压到最小 120mm → 行溢出
    await page.getByTestId('pv-width').fill('120');
    await expect(page.getByTestId('pv-warn-panel')).toBeVisible({ timeout: 3000 });
    expect(await page.locator('[data-overflow="true"]').count()).toBeGreaterThan(0);
    // 一键加宽
    await page.getByTestId('pv-widen-all').click();
    await expect(page.getByTestId('pv-ok')).toBeVisible({ timeout: 3000 });
  });

  test('偏长小节：给出「单独占一行」按钮及调整后页数，点击后该小节独占一行', async ({ page }) => {
    // 预览基准拍数调到 1（名义槽变窄），4 拍小节即偏长；每行 8 个 → 溢出
    await createEmptyScore(page, 'E2E 偏长');
    await page.waitForTimeout(500);
    await page.getByTestId('btn-preview').click();
    await expect(page.getByTestId('pv-ok')).toBeVisible();
    await page.getByTestId('pv-bpb').fill('1');
    await page.getByTestId('pv-maxbars').fill('8');
    await expect(page.getByTestId('pv-warn-panel')).toBeVisible({ timeout: 3000 });
    // 第 1 小节有建议与两种调整方案按钮
    await expect(page.getByTestId('pv-advice-0')).toBeVisible();
    const soloPages = Number(await page.getByTestId('pv-solo-pages-0').textContent());
    expect(soloPages).toBeGreaterThanOrEqual(1);
    // 点击「让它单独占一行」→ 第 0 小节独占第一行
    await page.getByTestId('pv-solo-0').click();
    const barGroups = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="pv-1-0"]');
      return g ? Array.from(g.querySelectorAll<SVGGElement>('[data-bar-index]')).map((x) => x.dataset.barIndex) : [];
    });
    expect(barGroups).toEqual(['0']);
    // 告警条标在偏长小节上
    await expect(page.locator('[data-testid^="pv-1-0-warn-"]').first()).toBeAttached();
  });

  test('打印预演结果：调用 window.print()，打印页含全部页码', async ({ page }) => {
    await createEmptyScore(page, 'E2E 预演打印');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '+4 小节' }).click(); // 16
    await page.waitForTimeout(500);
    await page.getByTestId('btn-preview').click();
    await page.getByTestId('pv-maxbars').fill('2'); // 4 页
    await expect(page.getByTestId('pv-page-count')).toContainText('4');
    await page.evaluate(() => {
      (window as unknown as { print: () => void }).print = () => {
        (window as unknown as { __printed?: boolean }).__printed = true;
      };
    });
    await page.getByTestId('pv-do-print').click();
    expect(await page.evaluate(() => (window as unknown as { __printed?: boolean }).__printed)).toBe(true);
    // 打印区四页都在（屏幕隐藏但在 DOM 中）
    await expect(page.getByTestId('pv-print-page-1')).toBeAttached();
    await expect(page.getByTestId('pv-print-page-4')).toBeAttached();
  });
});

test.describe('设置', () => {
  test('改键位并持久化', async ({ page }) => {
    await page.goto('#/settings');
    await page.getByTestId('rebind-z').click(); // 把 z（鼓·咚）改绑到 p
    await page.keyboard.press('p');
    await expect(page.getByTestId('rebind-msg')).toContainText('已绑定 p');
    await page.waitForTimeout(300); // 等 IndexedDB 落盘
    await page.reload();
    const row = page.locator('tr', { hasText: '咚' });
    await expect(row).toContainText('p');
  });
});

test.describe('性能', () => {
  test('验收：100 小节谱面滚动 ≥ 50fps', async ({ page }) => {
    await createEmptyScore(page, 'E2E 百小节');
    for (let i = 0; i < 24; i++) await page.getByRole('button', { name: '+4 小节' }).click(); // 4+96=100
    const bars = await page.locator('[data-testid^="grid-bar-"]').count();
    expect(bars).toBe(100);
    const fps = await page.evaluate(async () => {
      const scroller = document.querySelector('[data-testid="score-scroll"]') as HTMLElement;
      scroller.scrollLeft = 0;
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames += 1;
        scroller.scrollLeft = ((performance.now() - start) / 2000) * (scroller.scrollWidth - scroller.clientWidth);
        if (performance.now() - start < 2000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await new Promise((r) => setTimeout(r, 2100));
      return (frames / 2) * 1; // 帧/秒
    });
    console.log('滚动 fps =', fps);
    expect(fps).toBeGreaterThanOrEqual(50);
  });
});
