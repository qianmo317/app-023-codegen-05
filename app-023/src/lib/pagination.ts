// 分页预演引擎 —— 出谱之前先算清楚要几页纸。
// 纯函数：输入纸张方向、页面可用宽、每行最多小节数、每小节拍数等条件，
// 输出「总共几页 / 每页放哪几个小节 / 每行哪几个小节」，并标出挤出右边界的偏长小节。
// 另提供「单独占一行」与「加宽页面可用宽」两种调整方案的页数模拟。
//
// 单位约定（96dpi）：1mm = 96/25.4 px；A4 纵向 210×297mm、横向 297×210mm。
// 宽度换算与 grid.ts 的 pxPerTick 体系一致（每拍 TICKS_PER_BEAT 格）。
import type { Bar } from '../types';
import { barTicks } from './grid';

export type Orientation = 'portrait' | 'landscape';

// ---- 纸张物理尺寸（px @96dpi）----
const PX_PER_MM = 96 / 25.4;
export const A4 = {
  portrait: { widthPx: Math.round(210 * PX_PER_MM), heightPx: Math.round(297 * PX_PER_MM) },
  landscape: { widthPx: Math.round(297 * PX_PER_MM), heightPx: Math.round(210 * PX_PER_MM) },
} as const;

/** 打印页边距（mm → px） */
export const PAGE_MARGIN_MM = 10;
export const PAGE_MARGIN_PX = Math.round(PAGE_MARGIN_MM * PX_PER_MM);

export const BAR_GAP_PX = 8; // 小节之间间隙（与 ScoreGrid 默认值呼应）
export const LABEL_W_PX = 64; // 每行左侧乐器名宽（ScoreGrid labelW）
export const MIN_PX_PER_TICK = 4;
export const MAX_PX_PER_TICK = 16;

/** 一行「系统」（一个小节在所有乐器行上的总高度）相关高度参数 */
export const ROW_HEIGHT_PX = 40; // 每个乐器行高（与 Print 一致）
export const BAR_NUM_H_PX = 16; // 小节号高
export const ROW_BOTTOM_PX = 14; // 系统底部留白
export const FIRST_PAGE_HEADER_PX = 74; // 第一页标题 + 速度说明占用高度
export const JIANPU_H_PX = 26; // 简谱对照行高度

export interface PaginationInput {
  bars: Pick<Bar, 'beatsPerBar'>[];
  /** 预览时假定的「每小节几拍」（以拍号为基准宽度），默认取第一小节实际拍数 */
  beatsPerBar: number;
  orientation: Orientation;
  /** 每行最多排几个小节 */
  maxBarsPerRow: number;
  /** 页面可用宽度（px，边距以内）；不传则取该方向物理页减页边距 */
  usableWidthPx?: number;
  /** 参与排版的乐器行数（影响系统高度与每页行数） */
  instrumentRows: number;
  /** 是否显示简谱对照行（影响系统高度） */
  showJianpu?: boolean;
  /** 强制单独占一行的小节下标集合 */
  soloBarIndices?: Set<number>;
  /** 每行左侧乐器名宽，默认 LABEL_W_PX */
  labelWidthPx?: number;
}

export interface LaidRow {
  /** 行内小节下标 */
  bars: number[];
  /** 本行谱面实际宽度（含行标与小节间隙） */
  widthPx: number;
  /** 是否超出页面可用宽度（挤出右边界） */
  overflow: boolean;
  /** 本行里偏长（宽于名义小节槽）的小节下标 */
  longBars: number[];
  /** 本行超出可用宽的像素数（>0 即溢出） */
  overflowPx: number;
}

export interface LaidPage {
  /** 页码（从 1 开始） */
  pageNo: number;
  rows: LaidRow[];
  /** 本页小节下标集合 */
  bars: number[];
}

export interface BarFixAdvice {
  barIndex: number;
  /** 该小节宽度相对名义小节槽宽超出的像素数 */
  overSlotPx: number;
  /** 单独占一行后是否仍超出整页可用宽（真·放不下，加宽到纸张物理极限也救不回） */
  tooLongEvenSolo: boolean;
  /** 「单独占一行」调整后的总页数 */
  soloPageCount: number;
  /** 「加宽到所需可用宽」后总页数（加宽不改行数，页数通常不变，仅解除溢出） */
  widenedPageCount: number;
  /** 解除该小节所在行溢出所需的最小可用宽（px） */
  neededUsableWidthPx: number;
  /** 所需宽是否超出该方向纸张物理可用宽（超出则只能换纸/换方向） */
  exceedsPaper: boolean;
}

export interface PaginationResult {
  orientation: Orientation;
  /** 页面物理尺寸（px） */
  pageWidthPx: number;
  pageHeightPx: number;
  /** 实际采用的页面可用宽 */
  usableWidthPx: number;
  usableHeightPx: number;
  /** 该方向纸张物理极限可用宽 */
  maxPhysicalUsableWidthPx: number;
  /** 本套条件下采用的每格像素宽（按设计宽度 + 每行 N 小节反算，夹在 MIN..MAX） */
  pxPerTick: number;
  /** 每页可放的系统行数（第一页因标题区更少） */
  rowsOnFirstPage: number;
  rowsPerPage: number;
  /** 每个系统（行）的高度 */
  systemHeightPx: number;
  rows: LaidRow[];
  pages: LaidPage[];
  pageCount: number;
  /** 全部溢出的行（至少有一行挤出右边界） */
  overflowRows: LaidRow[];
  /** 全部偏长小节下标（宽于名义槽宽） */
  longBarIndices: number[];
  /** 给偏长小节的调整建议（仅对落在溢出行里的偏长小节给出） */
  advices: BarFixAdvice[];
  /** 小节下标 → { 页码(1 起), 行号(页内 0 起) } */
  locationOf: (barIndex: number) => { page: number; rowInPage: number } | null;
}

/** 某方向纸张默认可用宽（边距以内） */
export function defaultUsableWidthPx(orientation: Orientation): number {
  return A4[orientation].widthPx - PAGE_MARGIN_PX * 2;
}

/**
 * 按「名义每行 N 小节」反算每格像素宽。
 * 注意：以该方向的**设计可用宽**（物理默认宽）为基准，与用户临时调窄/调宽的
 * 可用宽无关 —— 这样「加宽」只改溢出判定、不会让字号跟着变大导致需求宽度漂移。
 */
export function computePxPerTick(
  beatsPerBar: number,
  maxBarsPerRow: number,
  designUsableWidthPx: number,
  labelWidthPx = LABEL_W_PX,
  barGapPx = BAR_GAP_PX,
): number {
  const n = Math.max(1, Math.floor(maxBarsPerRow));
  const budget = Math.max(50, designUsableWidthPx - labelWidthPx);
  // (bpb*TICKS*px)*n + gap*(n-1) = budget
  const raw = (budget - barGapPx * (n - 1)) / (n * barTicks(beatsPerBar));
  return Math.max(MIN_PX_PER_TICK, Math.min(MAX_PX_PER_TICK, Math.floor(raw)));
}

/** 单个小节的渲染宽度（px，不含间隙/行标） */
export function barWidthPx(bar: Pick<Bar, 'beatsPerBar'>, pxPerTick: number): number {
  return barTicks(bar.beatsPerBar) * pxPerTick;
}

/** 系统（一行小节，跨全部乐器行）高度 */
export function systemHeightPx(
  instrumentRows: number,
  showJianpu: boolean,
  rowHeight = ROW_HEIGHT_PX,
): number {
  return (
    BAR_NUM_H_PX +
    instrumentRows * rowHeight +
    ROW_BOTTOM_PX +
    (showJianpu ? JIANPU_H_PX : 0)
  );
}

/** 每页能容纳的系统行数（第一页扣除标题区；至少返回 1） */
export function rowsCapacity(usableHeightPx: number, sysH: number, firstPage = false): number {
  const avail = firstPage ? usableHeightPx - FIRST_PAGE_HEADER_PX : usableHeightPx;
  return Math.max(1, Math.floor(avail / sysH));
}

/** 按方向给出建议的每行最多小节数（纵向更窄，默认更少） */
export function defaultMaxBarsPerRow(orientation: Orientation, beatsPerBar: number): number {
  if (orientation === 'landscape') {
    if (beatsPerBar <= 2) return 16;
    if (beatsPerBar === 3) return 11;
    return 8;
  }
  if (beatsPerBar <= 2) return 10;
  if (beatsPerBar === 3) return 7;
  return 5;
}

interface PackOpts {
  pxPerTick: number;
  maxBarsPerRow: number;
  usableWidthPx: number;
  soloBarIndices: Set<number>;
  labelWidthPx: number;
  /** 名义小节槽宽（基准拍数 × 每格像素），超过它即算「偏长小节」 */
  nominalSlotW: number;
}

/** 行打包：每行最多 N 个小节；强制单独占一行的小节独占一行；标出溢出与偏长小节 */
function packRows(bars: PaginationInput['bars'], o: PackOpts): LaidRow[] {
  const rows: LaidRow[] = [];
  let cur: number[] = [];

  const rowWidth = (idxs: number[]) =>
    o.labelWidthPx +
    idxs.reduce((s, bi) => s + barWidthPx(bars[bi], o.pxPerTick), 0) +
    (idxs.length > 1 ? BAR_GAP_PX * (idxs.length - 1) : 0);

  const closeRow = (idxs: number[]) => {
    const w = rowWidth(idxs);
    const overflowPx = w - o.usableWidthPx;
    const longBars = idxs.filter((bi) => barWidthPx(bars[bi], o.pxPerTick) > o.nominalSlotW + 0.5);
    rows.push({
      bars: idxs,
      widthPx: w,
      overflow: overflowPx > 0.5,
      longBars,
      overflowPx: Math.max(0, overflowPx),
    });
  };

  bars.forEach((_, bi) => {
    const solo = o.soloBarIndices.has(bi);
    if (cur.length > 0 && (solo || cur.length >= o.maxBarsPerRow)) {
      closeRow(cur);
      cur = [];
    }
    cur.push(bi);
    if (solo) {
      closeRow(cur);
      cur = [];
    }
  });
  if (cur.length > 0) closeRow(cur);
  return rows;
}

/** 把行切分到页：第一页预留标题区，其后每页等容量；内容只到首个空页为止 */
function paginateRows(rows: LaidRow[], firstCap: number, cap: number): LaidPage[] {
  if (rows.length === 0) return [{ pageNo: 1, rows: [], bars: [] }];
  const pages: LaidPage[] = [];
  let pageNo = 1;
  let i = 0;
  while (i < rows.length) {
    const capacity = pageNo === 1 ? firstCap : cap;
    const slice = rows.slice(i, i + capacity);
    pages.push({ pageNo, rows: slice, bars: slice.flatMap((r) => r.bars) });
    i += capacity;
    pageNo += 1;
  }
  return pages;
}

interface CoreResult {
  rows: LaidRow[];
  pages: LaidPage[];
}

/** 不做建议推演的核心排版（供主入口与调整方案模拟共用，避免递归） */
function layoutCore(
  input: PaginationInput,
  overrides: { solo?: Set<number>; usableWidthPx?: number; pxPerTick?: number },
  dims: { pxPerTick: number; firstCap: number; cap: number; nominalSlotW: number },
): CoreResult {
  const rows = packRows(input.bars, {
    pxPerTick: overrides.pxPerTick ?? dims.pxPerTick,
    maxBarsPerRow: Math.max(1, Math.floor(input.maxBarsPerRow)),
    usableWidthPx: overrides.usableWidthPx ?? input.usableWidthPx ?? defaultUsableWidthPx(input.orientation),
    soloBarIndices: overrides.solo ?? input.soloBarIndices ?? new Set<number>(),
    labelWidthPx: input.labelWidthPx ?? LABEL_W_PX,
    nominalSlotW: dims.nominalSlotW,
  });
  return { rows, pages: paginateRows(rows, dims.firstCap, dims.cap) };
}

/** 主入口：按给定条件把整段谱排一遍 */
export function paginate(input: PaginationInput): PaginationResult {
  const page = A4[input.orientation];
  const maxPhysicalUsableWidthPx = defaultUsableWidthPx(input.orientation);
  const usableWidthPx = input.usableWidthPx ?? maxPhysicalUsableWidthPx;
  const usableHeightPx = page.heightPx - PAGE_MARGIN_PX * 2;
  const labelWidthPx = input.labelWidthPx ?? LABEL_W_PX;
  const solo = input.soloBarIndices ?? new Set<number>();

  // 字号以设计宽度（物理默认宽）为基准反算，不受可用宽临时调整影响
  const pxPerTick = computePxPerTick(input.beatsPerBar, input.maxBarsPerRow, maxPhysicalUsableWidthPx, labelWidthPx);
  const nominalSlotW = barTicks(input.beatsPerBar) * pxPerTick;
  const sysH = systemHeightPx(input.instrumentRows, input.showJianpu ?? false);
  const firstCap = rowsCapacity(usableHeightPx, sysH, true);
  const cap = rowsCapacity(usableHeightPx, sysH, false);
  const dims = { pxPerTick, firstCap, cap, nominalSlotW };

  const core = layoutCore(input, { solo, usableWidthPx }, dims);
  const { rows, pages } = core;

  const overflowRows = rows.filter((r) => r.overflow);
  const longBarSet = new Set<number>();
  rows.forEach((r) => r.longBars.forEach((bi) => longBarSet.add(bi)));
  const longBarIndices = [...longBarSet].sort((a, b) => a - b);

  // 仅对「落在溢出行里」的偏长小节给出调整建议
  const adviceTargets = new Set<number>();
  overflowRows.forEach((r) => r.longBars.forEach((bi) => adviceTargets.add(bi)));

  const advices: BarFixAdvice[] = [...adviceTargets]
    .sort((a, b) => a - b)
    .map((bi) => {
      // 方案一：该小节单独占一行
      const soloSet = new Set(solo);
      soloSet.add(bi);
      const soloCore = layoutCore(input, { solo: soloSet, usableWidthPx }, dims);

      // 方案二：加宽到「该行」实际所需的最小可用宽（字号不变）
      const ownerRow = rows.find((r) => r.bars.includes(bi))!;
      const needed = Math.ceil(ownerRow.widthPx);
      const wideCore = layoutCore(input, { solo, usableWidthPx: Math.max(usableWidthPx, needed) }, dims);

      const soloWidth = labelWidthPx + barWidthPx(input.bars[bi], pxPerTick);
      return {
        barIndex: bi,
        overSlotPx: barWidthPx(input.bars[bi], pxPerTick) - nominalSlotW,
        tooLongEvenSolo: soloWidth > maxPhysicalUsableWidthPx + 0.5,
        soloPageCount: soloCore.pages.length,
        widenedPageCount: wideCore.pages.length,
        neededUsableWidthPx: needed,
        exceedsPaper: needed > maxPhysicalUsableWidthPx + 0.5,
      };
    });

  const loc = new Map<number, { page: number; rowInPage: number }>();
  pages.forEach((p) => p.rows.forEach((r, ri) => r.bars.forEach((bi) => loc.set(bi, { page: p.pageNo, rowInPage: ri }))));

  return {
    orientation: input.orientation,
    pageWidthPx: page.widthPx,
    pageHeightPx: page.heightPx,
    usableWidthPx,
    usableHeightPx,
    maxPhysicalUsableWidthPx,
    pxPerTick,
    rowsOnFirstPage: firstCap,
    rowsPerPage: cap,
    systemHeightPx: sysH,
    rows,
    pages,
    pageCount: pages.length,
    overflowRows,
    longBarIndices,
    advices,
    locationOf: (bi) => loc.get(bi) ?? null,
  };
}
