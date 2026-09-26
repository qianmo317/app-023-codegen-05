// 分页预演 /score/:id/preview —— 出谱之前先算清楚要几页纸。
// 条件（纸张方向 / 页面可用宽 / 每行最多小节数 / 每小节拍数）一改，页数与分布立刻重算。
// 页面上直接看到逐页预演：页边、页码、第一页才有标题与速度说明；
// 偏长小节挤出右边界时给出「单独占一行 / 加宽可用宽」两种调整及调整后页数；
// 可直接 window.print() 打印这套预演结果。
import { useEffect, useMemo, useState } from 'react';
import type { Score } from '../types';
import { getScore } from '../lib/storage';
import { ScoreGrid } from '../components/ScoreGrid';
import {
  A4,
  PAGE_MARGIN_PX,
  defaultMaxBarsPerRow,
  defaultUsableWidthPx,
  paginate,
  type Orientation,
} from '../lib/pagination';

const ZOOMS = [0.5, 0.75, 1] as const;

export function Preview({ scoreId }: { scoreId: string }) {
  const [score, setScore] = useState<Score | null>(null);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [bpb, setBpb] = useState(4); // 每小节几拍（预览基准，不改原谱）
  const [maxBars, setMaxBars] = useState(8); // 每行最多几个小节
  const [usableMm, setUsableMm] = useState(0); // 页面可用宽（mm）；0 = 物理默认
  const [solo, setSolo] = useState<Set<number>>(new Set());
  const [jianpu, setJianpu] = useState(false);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(0.75);

  useEffect(() => {
    getScore(scoreId).then((s) => {
      if (!s) return;
      setScore(s);
      const b = s.bars[0]?.beatsPerBar ?? 4;
      setBpb(b);
      setMaxBars(defaultMaxBarsPerRow('landscape', b));
    });
  }, [scoreId]);

  // 切换方向或基准拍数时，每行最多小节数回到该方向建议值（用户随后仍可手改）
  const onOrientation = (o: Orientation) => {
    setOrientation(o);
    setMaxBars(defaultMaxBarsPerRow(o, bpb));
    setUsableMm(0);
    setSolo(new Set());
  };
  const onBpb = (n: number) => {
    setBpb(n);
    setMaxBars(defaultMaxBarsPerRow(orientation, n));
    setSolo(new Set());
  };

  const physicalMm = orientation === 'landscape' ? 277 : 190; // A4 减 10mm 页边后的可用宽
  const mmToPx = (mm: number) => Math.round((mm * 96) / 25.4);
  const pxToMm = (px: number) => Math.round((px * 25.4) / 96);
  const usablePx = usableMm > 0 ? mmToPx(usableMm) : defaultUsableWidthPx(orientation);

  const result = useMemo(() => {
    if (!score) return null;
    return paginate({
      bars: score.bars,
      beatsPerBar: bpb,
      orientation,
      maxBarsPerRow: maxBars,
      usableWidthPx: usablePx,
      instrumentRows: score.instruments.length,
      showJianpu: jianpu,
      soloBarIndices: solo,
      labelWidthPx: 0, // 预演把谱面顶到页边内容区，行内不画乐器名，全部可用宽都给小节
    });
  }, [score, bpb, orientation, maxBars, usablePx, jianpu, solo]);

  // 动态 @page：方向由用户条件决定（全局 @page 无法按元素区分，只能整份打印一个方向）
  useEffect(() => {
    let el = document.getElementById('preview-page-style') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'preview-page-style';
      document.head.appendChild(el);
    }
    el.textContent = `@media print { @page { size: A4 ${orientation}; margin: 0; } }`;
    return () => {
      el?.remove();
    };
  }, [orientation]);

  if (!score || !result) return <div className="page dim">加载中…</div>;

  const pageW = A4[orientation].widthPx;
  const pageH = A4[orientation].heightPx;

  const toggleSolo = (bi: number) =>
    setSolo((prev) => {
      const next = new Set(prev);
      if (next.has(bi)) next.delete(bi);
      else next.add(bi);
      return next;
    });

  // 加宽到建议值（mm 输入框随之更新，立即重算页数）
  const widenTo = (px: number) => setUsableMm(Math.max(usableMm || physicalMm, pxToMm(px)));

  const subText = score.freeMeter
    ? '散板（自由时值，宽度为相对表达）'
    : `${bpb}/4 · ${score.bpm} BPM`;

  return (
    <div className="preview-root" data-testid="preview-page" data-orientation={orientation}>
      <div className="preview-toolbar no-print">
        <a className="btn" href={`#/score/${score.id}`}>
          ← 返回编辑
        </a>
        <label>
          纸张方向
          <select
            data-testid="pv-orientation"
            value={orientation}
            onChange={(e) => onOrientation(e.target.value as Orientation)}
          >
            <option value="landscape">A4 横向</option>
            <option value="portrait">A4 纵向</option>
          </select>
        </label>
        <label>
          每小节拍数
          <input
            type="number"
            min={1}
            max={12}
            data-testid="pv-bpb"
            value={bpb}
            onChange={(e) => onBpb(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
          />
        </label>
        <label>
          每行最多小节
          <input
            type="number"
            min={1}
            max={40}
            data-testid="pv-maxbars"
            value={maxBars}
            onChange={(e) => setMaxBars(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
          />
        </label>
        <label>
          可用宽(mm)
          <input
            type="number"
            min={120}
            max={physicalMm}
            data-testid="pv-width"
            value={usableMm || physicalMm}
            onChange={(e) => setUsableMm(Math.max(120, Math.min(physicalMm, Number(e.target.value) || physicalMm)))}
          />
        </label>
        <label className="dim">
          <input type="checkbox" checked={jianpu} onChange={(e) => setJianpu(e.target.checked)} />
          简谱对照
        </label>
        <span className="pv-zoom">
          缩放
          {ZOOMS.map((z) => (
            <button
              key={z}
              className={`btn-sm ${zoom === z ? 'on' : ''}`}
              data-testid={`pv-zoom-${z}`}
              onClick={() => setZoom(z)}
            >
              {Math.round(z * 100)}%
            </button>
          ))}
        </span>
        <button className="btn primary" data-testid="pv-do-print" onClick={() => window.print()}>
          打印预演结果
        </button>
      </div>

      {/* 汇总：页数与分布（改任一条件立即变化） */}
      <div className="pv-summary no-print" data-testid="pv-summary">
        <b data-testid="pv-page-count">共 {result.pageCount} 页</b>
        <span className="dim">
          · 每页 {result.rowsPerPage} 行（首页 {result.rowsOnFirstPage} 行）· 每行最多 {maxBars} 小节 ·
          每格 {result.pxPerTick}px
        </span>
        <span className="dim" data-testid="pv-distribution">
          {result.pages.map((p) => (
            <span key={p.pageNo} className="pv-dist-chip" data-testid={`pv-dist-page-${p.pageNo}`}>
              第{p.pageNo}页：小节 {p.bars.length ? `${p.bars[0] + 1}–${p.bars[p.bars.length - 1] + 1}` : '—'}
            </span>
          ))}
        </span>
      </div>

      {/* 溢出告警与调整建议 */}
      {result.overflowRows.length > 0 && (
        <div className="pv-warn no-print" data-testid="pv-warn-panel">
          <div>
            有 <b data-testid="pv-overflow-count">{result.overflowRows.length}</b> 行挤出页面右边界；
            偏长小节：
            {result.longBarIndices.length ? (
              result.longBarIndices.map((bi) => (
                <span key={bi} className="pv-long-tag" data-testid={`pv-long-${bi}`}>
                  第 {bi + 1} 小节（{score.bars[bi].beatsPerBar} 拍）
                </span>
              ))
            ) : (
              <span className="dim">无（仅因每行排太多而溢出）</span>
            )}
          </div>
          {result.advices.map((a) => (
            <div key={a.barIndex} className="pv-advice" data-testid={`pv-advice-${a.barIndex}`}>
              <b>第 {a.barIndex + 1} 小节</b>偏长（超出名义槽 {Math.round(a.overSlotPx)}px）：
              <button
                className="btn-sm"
                data-testid={`pv-solo-${a.barIndex}`}
                onClick={() => toggleSolo(a.barIndex)}
              >
                {solo.has(a.barIndex) ? '取消独占一行' : '让它单独占一行'}
              </button>
              {a.tooLongEvenSolo ? (
                <span className="pv-fatal" data-testid={`pv-fatal-${a.barIndex}`}>
                  单独成行仍宽于整页（{pxToMm(result.maxPhysicalUsableWidthPx)}mm）——需换纸或改横向
                </span>
              ) : (
                <button
                  className="btn-sm"
                  data-testid={`pv-widen-${a.barIndex}`}
                  disabled={a.exceedsPaper}
                  onClick={() => widenTo(a.neededUsableWidthPx)}
                >
                  加宽到 {pxToMm(a.neededUsableWidthPx)}mm
                </button>
              )}
              <span className="dim">
                → 单独占一行后 <b data-testid={`pv-solo-pages-${a.barIndex}`}>{a.soloPageCount}</b> 页；加宽后{' '}
                <b data-testid={`pv-widen-pages-${a.barIndex}`}>{a.widenedPageCount}</b> 页
              </span>
            </div>
          ))}
          {result.longBarIndices.length === 0 && (
            <div className="pv-advice">
              小节本身不偏长，减少「每行最多小节」即可；或
              <button
                className="btn-sm"
                data-testid="pv-widen-all"
                onClick={() =>
                  widenTo(Math.max(...result.overflowRows.map((r) => Math.ceil(r.widthPx))))
                }
              >
                一键加宽到 {pxToMm(Math.max(...result.overflowRows.map((r) => Math.ceil(r.widthPx))))}mm
              </button>
            </div>
          )}
        </div>
      )}
      {result.overflowRows.length === 0 && (
        <div className="pv-ok no-print" data-testid="pv-ok">
          ✓ 全部 {score.bars.length} 个小节都在页边以内
        </div>
      )}

      {/* 逐页预演 */}
      <div className="pv-pages" data-testid="pv-pages">
        {result.pages.map((page) => (
          <div
            key={page.pageNo}
            className="pv-page-wrap no-print"
            style={{ width: pageW * zoom + 40, height: pageH * zoom + 24 }}
          >
            <div className="pv-page-caption" data-testid={`pv-caption-${page.pageNo}`}>
              第 {page.pageNo} / {result.pageCount} 页
            </div>
            <div
              className="pv-page"
              data-testid={`pv-page-${page.pageNo}`}
              style={{ width: pageW, height: pageH, transform: `scale(${zoom})` }}
            >
              {/* 页边（边距框） */}
              <div
                className="pv-margin"
                style={{
                  left: PAGE_MARGIN_PX,
                  top: PAGE_MARGIN_PX,
                  width: pageW - PAGE_MARGIN_PX * 2,
                  height: pageH - PAGE_MARGIN_PX * 2,
                }}
              />
              {page.pageNo === 1 && (
                <div
                  className="pv-header"
                  style={{ left: PAGE_MARGIN_PX, top: PAGE_MARGIN_PX, width: pageW - PAGE_MARGIN_PX * 2 }}
                  data-testid="pv-header"
                >
                  <div className="pv-title">{score.title}</div>
                  <div className="pv-sub">
                    {score.style ? `${score.style} · ` : ''}
                    {subText}
                  </div>
                </div>
              )}
              <div
                className="pv-body"
                style={{
                  left: PAGE_MARGIN_PX,
                  top: page.pageNo === 1 ? PAGE_MARGIN_PX + 74 : PAGE_MARGIN_PX,
                  width: pageW - PAGE_MARGIN_PX * 2,
                  height: pageH - PAGE_MARGIN_PX * 2 - (page.pageNo === 1 ? 74 : 0) - 20,
                }}
              >
                {page.rows.map((row, ri) => {
                  const start = row.bars[0];
                  const count = row.bars.length;
                  const sub = {
                    ...score,
                    bars: score.bars.slice(start, start + count),
                  };
                  const warn = new Set(row.longBars);
                  return (
                    <div
                      key={ri}
                      className={`pv-row ${row.overflow ? 'overflow' : ''}`}
                      data-testid={`pv-row-${page.pageNo}-${ri}`}
                      data-overflow={row.overflow ? 'true' : 'false'}
                      style={{ width: result.usableWidthPx }}
                    >
                      <ScoreGrid
                        score={sub}
                        pxPerTick={result.pxPerTick}
                        rowHeight={40}
                        barsPerRow={count}
                        showJianpu={jianpu}
                        showBeatHighlightBg={false}
                        labelWidth={0}
                        hideLabels
                        warnBarIndices={warn}
                        testIdPrefix={`pv-${page.pageNo}-${ri}`}
                      />
                      <div
                        className="pv-right-edge"
                        style={{ left: result.usableWidthPx }}
                        data-testid={`pv-edge-${page.pageNo}-${ri}`}
                      />
                      {row.overflow && (
                        <span className="pv-overflow-badge" data-testid={`pv-overflow-badge-${page.pageNo}-${ri}`}>
                          超界 {Math.round(row.overflowPx)}px · 小节 {row.bars.map((b) => b + 1).join('、')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* 页码 */}
              <div className="pv-pageno" style={{ left: PAGE_MARGIN_PX, width: pageW - PAGE_MARGIN_PX * 2 }}>
                — {page.pageNo} —
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 打印用：与屏幕同构，但去掉缩放、按物理像素 1:1 输出（@page margin 0，元素自带页边） */}
      <div className="pv-print-area">
        {result.pages.map((page) => (
          <div
            key={page.pageNo}
            className="pv-page print"
            style={{ width: pageW, height: pageH }}
            data-testid={`pv-print-page-${page.pageNo}`}
          >
            {page.pageNo === 1 && (
              <div
                className="pv-header"
                style={{ left: PAGE_MARGIN_PX, top: PAGE_MARGIN_PX, width: pageW - PAGE_MARGIN_PX * 2 }}
              >
                <div className="pv-title">{score.title}</div>
                <div className="pv-sub">
                  {score.style ? `${score.style} · ` : ''}
                  {subText}
                </div>
              </div>
            )}
            <div
              className="pv-body"
              style={{
                left: PAGE_MARGIN_PX,
                top: page.pageNo === 1 ? PAGE_MARGIN_PX + 74 : PAGE_MARGIN_PX,
                width: pageW - PAGE_MARGIN_PX * 2,
                height: pageH - PAGE_MARGIN_PX * 2 - (page.pageNo === 1 ? 74 : 0) - 20,
              }}
            >
              {page.rows.map((row, ri) => {
                const start = row.bars[0];
                const sub = { ...score, bars: score.bars.slice(start, start + row.bars.length) };
                return (
                  <div key={ri} className={`pv-row ${row.overflow ? 'overflow' : ''}`} style={{ width: result.usableWidthPx }}>
                    <ScoreGrid
                      score={sub}
                      pxPerTick={result.pxPerTick}
                      rowHeight={40}
                      barsPerRow={row.bars.length}
                      showJianpu={jianpu}
                      showBeatHighlightBg={false}
                      labelWidth={0}
                      hideLabels
                      testIdPrefix={`pvp-${page.pageNo}-${ri}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="pv-pageno" style={{ left: PAGE_MARGIN_PX, width: pageW - PAGE_MARGIN_PX * 2 }}>
              — {page.pageNo} —
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
