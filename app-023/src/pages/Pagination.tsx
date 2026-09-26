// 分页预演 /score/:id/preview —— 出谱之前先算清楚要几页纸。
// 给定纸张方向、页面可用宽度、每行最多小节数、每小节拍数，实时重算分页：
// 总页数 / 每页哪几个小节 / 每行哪几个小节 / 哪些小节会挤出右边界，
// 排不下的小节给出「单独占一行」或「调大可用宽度」两种调整及新页数；预演结果可直接打印。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Score } from '../types';
import { getScore } from '../lib/storage';
import { barTicks } from '../lib/grid';
import { ScoreGrid } from '../components/ScoreGrid';
import {
  HEADER_H,
  ROW_GAP,
  ROW_HEIGHT,
  paginate,
  suggestWiderWidth,
  type LayoutPage,
  type LayoutRow,
  type Orientation,
  type PageInput,
  type PageLayout,
  PAGE_SIZE_MM,
} from '../lib/pagination';

const JIANPU_H = 26; // 简谱对照行高（与 ScoreGrid 一致）

/** 各方向下的可用宽度预设（mm）：物理宽 − 10mm 边距 / − 20mm 边距 / 更窄 */
const WIDTH_PRESETS: Record<Orientation, number[]> = {
  landscape: [277, 257, 220],
  portrait: [190, 170, 140],
};

const fmtRange = (nums: number[]): string =>
  nums.length === 0 ? '—' : nums.length === 1 ? `第 ${nums[0]} 小节` : `第 ${nums[0]}–${nums[nums.length - 1]} 小节`;

/** 该行渲染用的每格像素：预演拍号与谱面拍数不同时按比例压缩/拉伸 */
function visualPpt(row: LayoutRow, layout: PageLayout, score: Score): number {
  const first = score.bars[row.bars[0].barIndex];
  const engineTicks = barTicks(layout.beatsPerBar > 0 ? layout.beatsPerBar : first.beatsPerBar);
  const actualTicks = barTicks(first.beatsPerBar);
  return actualTicks > 0 ? (row.pxPerTick * engineTicks) / actualTicks : row.pxPerTick;
}

/** 一页预演：页边线 + 页码 + （仅第一页）标题与速度说明 + 各行谱面 */
function PageSheet({
  score,
  layout,
  page,
  showJianpu,
}: {
  score: Score;
  layout: PageLayout;
  page: LayoutPage;
  showJianpu: boolean;
}) {
  const isFirst = page.pageIndex === 0;
  const bpb = layout.beatsPerBar > 0 ? layout.beatsPerBar : (score.bars[0]?.beatsPerBar ?? 4);
  return (
    <div
      className="preview-sheet"
      data-testid={`preview-page-${page.pageIndex}`}
      style={{ width: layout.pageW, height: layout.pageH }}
    >
      {/* 页边线（页边距参考线） */}
      <div
        className="margin-guide"
        style={{ left: layout.marginX, top: layout.marginY, width: layout.contentW, height: layout.contentH }}
      />
      {/* 标题与速度说明 —— 只出现在第一页 */}
      {isFirst && (
        <div
          className="preview-header"
          data-testid="preview-header"
          style={{ left: layout.marginX, top: layout.marginY, width: layout.contentW, height: HEADER_H }}
        >
          <h1>{score.title}</h1>
          <p>
            {score.style ? `${score.style} · ` : ''}
            {score.freeMeter ? '散板（自由时值，宽度为相对表达）' : `${bpb}/4 拍 · ${score.bpm} BPM`}
          </p>
        </div>
      )}
      {page.rows.map((row, ri) => {
        const top = layout.marginY + (isFirst ? HEADER_H : 0) + ri * (layout.sysH + ROW_GAP);
        const firstBar = row.bars[0].barIndex;
        const rowScore: Score = { ...score, bars: score.bars.slice(firstBar, firstBar + row.bars.length) };
        const denseNums = row.bars.filter((b) => b.dense).map((b) => b.barIndex + 1);
        return (
          <div
            key={row.rowIndex}
            className={`preview-row${row.overflow ? ' overflow' : ''}`}
            data-testid={`preview-row-${row.rowIndex}`}
            style={{ left: layout.marginX, top, width: layout.contentW, height: layout.sysH }}
          >
            <ScoreGrid
              score={rowScore}
              pxPerTick={visualPpt(row, layout, score)}
              rowHeight={ROW_HEIGHT}
              barsPerRow={row.bars.length}
              showJianpu={showJianpu}
              showLabels={ri === 0}
              barNumberOffset={firstBar}
              testIdPrefix={`preview-r${row.rowIndex}`}
            />
            {row.overflow && <span className="overflow-tag">超出右边界</span>}
            {denseNums.length > 0 && <span className="dense-tag">第 {denseNums.join('、')} 小节过密</span>}
          </div>
        );
      })}
      {/* 页码 */}
      <div className="page-num">
        第 {page.pageIndex + 1} / {layout.pageCount} 页
      </div>
    </div>
  );
}

export function Pagination({ scoreId }: { scoreId: string }) {
  const [score, setScore] = useState<Score | null>(null);
  const [err, setErr] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [usableWidthMm, setUsableWidthMm] = useState(277);
  const [maxBarsPerRow, setMaxBarsPerRow] = useState(8);
  const [beatsPerBar, setBeatsPerBar] = useState(0); // 0 = 沿用谱面
  const [soloBars, setSoloBars] = useState<ReadonlySet<number>>(new Set());
  const [showJianpu, setShowJianpu] = useState(false);
  const [zoom, setZoom] = useState(0); // 0 = 适应宽度

  useEffect(() => {
    getScore(scoreId).then((s) => (s ? setScore(s) : setErr('未找到该曲目')));
  }, [scoreId]);

  // 打印纸张随方向走：注入 @page 规则（覆盖全局 A4 横向），卸载时移除
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@page { size: A4 ${orientation}; margin: 0; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [orientation]);

  const input: PageInput | null = useMemo(
    () =>
      score
        ? {
            bars: score.bars,
            instrumentCount: score.instruments.length,
            orientation,
            usableWidthMm,
            maxBarsPerRow,
            beatsPerBar,
            soloBars,
            extraRowH: showJianpu ? JIANPU_H : 0,
          }
        : null,
    [score, orientation, usableWidthMm, maxBarsPerRow, beatsPerBar, soloBars, showJianpu],
  );

  // 改任一条件 → 立刻重算
  const layout = useMemo(() => (input ? paginate(input) : null), [input]);

  // 调整建议一：问题小节全部单独占一行 → 新页数
  const warnBars = useMemo(
    () => (layout ? [...new Set([...layout.overflowBars, ...layout.denseBars])] : []),
    [layout],
  );
  const soloLayout = useMemo(
    () => (input && layout && warnBars.length > 0
      ? paginate({ ...input, soloBars: new Set([...soloBars, ...warnBars]) })
      : null),
    [input, layout, warnBars, soloBars],
  );
  // 调整建议二：调大每行可用宽度 → 新宽度与新页数
  const widthRemedy = useMemo(
    () => (input && layout && layout.warnings.length > 0 ? suggestWiderWidth(input) : null),
    [input, layout],
  );

  // 适应宽度缩放
  const sheetsRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = sheetsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const scale = layout ? (zoom > 0 ? zoom : Math.min(1, Math.max(0.3, (containerW - 40) / layout.pageW || 1))) : 1;

  if (err) return <div className="page">{err}</div>;
  if (!score || !layout) return <div className="page dim">加载中…</div>;

  const changeOrientation = (o: Orientation) => {
    setOrientation(o);
    setUsableWidthMm((w) => Math.min(w, PAGE_SIZE_MM[o].w - 20));
  };

  return (
    <div className="preview-page" data-testid="preview-page">
      <div className="preview-toolbar no-print">
        <a className="btn" href={`#/score/${score.id}`} data-testid="btn-back-editor">
          ← 返回编辑
        </a>
        <label>
          纸张方向
          <select
            data-testid="sel-orientation"
            value={orientation}
            onChange={(e) => changeOrientation(e.target.value as Orientation)}
          >
            <option value="landscape">A4 横向</option>
            <option value="portrait">A4 纵向</option>
          </select>
        </label>
        <label>
          可用宽度
          <input
            type="number"
            data-testid="inp-usable-width"
            value={usableWidthMm}
            min={40}
            max={295}
            onChange={(e) => setUsableWidthMm(Math.max(40, Math.min(295, Number(e.target.value) || 40)))}
          />
          mm
        </label>
        <span className="presets">
          {WIDTH_PRESETS[orientation].map((w) => (
            <button key={w} className="btn-sm" data-testid={`preset-w${w}`} onClick={() => setUsableWidthMm(w)}>
              {w}
            </button>
          ))}
        </span>
        <label>
          每行最多
          <select data-testid="sel-bars-per-row" value={maxBarsPerRow} onChange={(e) => setMaxBarsPerRow(Number(e.target.value))}>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          小节
        </label>
        <label>
          每小节
          <select data-testid="sel-beats-per-bar" value={beatsPerBar} onChange={(e) => setBeatsPerBar(Number(e.target.value))}>
            <option value={0}>谱面（{score.bars[0]?.beatsPerBar ?? 4}/4）</option>
            <option value={2}>2/4</option>
            <option value={3}>3/4</option>
            <option value={4}>4/4</option>
          </select>
          拍
        </label>
        <label className="dim">
          <input type="checkbox" data-testid="chk-preview-jianpu" checked={showJianpu} onChange={(e) => setShowJianpu(e.target.checked)} />
          简谱对照行
        </label>
        <label>
          缩放
          <select data-testid="sel-zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            <option value={0}>适应宽度</option>
            <option value={1}>100%</option>
            <option value={0.75}>75%</option>
            <option value={0.5}>50%</option>
          </select>
        </label>
        <button className="btn primary" data-testid="btn-print-preview" onClick={() => window.print()}>
          打印预演结果
        </button>
      </div>

      {/* 文字结果：总页数 + 每页/每行各放哪几个小节 */}
      <div className="preview-summary no-print" data-testid="preview-summary">
        <div>
          共 <b data-testid="page-count">{layout.pageCount}</b> 页 · {score.bars.length} 小节 · 每行最多 {maxBarsPerRow} 小节
          {layout.rows.length > 0 && <> · 实际每行 {layout.barsPerRowUsed.join(' / ')} 小节</>}
          {beatsPerBar > 0 && <span className="dim">（预演按 {beatsPerBar}/4 拍排版，不改谱面数据）</span>}
        </div>
        {layout.pages.map((p) => (
          <div key={p.pageIndex} data-testid={`summary-page-${p.pageIndex}`}>
            第 {p.pageIndex + 1} 页：{fmtRange(p.barNumbers)}（{p.rows.length} 行：
            {p.rows.map((r) => `第${r.rowIndex + 1}行 ${fmtRange(r.barNumbers)}`).join('，')}）
          </div>
        ))}
        {soloBars.size > 0 && (
          <div>
            已单独占行：
            {[...soloBars].sort((a, b) => a - b).map((bi) => (
              <button
                key={bi}
                className="btn-sm solo-chip"
                data-testid={`chip-solo-${bi}`}
                title="点击取消单独占行"
                onClick={() =>
                  setSoloBars((s) => {
                    const n = new Set(s);
                    n.delete(bi);
                    return n;
                  })
                }
              >
                第 {bi + 1} 小节 ×
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 告警与调整建议 */}
      {layout.warnings.length === 0 ? (
        <div className="preview-ok no-print" data-testid="preview-ok">
          ✓ 所有小节都能排在页面内，共 {layout.pageCount} 页
        </div>
      ) : (
        <div className="preview-warnings no-print" data-testid="preview-warnings">
          {layout.warnings.map((w) => (
            <div className="warn-row" data-testid={`warn-bar-${w.barIndex}`} key={`${w.kind}-${w.barIndex}`}>
              <span>⚠ {w.text}</span>
              <button
                className="btn-sm"
                data-testid={`btn-solo-${w.barIndex}`}
                onClick={() => setSoloBars((s) => new Set(s).add(w.barIndex))}
              >
                该小节单独占一行
              </button>
            </div>
          ))}
          <div className="remedy" data-testid="remedy-solo">
            方案一：把 {warnBars.length} 个问题小节单独占一行 → 共 {soloLayout?.pageCount ?? '—'} 页
            {soloLayout && soloLayout.warnings.length > 0 && '（仍有小节排不下）'}
            <button
              className="btn-sm"
              data-testid="btn-apply-solo-all"
              onClick={() => setSoloBars((s) => new Set([...s, ...warnBars]))}
            >
              全部单独占行
            </button>
          </div>
          <div className="remedy" data-testid="remedy-width">
            {widthRemedy ? (
              <>
                方案二：把每行可用宽度调大到 {widthRemedy.usableWidthMm} mm
                {widthRemedy.orientation !== orientation && `（改用${widthRemedy.orientation === 'landscape' ? '横向' : '纵向'}）`}
                → 共 {widthRemedy.pageCount} 页
                <button
                  className="btn-sm"
                  data-testid="btn-apply-width"
                  onClick={() => {
                    setOrientation(widthRemedy.orientation);
                    setUsableWidthMm(widthRemedy.usableWidthMm);
                  }}
                >
                  应用该宽度
                </button>
              </>
            ) : (
              '方案二：已尝试调大可用宽度，A4 幅面内仍排不下——请减少每行小节数，或先把过密小节拆成两段。'
            )}
          </div>
        </div>
      )}

      {/* 预演纸张：每页画页边与页码，标题与速度说明只在第一页 */}
      <div className="preview-sheets" data-testid="preview-sheets" ref={sheetsRef}>
        {layout.pages.map((page) => (
          <div
            key={page.pageIndex}
            className="sheet-wrap"
            style={{ width: layout.pageW * scale, height: layout.pageH * scale }}
          >
            <div className="sheet-scale" style={{ transform: `scale(${scale})` }}>
              <PageSheet score={score} layout={layout} page={page} showJianpu={showJianpu} />
            </div>
          </div>
        ))}
      </div>
      <p className="print-foot no-print dim">
        打印将按当前方向与可用宽度输出（A4 {orientation === 'landscape' ? '横向' : '纵向'}、页边距 0，页边线即页边距参考）。
      </p>
    </div>
  );
}
