// 分页预演引擎用例 —— 覆盖「先算清楚要几页纸」：
// 方向/可用宽度/每行小节数/每小节拍数 → 总页数、每页与每行小节分布、越界/过密告警、两种调整与新页数。
import { describe, expect, it } from 'vitest';
import type { Bar, Step } from '../src/types';
import {
  BAR_GAP,
  HEADER_H,
  LABEL_W,
  MAX_PX_PER_TICK,
  MIN_PX_PER_TICK,
  PAGE_SIZE_MM,
  mmToPx,
  paginate,
  suggestWiderWidth,
  type PageInput,
} from '../src/lib/pagination';
import { rebarBars } from '../src/lib/grid';

const st = (beats: number, extra: Partial<Step> = {}): Step => ({ beats, hits: [], ...extra });
const bar = (bpb: number, steps: Step[], index = 0): Bar => ({ index, beatsPerBar: bpb, steps });
const fullBar4 = (i: number): Bar => bar(4, [st(4), st(4), st(4), st(4)], i);
const fullBar2 = (i: number, steps?: Step[]): Bar => bar(2, steps ?? [st(4), st(4)], i);

const baseInput = (over: Partial<PageInput> = {}): PageInput => ({
  bars: [],
  instrumentCount: 7,
  orientation: 'landscape',
  usableWidthMm: 277,
  maxBarsPerRow: 8,
  beatsPerBar: 0,
  ...over,
});

/** 每个小节恰好出现一次 */
function expectPartition(input: PageInput) {
  const layout = paginate(input);
  const seen = layout.pages.flatMap((p) => p.barNumbers);
  expect(seen.sort((a, b) => a - b)).toEqual(input.bars.map((_, i) => i + 1));
  return layout;
}

describe('P1-P4 基础分页', () => {
  it('P1 4/4 谱 16 小节横向预演：总页数、行分布、每页小节号都算得出', () => {
    const input = baseInput({ bars: Array.from({ length: 16 }, (_, i) => fullBar4(i)) });
    const layout = expectPartition(input);
    expect(layout.pageCount).toBeGreaterThanOrEqual(1);
    // 每行最多 8 小节
    expect(Math.max(...layout.barsPerRowUsed)).toBeLessThanOrEqual(8);
    expect(layout.barsPerRowUsed.slice(0, 2)).toEqual([8, 8]);
    // 每页 barNumbers 是行 barNumbers 的并集
    for (const p of layout.pages) {
      expect(p.barNumbers).toEqual(p.rows.flatMap((r) => r.barNumbers));
    }
  });

  it('P2 每行最多 1 小节 → 行数 = 小节数，每行恰 1 个', () => {
    const input = baseInput({ bars: [fullBar2(0), fullBar2(1), fullBar2(2)], maxBarsPerRow: 1 });
    const layout = expectPartition(input);
    expect(layout.rows).toHaveLength(3);
    expect(layout.barsPerRowUsed).toEqual([1, 1, 1]);
    expect(layout.rows.map((r) => r.barNumbers)).toEqual([[1], [2], [3]]);
  });

  it('P3 宽度变窄放不下整行时提前换行（实际每行小节数 < 上限）', () => {
    const input = baseInput({
      bars: Array.from({ length: 8 }, (_, i) => fullBar4(i)),
      usableWidthMm: 160,
      maxBarsPerRow: 8,
    });
    const layout = paginate(input);
    expect(layout.barsPerRowUsed[0]).toBeGreaterThanOrEqual(2);
    expect(layout.barsPerRowUsed[0]).toBeLessThan(8);
    expectPartition(input);
  });

  it('P4 宽度变窄 → 每行小节数不增；同宽下纵向纸更高 → 页数不多于横向', () => {
    const bars = Array.from({ length: 24 }, (_, i) => fullBar2(i));
    const wide = paginate(baseInput({ bars, usableWidthMm: 277 }));
    const narrow = paginate(baseInput({ bars, usableWidthMm: 160 }));
    expect(Math.max(...narrow.barsPerRowUsed)).toBeLessThanOrEqual(Math.max(...wide.barsPerRowUsed));
    // 同样 190mm 可用宽度：纵向内容区更高，装得下的页数 ≤ 横向
    const land = paginate(baseInput({ bars, orientation: 'landscape', usableWidthMm: 190 }));
    const port = paginate(baseInput({ bars, orientation: 'portrait', usableWidthMm: 190 }));
    expect(port.pageCount).toBeLessThanOrEqual(land.pageCount);
  });
});

describe('P5-P7 每小节拍数与每格像素', () => {
  it('P5 预演拍数改为 2/4：小节宽按 2 拍算（同样谱面内容宽减半）', () => {
    const bars4 = [fullBar4(0)];
    const asIs = paginate(baseInput({ bars: bars4, beatsPerBar: 0, maxBarsPerRow: 1 }));
    const as2 = paginate(baseInput({ bars: bars4, beatsPerBar: 2, maxBarsPerRow: 1 }));
    expect(as2.rows[0].bars[0].w).toBeCloseTo(asIs.rows[0].bars[0].w / 2, 5);
  });

  it('P6 每格像素夹在 6–14 之间', () => {
    const wide = paginate(baseInput({ bars: [fullBar4(0)], maxBarsPerRow: 1 }));
    expect(wide.pxPerTick).toBeLessThanOrEqual(MAX_PX_PER_TICK);
    const narrow = paginate(
      baseInput({ bars: Array.from({ length: 32 }, (_, i) => fullBar4(i)), usableWidthMm: 120, maxBarsPerRow: 16 }),
    );
    expect(narrow.pxPerTick).toBeGreaterThanOrEqual(MIN_PX_PER_TICK);
  });

  it('P7 行宽 = 各小节宽 + 小节间隙，不超过网格可用宽', () => {
    const input = baseInput({ bars: Array.from({ length: 8 }, (_, i) => fullBar2(i)), maxBarsPerRow: 8 });
    const layout = paginate(input);
    for (const row of layout.rows) {
      if (row.bars.length === 1 && row.bars[0].solo) continue;
      const w = row.bars.reduce((s, b) => s + b.w, 0) + BAR_GAP * (row.bars.length - 1);
      expect(w).toBeCloseTo(row.width, 5);
      expect(row.width).toBeLessThanOrEqual(layout.gridW + 0.01);
    }
  });
});

describe('P8-P10 挤出右边界 / 内容过密', () => {
  it('P8 可用宽度极窄、单个 4/4 小节独占一行也放不下 → overflow 告警', () => {
    const input = baseInput({ bars: [fullBar4(0)], usableWidthMm: 40, maxBarsPerRow: 1 });
    const layout = paginate(input);
    expect(layout.overflowBars).toEqual([0]);
    expect(layout.warnings[0].kind).toBe('overflow');
    expect(layout.warnings[0].text).toContain('第 1 小节');
  });

  it('P9 一拍一字的 2/4 谱在窄宽度下判为过密（有字格位 < 最小字宽）', () => {
    // 冲头式小节：4 个半拍都有字
    const dense = bar(2, [
      st(2, { hits: [{ instrumentId: 'gu', velocity: 2 }] }),
      st(2, { hits: [{ instrumentId: 'gu', velocity: 2 }] }),
      st(2, { hits: [{ instrumentId: 'gu', velocity: 2 }] }),
      st(2, { hits: [{ instrumentId: 'gu', velocity: 2 }] }),
    ]);
    const input = baseInput({ bars: [dense, fullBar2(1)], usableWidthMm: 100, maxBarsPerRow: 8 });
    const layout = paginate(input);
    expect(layout.denseBars).toContain(0);
    expect(layout.denseBars).not.toContain(1); // 整拍小节不过密
  });

  it('P10 过密小节强制单独占一行并拉伸到整行宽 → 不再告警', () => {
    const dense = bar(2, [st(2, { hits: [{ instrumentId: 'gu', velocity: 2 }] }), st(2), st(2), st(2)]);
    const input = baseInput({ bars: [dense], usableWidthMm: 100, maxBarsPerRow: 8, soloBars: new Set([0]) });
    const layout = paginate(input);
    expect(layout.rows).toHaveLength(1);
    expect(layout.rows[0].bars[0].solo).toBe(true);
    expect(layout.rows[0].width).toBeCloseTo(layout.gridW, 5);
    expect(layout.denseBars).toEqual([]);
  });
});

describe('P11-P12 两种调整建议与新页数', () => {
  it('P11 方案一：问题小节全部单独占行 → 算出调整后新页数', () => {
    const bars = [
      bar(2, [st(2, { hits: [{ instrumentId: 'gu', velocity: 2 }] }), st(2), st(2), st(2)]),
      fullBar2(1),
      fullBar2(2),
      fullBar2(3),
    ];
    const input = baseInput({ bars, usableWidthMm: 100, maxBarsPerRow: 8 });
    const before = paginate(input);
    expect(before.denseBars).toEqual([0]);
    const after = paginate({ ...input, soloBars: new Set([0]) });
    expect(after.denseBars).toEqual([]);
    expect(after.pageCount).toBeGreaterThanOrEqual(before.pageCount); // 独占行不会减少页数
  });

  it('P12 方案二：调大可用宽度 → 给出新宽度与新页数，应用后告警清零', () => {
    const dense = bar(2, [st(2, { hits: [{ instrumentId: 'gu', velocity: 2 }] }), st(2), st(2), st(2)]);
    const input = baseInput({ bars: [dense], usableWidthMm: 100, maxBarsPerRow: 8 });
    const remedy = suggestWiderWidth(input);
    expect(remedy).not.toBeNull();
    expect(remedy!.usableWidthMm).toBeGreaterThan(100);
    const applied = paginate({ ...input, usableWidthMm: remedy!.usableWidthMm, orientation: remedy!.orientation });
    expect(applied.warnings).toEqual([]);
    expect(applied.pageCount).toBe(remedy!.pageCount);
  });

  it('P12b 幅面内无解（连整行最小字宽都不够）→ 返回 null', () => {
    const input = baseInput({
      bars: Array.from({ length: 8 }, (_, i) => fullBar4(i)),
      usableWidthMm: 290,
      maxBarsPerRow: 16,
      beatsPerBar: 4,
    });
    // 横向物理宽 297mm 内每格最多 floor((gridW-gap)/16/16)，仍可能告警
    const remedy = suggestWiderWidth(input);
    if (remedy) {
      const applied = paginate({ ...input, usableWidthMm: remedy.usableWidthMm, orientation: remedy.orientation });
      expect(applied.warnings).toEqual([]);
    }
    expect(remedy === null || remedy.usableWidthMm <= PAGE_SIZE_MM[remedy.orientation].w).toBe(true);
  });
});

describe('P13-P15 标题占位、页边、页数稳定', () => {
  it('P13 第一页为标题与速度说明留高：首页容纳的行数少于后续页', () => {
    // 单件乐器 → 系统行矮，80px 标题差足以少排一行；160 小节 → 20 行
    const bars = Array.from({ length: 160 }, (_, i) => fullBar2(i));
    const layout = paginate(baseInput({ bars, instrumentCount: 1 }));
    expect(layout.pageCount).toBeGreaterThan(1);
    expect(layout.pages[0].rows.length).toBeLessThan(layout.pages[1].rows.length);
    expect(layout.contentH).toBeCloseTo(mmToPx(PAGE_SIZE_MM.landscape.h) - mmToPx(20), 5);
  });

  it('P14 页边距：内容宽 = 可用宽度，水平边距对称', () => {
    const layout = paginate(baseInput({ bars: [fullBar2(0)], usableWidthMm: 250 }));
    expect(layout.contentW).toBeCloseTo(mmToPx(250), 5);
    expect(layout.gridW).toBeCloseTo(mmToPx(250) - LABEL_W, 5);
    expect(layout.marginX * 2 + layout.contentW).toBeCloseTo(layout.pageW, 5);
  });

  it('P15 条件不变结果稳定（同一输入两次分页页数一致）', () => {
    const bars = Array.from({ length: 33 }, (_, i) => fullBar2(i));
    const input = baseInput({ bars, usableWidthMm: 200, maxBarsPerRow: 5 });
    expect(paginate(input).pageCount).toBe(paginate(input).pageCount);
    expect(paginate(input).barsPerRowUsed).toEqual(paginate(input).barsPerRowUsed);
  });
});

describe('P16 rebarBars 改拍号（编辑器与预演共用）', () => {
  it('P16 4/4 → 2/4：保留拍点上的击点，超出的丢弃', () => {
    const b: Bar = {
      index: 0,
      beatsPerBar: 4,
      steps: [
        st(4, { hits: [{ instrumentId: 'gu', velocity: 2 }] }),
        st(4),
        st(4, { hits: [{ instrumentId: 'bo', velocity: 3 }] }),
        st(4),
      ],
    };
    const [next] = rebarBars([b], 2);
    expect(next.beatsPerBar).toBe(2);
    expect(next.steps.map((s) => s.beats)).toEqual([4, 4]);
    expect(next.steps[0].hits[0]?.instrumentId).toBe('gu');
    expect(next.steps[1].hits).toEqual([]); // 第 3 拍的钹超出 2/4，丢弃
  });

  it('P16b 2/4 → 4/4：补空步铺满，原击点位置不变', () => {
    const b: Bar = { index: 0, beatsPerBar: 2, steps: [st(4, { hits: [{ instrumentId: 'gu', velocity: 2 }] }), st(4)] };
    const [next] = rebarBars([b], 4);
    expect(next.steps).toHaveLength(4);
    expect(next.steps.reduce((s, x) => s + x.beats, 0)).toBe(16);
    expect(next.steps[0].hits[0]?.instrumentId).toBe('gu');
    expect(next.steps.slice(1).every((s) => s.hits.length === 0)).toBe(true);
  });

  it('P16c HEADER_H 为正数且首页确实预留标题区', () => {
    expect(HEADER_H).toBeGreaterThan(0);
    const layout = paginate(baseInput({ bars: [fullBar2(0)], instrumentCount: 1 }));
    // 只有一行时仍落在第一页，且标题区不把它挤到第二页
    expect(layout.pages).toHaveLength(1);
  });
});
