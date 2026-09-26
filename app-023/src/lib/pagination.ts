// 分页预演引擎 —— 纯函数：出谱之前先算清楚要几页纸。
// 给定纸张方向、页面可用宽度、每行最多小节数、每小节拍数，把整段排一遍：
// 总行数 → 分页 → 每页/每行放哪几个小节 → 哪些小节会挤出右边界 → 调整建议与新页数。
// 不碰 DOM，可直接单测（与 grid.ts 的约定一致：布局先写纯函数再接 UI）。
import type { Bar } from '../types';
import { barTicks } from './grid';

/** 屏幕像素换算：1mm = 96/25.4 px（CSS 标准） */
export const PX_PER_MM = 96 / 25.4;
export const mmToPx = (mm: number): number => mm * PX_PER_MM;
export const pxToMm = (px: number): number => px / PX_PER_MM;

export type Orientation = 'landscape' | 'portrait';

/** A4 物理尺寸（mm） */
export const PAGE_SIZE_MM: Record<Orientation, { w: number; h: number }> = {
  landscape: { w: 297, h: 210 },
  portrait: { w: 210, h: 297 },
};

/** 页面可用宽度常用预设（mm） */
export const USABLE_WIDTH_PRESETS_MM = [277, 190, 250, 180];

/** 版式常量（px）：与预演渲染保持一致，改动需同步 */
export const ROW_HEIGHT = 40; // 每行乐器行高
export const ROW_GAP = 18; // 相邻两行（系统）间距
export const BAR_GAP = 10; // 相邻小节间距（与 ScoreGrid 默认 barGap 一致）
export const LABEL_W = 64; // 左侧乐器名行标宽
export const BAR_NUM_H = 16; // 小节号行高
export const SYS_PAD = 14; // 系统内底部留白（与 ScoreGrid 一致）
export const HEADER_H = 80; // 首页标题 + 速度说明占位高（只出现在第一页）
export const VERT_MARGIN_MM = 10; // 上下页边距（mm）
export const MIN_PX_PER_TICK = 6; // 每格最小像素（再小字就挤在一起）
export const MAX_PX_PER_TICK = 14; // 每格最大像素（与打印视图一致）
export const MIN_GLYPH_SLOT_PX = 22; // 一个拟音字的最小占位（字 + 间距）

export interface PageInput {
  bars: Bar[];
  instrumentCount: number;
  orientation: Orientation;
  /** 页面可用宽度（内容区宽，mm） */
  usableWidthMm: number;
  /** 每行最多排几个小节（期望上限；放不下会自动提前换行并告警） */
  maxBarsPerRow: number;
  /** 每小节拍数；0 = 沿用谱面各小节自身的拍数 */
  beatsPerBar: number;
  /** 强制单独占一行的小节下标（「该小节单独占一行」调整项） */
  soloBars?: ReadonlySet<number>;
  /** 每行额外高度（如简谱对照行 26px） */
  extraRowH?: number;
}

export interface LayoutBar {
  barIndex: number;
  /** 小节内容宽（px） */
  w: number;
  /** 该小节是否被强制单独占一行 */
  solo: boolean;
  /** 即使独占一行也超出页面右边界（solo 拉伸除外） */
  overflow: boolean;
  /** 内容太密：按最小字宽也排不下 */
  dense: boolean;
}

export interface LayoutRow {
  rowIndex: number;
  bars: LayoutBar[];
  /** 该行实际使用的每格像素（solo 行会拉伸到整行宽） */
  pxPerTick: number;
  /** 该行网格内容宽（px） */
  width: number;
  /** 该行内有小节越出右边界 */
  overflow: boolean;
  /** 行内小节号列表（1 起，便于直接展示） */
  barNumbers: number[];
}

export interface LayoutPage {
  pageIndex: number;
  rows: LayoutRow[];
  barNumbers: number[];
}

export interface LayoutWarning {
  barIndex: number;
  kind: 'overflow' | 'dense';
  text: string;
}

export interface PageLayout {
  rows: LayoutRow[];
  pages: LayoutPage[];
  pageCount: number;
  /** 每行实际小节数 */
  barsPerRowUsed: number[];
  /** 会挤出页面右边界的小节下标 */
  overflowBars: number[];
  /** 内容太密的小节下标 */
  denseBars: number[];
  warnings: LayoutWarning[];
  /** 实际采用的每格像素 */
  pxPerTick: number;
  /** 系统（一行）高 px */
  sysH: number;
  /** 页面内容区高 px */
  contentH: number;
  /** 页面内容区宽 px（= 行标 + 网格区） */
  contentW: number;
  /** 网格区可用宽 px（= 可用宽度 − 行标） */
  gridW: number;
  /** 物理页宽/高 px（96dpi） */
  pageW: number;
  pageH: number;
  /** 左右页边距 px（由物理宽 − 可用宽度推出，上下固定 10mm） */
  marginX: number;
  marginY: number;
  /** 每小节拍数（0 = 沿用谱面） */
  beatsPerBar: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 小节内「发声格数」（含休止；空步不算）—— 用于判断内容是否太密 */
export function soundingSteps(bar: Bar): number {
  return bar.steps.filter((s) => s.rest || s.hits.length > 0).length;
}

/** 把整段按给定条件排一遍，算出分页结果 */
export function paginate(input: PageInput): PageLayout {
  const { bars, instrumentCount, orientation, usableWidthMm, maxBarsPerRow, beatsPerBar } = input;
  const soloBars = input.soloBars ?? new Set<number>();
  const phys = PAGE_SIZE_MM[orientation];
  const pageW = mmToPx(phys.w);
  const pageH = mmToPx(phys.h);
  const usableW = Math.max(mmToPx(usableWidthMm), LABEL_W + 40);
  const gridW = usableW - LABEL_W; // 网格区可用宽
  const contentW = usableW;
  const contentH = pageH - mmToPx(VERT_MARGIN_MM * 2);
  const marginX = Math.max(0, (pageW - usableW) / 2);
  const marginY = mmToPx(VERT_MARGIN_MM);
  const sysH = BAR_NUM_H + instrumentCount * ROW_HEIGHT + SYS_PAD + (input.extraRowH ?? 0);

  const bpbOf = (bar: Bar): number => (beatsPerBar > 0 ? beatsPerBar : bar.beatsPerBar);
  const maxTicks = bars.reduce((m, b) => Math.max(m, barTicks(bpbOf(b))), 1);

  // 每格像素：让「最宽的小节 × 每行期望数 + 小节间隙」尽量铺满网格区，夹在 6–14 之间
  const n = Math.max(1, maxBarsPerRow);
  const pxPerTick = clamp(
    Math.floor((gridW - (n - 1) * BAR_GAP) / (maxTicks * n)),
    MIN_PX_PER_TICK,
    MAX_PX_PER_TICK,
  );

  const barWidth = (bar: Bar): number => barTicks(bpbOf(bar)) * pxPerTick;

  // 逐小节判定：越界（独占一行也放不下）/ 太密（有字的格位窄于最小字宽）。
  // solo 行会拉伸到整行宽，密度按拉伸后的每格像素判断。
  const stretchedPptOf = (bar: Bar): number =>
    Math.max(pxPerTick, Math.floor(gridW / barTicks(bpbOf(bar))));
  const denseOf = (bar: Bar, effPpt: number): boolean =>
    bar.steps.some(
      (s) => (s.rest || s.hits.length > 0) && s.beats * effPpt < MIN_GLYPH_SLOT_PX,
    );

  // 分行：贪心填充，最多 maxBarsPerRow 个；放不下就提前换行
  const rows: LayoutRow[] = [];
  let cur: LayoutBar[] = [];
  let curW = 0;
  const flush = () => {
    if (cur.length === 0) return;
    const solo = cur.length === 1 && cur[0].solo;
    // solo 行拉伸到整行宽；普通行用统一 pxPerTick
    const rowPpt = solo ? Math.max(pxPerTick, Math.floor(gridW / barTicks(bpbOf(bars[cur[0].barIndex])))) : pxPerTick;
    const width = solo ? gridW : curW;
    rows.push({
      rowIndex: rows.length,
      bars: cur,
      pxPerTick: rowPpt,
      width,
      overflow: cur.some((b) => b.overflow),
      barNumbers: cur.map((b) => b.barIndex + 1),
    });
    cur = [];
    curW = 0;
  };

  bars.forEach((bar, bi) => {
    const w = barWidth(bar);
    const solo = soloBars.has(bi);
    // 越界：普通行小节宽超出右边界（solo 行会拉伸，不判越界；仍太密则在 dense 里提示）
    const overflow = !solo && w > gridW;
    const effPpt = solo ? stretchedPptOf(bar) : pxPerTick;
    const lb: LayoutBar = { barIndex: bi, w, solo, overflow, dense: denseOf(bar, effPpt) };
    if (solo) {
      flush();
      cur = [lb];
      curW = w;
      flush();
      return;
    }
    // 行间小节之间有 BAR_GAP 间隙
    const need = cur.length === 0 ? w : curW + BAR_GAP + w;
    if (cur.length > 0 && (cur.length >= maxBarsPerRow || need > gridW)) flush();
    cur.push(lb);
    curW = cur.length <= 1 ? w : curW + BAR_GAP + w;
  });
  flush();

  // 分页：贪心按行填充；第一页要留标题与速度说明（只出现在第一页）
  const pages: LayoutPage[] = [];
  let curRows: LayoutRow[] = [];
  let usedH = HEADER_H; // 第一页先占掉标题区
  const flushPage = () => {
    if (curRows.length === 0) return;
    pages.push({
      pageIndex: pages.length,
      rows: curRows,
      barNumbers: curRows.flatMap((r) => r.barNumbers),
    });
    curRows = [];
    usedH = 0;
  };
  for (const row of rows) {
    const needH = curRows.length === 0 ? sysH : sysH + ROW_GAP;
    if (curRows.length > 0 && usedH + needH > contentH) flushPage();
    curRows.push(row);
    usedH += needH;
  }
  flushPage();

  const overflowBars = rows.flatMap((r) => r.bars.filter((b) => b.overflow).map((b) => b.barIndex));
  const denseBars = rows.flatMap((r) => r.bars.filter((b) => b.dense).map((b) => b.barIndex));
  const warnings: LayoutWarning[] = [
    ...overflowBars.map((barIndex) => ({
      barIndex,
      kind: 'overflow' as const,
      text: `第 ${barIndex + 1} 小节偏长：独占一行仍超出页面右边界`,
    })),
    ...denseBars.map((barIndex) => ({
      barIndex,
      kind: 'dense' as const,
      text: `第 ${barIndex + 1} 小节内容太密：按当前每行可用宽度排不下`,
    })),
  ].sort((a, b) => a.barIndex - b.barIndex);

  return {
    rows,
    pages,
    pageCount: pages.length,
    barsPerRowUsed: rows.map((r) => r.bars.length),
    overflowBars,
    denseBars,
    warnings,
    pxPerTick,
    sysH,
    contentH,
    contentW,
    gridW,
    pageW,
    pageH,
    marginX,
    marginY,
    beatsPerBar,
  };
}

export interface WidthRemedy {
  usableWidthMm: number;
  orientation: Orientation;
  pageCount: number;
}

/**
 * 调整建议二：把每行可用宽度调大。
 * 在当前方向内找不到时，自动尝试另一种方向；都找不到（物理页宽不够）返回 null。
 */
export function suggestWiderWidth(input: PageInput): WidthRemedy | null {
  const tryOrientation = (orientation: Orientation): WidthRemedy | null => {
    const maxW = PAGE_SIZE_MM[orientation].w - 2; // 至少留 2mm 边
    const start = Math.ceil(input.usableWidthMm) + 1;
    for (let w = start; w <= maxW; w += 4) {
      const layout = paginate({ ...input, orientation, usableWidthMm: w });
      if (layout.warnings.length === 0) return { usableWidthMm: w, orientation, pageCount: layout.pageCount };
    }
    return null;
  };
  return tryOrientation(input.orientation) ?? tryOrientation(input.orientation === 'landscape' ? 'portrait' : 'landscape');
}
