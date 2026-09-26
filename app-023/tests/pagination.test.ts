// 分页预演引擎用例 —— 页数 / 每页小节 / 每行小节 / 偏长小节 / 调整方案页数
import { describe, expect, it } from 'vitest';
import type { Bar, Step } from '../src/types';
import {
  A4,
  BAR_GAP_PX,
  LABEL_W_PX,
  PAGE_MARGIN_PX,
  barWidthPx,
  computePxPerTick,
  defaultMaxBarsPerRow,
  defaultUsableWidthPx,
  paginate,
  rowsCapacity,
  systemHeightPx,
} from '../src/lib/pagination';

const st = (beats: number): Step => ({ beats, hits: [] });
const bar = (beatsPerBar: number, index = 0): Bar => ({
  index,
  beatsPerBar,
  steps: Array.from({ length: beatsPerBar }, () => st(4)),
});
const bars = (n: number, bpb = 4): Bar[] => Array.from({ length: n }, (_, i) => bar(bpb, i));

describe('P1-P4 物理尺寸与字号', () => {
  it('P1 A4 横向物理宽 ≈ 1123px、纵向 ≈ 794px（96dpi）', () => {
    expect(A4.landscape.widthPx).toBe(1123);
    expect(A4.portrait.widthPx).toBe(794);
  });
  it('P2 默认可用宽 = 物理宽 - 2×10mm 页边', () => {
    expect(defaultUsableWidthPx('landscape')).toBe(1123 - PAGE_MARGIN_PX * 2);
  });
  it('P3 pxPerTick：名义 N 小节恰好排满设计宽（4/4、横、8 小节）', () => {
    const usable = defaultUsableWidthPx('landscape');
    const px = computePxPerTick(4, 8, usable);
    const total = LABEL_W_PX + 8 * 16 * px + BAR_GAP_PX * 7;
    expect(total).toBeLessThanOrEqual(usable);
    expect(px).toBeGreaterThanOrEqual(4);
  });
  it('P4 每行小节数加大 → pxPerTick 变小（被夹在 ≥4）', () => {
    const usable = defaultUsableWidthPx('landscape');
    const px8 = computePxPerTick(4, 8, usable);
    const px20 = computePxPerTick(4, 20, usable);
    expect(px20).toBeLessThan(px8);
    expect(px20).toBe(4);
  });
});

describe('P5-P9 行打包与页码', () => {
  it('P5 横向 4/4、每行 8 小节、20 小节 → 3 行（8/8/4）', () => {
    const r = paginate({ bars: bars(20, 4), beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3 });
    expect(r.rows.map((x) => x.bars.length)).toEqual([8, 8, 4]);
  });
  it('P6 每页小节：7 个乐器行时横向每页 2 个系统（首页扣除标题后仍为 2）', () => {
    const r = paginate({ bars: bars(40, 4), beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 7 });
    expect(r.rowsOnFirstPage).toBe(2);
    expect(r.rowsPerPage).toBe(2);
    // 40 小节 = 5 行；每页 2 行 16 小节 → 3 页（16/16/8）
    expect(r.pageCount).toBe(3);
    expect(r.pages[0].bars).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(r.pages[1].bars).toEqual(Array.from({ length: 16 }, (_, i) => i + 16));
    expect(r.pages[2].bars).toEqual(Array.from({ length: 8 }, (_, i) => i + 32));
  });
  it('P6b 内容不足一页时只有 1 页（不产生空白尾页）', () => {
    const r = paginate({ bars: bars(4, 4), beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3 });
    expect(r.rows.length).toBe(1);
    expect(r.pageCount).toBe(1);
    expect(r.pages[0].bars).toEqual([0, 1, 2, 3]);
  });
  it('P7 纵向页面更高 → 每页可放更多系统行；但每行更窄、总行数更多', () => {
    const land = paginate({ bars: bars(80, 4), beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 5, instrumentRows: 4 });
    const port = paginate({ bars: bars(80, 4), beatsPerBar: 4, orientation: 'portrait', maxBarsPerRow: 5, instrumentRows: 4 });
    expect(port.rowsPerPage).toBeGreaterThan(land.rowsPerPage); // A4 纵向更高
    expect(port.rows.length).toBe(land.rows.length); // 每行小节数相同 → 总行数相同
  });
  it('P8 系统高度随乐器行/简谱增加', () => {
    expect(systemHeightPx(3, false)).toBeLessThan(systemHeightPx(5, false));
    expect(systemHeightPx(3, false)).toBeLessThan(systemHeightPx(3, true));
  });
  it('P9 首页行数 = 扣除标题区后的容量', () => {
    const sysH = systemHeightPx(3, false);
    const usable = A4.landscape.heightPx - PAGE_MARGIN_PX * 2;
    expect(rowsCapacity(usable, sysH, true)).toBe(Math.floor((usable - 74) / sysH));
  });
});

describe('P10-P13 偏长小节与溢出', () => {
  it('P10 基准 4 拍、混入 8 拍小节 → 该小节标为偏长', () => {
    const mixed = [...bars(7, 4), bar(8, 7)];
    const r = paginate({ bars: mixed, beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3 });
    expect(r.longBarIndices).toContain(7);
    expect(r.rows[0].longBars).toContain(7);
  });
  it('P11 8 拍小节把第一行挤出右边界 → overflowRows 与 advices 命中', () => {
    const mixed = [...bars(7, 4), bar(8, 7)];
    const r = paginate({ bars: mixed, beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3 });
    expect(r.overflowRows.length).toBe(1);
    expect(r.advices.map((a) => a.barIndex)).toEqual([7]);
    expect(r.advices[0].overSlotPx).toBe((8 - 4) * 4 * r.pxPerTick); // 多出 4 拍 × 4 格
  });
  it('P12 调窄可用宽 → 原本正常的行也会溢出', () => {
    const r = paginate({
      bars: bars(8, 4),
      beatsPerBar: 4,
      orientation: 'landscape',
      maxBarsPerRow: 8,
      usableWidthPx: 500,
      instrumentRows: 3,
    });
    expect(r.overflowRows.length).toBe(1);
  });
  it('P13 建议的加宽宽 ≥ 该行实际宽，且加宽后无溢出', () => {
    const mixed = [...bars(7, 4), bar(8, 7)];
    const r = paginate({ bars: mixed, beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3 });
    const a = r.advices[0];
    expect(a.neededUsableWidthPx).toBeGreaterThanOrEqual(Math.ceil(r.rows[0].widthPx));
    const wide = paginate({
      bars: mixed,
      beatsPerBar: 4,
      orientation: 'landscape',
      maxBarsPerRow: 8,
      usableWidthPx: a.neededUsableWidthPx,
      instrumentRows: 3,
    });
    expect(wide.overflowRows.length).toBe(0);
  });
});

describe('P14-P17 调整方案页数', () => {
  it('P14 单独占一行：偏长小节被挪到新行，页数按新行数重算', () => {
    const mixed = [...bars(7, 4), bar(8, 7)]; // 原本 1 行
    const r = paginate({ bars: mixed, beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3 });
    const solo = paginate({
      bars: mixed,
      beatsPerBar: 4,
      orientation: 'landscape',
      maxBarsPerRow: 8,
      instrumentRows: 3,
      soloBarIndices: new Set([7]),
    });
    expect(solo.rows.map((x) => x.bars.length)).toEqual([7, 1]);
    expect(solo.pageCount).toBe(r.advices[0].soloPageCount);
  });
  it('P15 极端偏长小节单独成行仍宽于整页 → tooLongEvenSolo', () => {
    const huge = bar(24, 0); // 24 拍
    const r = paginate({ bars: [huge], beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 1, instrumentRows: 3 });
    expect(r.overflowRows.length).toBe(1);
    expect(r.advices[0].tooLongEvenSolo).toBe(true);
  });
  it('P16 加宽只解除溢出、不改行数 → widenedPageCount = 当前页数', () => {
    const mixed = [...bars(7, 4), bar(8, 7)];
    const r = paginate({ bars: mixed, beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3 });
    expect(r.advices[0].widenedPageCount).toBe(r.pageCount);
  });
  it('P17 足够多小节时单独占行会增加页数（16 小节恰好填满首页 4 行时插一个独占行）', () => {
    const mixed = [...bars(15, 4), bar(8, 15)];
    const r = paginate({ bars: mixed, beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 4, instrumentRows: 3 });
    const a = r.advices.find((x) => x.barIndex === 15)!;
    const solo = paginate({
      bars: mixed,
      beatsPerBar: 4,
      orientation: 'landscape',
      maxBarsPerRow: 4,
      instrumentRows: 3,
      soloBarIndices: new Set([15]),
    });
    expect(solo.pageCount).toBe(a.soloPageCount);
    expect(a.soloPageCount).toBeGreaterThanOrEqual(r.pageCount);
  });
});

describe('P18-P21 位置查询与边界', () => {
  it('P18 locationOf：小节 → 页码/页内行号（7 乐器行，每页 2 系统、每行 8 小节）', () => {
    const r = paginate({ bars: bars(40, 4), beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 7 });
    expect(r.locationOf(0)).toEqual({ page: 1, rowInPage: 0 });
    expect(r.locationOf(15)).toEqual({ page: 1, rowInPage: 1 });
    expect(r.locationOf(16)).toEqual({ page: 2, rowInPage: 0 });
    expect(r.locationOf(31)).toEqual({ page: 2, rowInPage: 1 });
    expect(r.locationOf(32)).toEqual({ page: 3, rowInPage: 0 });
    expect(r.locationOf(99)).toBeNull();
  });
  it('P19 空谱（0 小节）也给出 1 个空页', () => {
    const r = paginate({ bars: [], beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3 });
    expect(r.pageCount).toBe(1);
    expect(r.pages[0].bars).toEqual([]);
  });
  it('P20 默认每行小节数：横向多于纵向、2/4 多于 4/4', () => {
    expect(defaultMaxBarsPerRow('landscape', 2)).toBe(16);
    expect(defaultMaxBarsPerRow('portrait', 4)).toBeLessThan(defaultMaxBarsPerRow('landscape', 4));
    expect(defaultMaxBarsPerRow('landscape', 4)).toBeLessThan(defaultMaxBarsPerRow('landscape', 2));
  });
  it('P21 barWidthPx 与拍数线性、简谱开关不影响行宽只影响页数', () => {
    const w = barWidthPx(bar(2), 10);
    expect(w).toBe(80); // 2*4*10
    const noJp = paginate({ bars: bars(32, 4), beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3, showJianpu: false });
    const jp = paginate({ bars: bars(32, 4), beatsPerBar: 4, orientation: 'landscape', maxBarsPerRow: 8, instrumentRows: 3, showJianpu: true });
    expect(jp.systemHeightPx).toBeGreaterThan(noJp.systemHeightPx);
    expect(jp.rowsPerPage).toBeLessThanOrEqual(noJp.rowsPerPage);
  });
});
