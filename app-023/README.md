# app-023 · 锣鼓经记谱与节拍试听（前端项目）

民间锣鼓经记谱、Web Audio 合成试听、A4 出谱。纯前端应用，产品背景、功能清单与验收结果见仓库根目录 [README.md](../../README.md)。

本文档面向开发者：架构、核心概念、开发约定与常见任务。

---

## 目录

1. [技术栈与依赖策略](#1-技术栈与依赖策略)
2. [快速开始](#2-快速开始)
3. [架构总览](#3-架构总览)
4. [核心概念](#4-核心概念)
5. [常见开发任务](#5-常见开发任务)
6. [测试](#6-测试)
7. [编码约定](#7-编码约定)
8. [构建与部署](#8-构建与部署)
9. [故障排查](#9-故障排查)

---

## 1. 技术栈与依赖策略

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | React 18 + TypeScript 5（strict） | 函数组件 + hooks |
| 构建 | Vite 5 | `base: './'`，相对路径部署 |
| 路由 | 自研 hash 路由（[App.tsx](src/App.tsx)） | `#/` 前缀，约 40 行解析，无 react-router |
| 状态 | 局部 useState + [settingsContext](src/settingsContext.tsx) | 播放状态集中 [useAudio](src/hooks/useAudio.ts) |
| 存储 | IndexedDB（[storage.ts](src/lib/storage.ts)） | 库 `app023-percussion`，仓 `scores` / `settings` |
| 音频 | Web Audio 原生（[audio.ts](src/lib/audio.ts)） | 无采样文件，全合成 |
| 测试 | Vitest（jsdom + fake-indexeddb）+ Playwright | 见 §6 |

**依赖纪律：运行时依赖只有 `react` / `react-dom`。** 不引入 UI 库、音频库、路由库、图标库；新需求优先自研或扩展现有模块。开发期工具链（vitest/playwright/fake-indexeddb/@types/*）不受此限。

## 2. 快速开始

```bash
cd app-023
npm install
npm run dev        # 开发服务器（默认 5173）
npm run build      # tsc -b && vite build（含类型检查）
npm test           # 单元测试（86 个用例）
npm run e2e        # Playwright E2E（19 个用例，自动起 4174 preview）
```

首次跑 E2E 前需安装浏览器：`npx playwright install chromium`。

## 3. 架构总览

```
                     ┌──────────────────────────────┐
                     │  data/instruments.json        │  乐器/拟音字/键位/时值键
                     │  data/patterns.json           │  曲牌骨架
                     └──────────┬───────────────────┘
                                │ factory.ts（曲牌→Score、默认设置）
                                ▼
   ┌──────────┐   保存    ┌─────────────┐
   │ storage  │◄──────────│  Score 状态  │  Editor.tsx 持有，防抖 400ms 自动存
   │ IndexedDB│──────────►│ (不可变更新) │
   └──────────┘   读取    └──────┬──────┘
                    ┌────────────┼──────────────────┐
                    ▼            ▼                  ▼
             grid.ts        ScoreGrid.tsx       audio.ts
             时值换算/拆格    SVG 渲染            computeEvents(纯函数)
             pagination.ts  (编辑/打印/预演共用)  → scheduleEvents(lookahead)
             分页预演(纯函数)
                    │            │                  │
                    ├────────────┼──────────────┐   ▼
                    ▼            ▼              ▼ AudioContext
             Preview.tsx   Print.tsx      编辑器网格
             逐页预演/打印  A4 横排/PNG     点击+键盘录入   精确发声（25ms 填窗）
```

### 模块职责

| 模块 | 职责 | 关键导出 |
|------|------|----------|
| [lib/grid.ts](src/lib/grid.ts) | 时值↔格换算、step 偏移、拆格合并、宽度计算（编辑/打印共用） | `barTicks` `stepOffsets` `setStepAt` `scoreWidthPx` `barsPerRow` |
| [lib/pagination.ts](src/lib/pagination.ts) | 分页预演：方向/可用宽/每行小节数/拍数 → 页数、每页与每行小节、偏长溢出、两种调整方案模拟（纯函数） | `paginate` `computePxPerTick` `rowsCapacity` `defaultMaxBarsPerRow` |
| [lib/glyphs.ts](src/lib/glyphs.ts) | 拟音字↔乐器/技法反查、键位解析、防串乐器校验 | `buildGlyphMap` `resolveKey` `lookupGlyph` `validateHitGlyphs` |
| [lib/audio.ts](src/lib/audio.ts) | 合成音（drum/metal/wood）、lookahead 调度器、事件展开 | `computeEvents` `computeLoopEvents` `scheduleEvents` `playRange` |
| [lib/storage.ts](src/lib/storage.ts) | IndexedDB CRUD（scores/settings） | `listScores` `getScore` `saveScore` `deleteScore` |
| [lib/factory.ts](src/lib/factory.ts) | JSON 默认数据 → 对象、曲牌 → Score 转换（跨小节自动切分补休止） | `scoreFromPattern` `newEmptyScore` `emptyBar` |
| [hooks/useAudio.ts](src/hooks/useAudio.ts) | 播放状态集中管理：ctx/调度/循环/高亮/独奏静音 | `useAudio(score)` |
| [components/ScoreGrid.tsx](src/components/ScoreGrid.tsx) | SVG 谱面：时间×乐器网格、时值线、tie 延伸、齐奏同列、选中光标、高亮列 | `<ScoreGrid>` |
| [components/Transport.tsx](src/components/Transport.tsx) | 试听控制台：播放/BPM/循环/高亮开关 | `<Transport>` |
| [pages/*](src/pages) | ScoreList / Editor / Preview / Print / Library / Settings 六个页面 | — |

## 4. 核心概念

### 4.1 格（tick）系统 —— 一切时间的基础

- `TICKS_PER_BEAT = 4`：每拍 4 格，**全项目唯一时间单位，必须整数**（浮点会造成渲染 1px 抖动与调度累积误差）。
- 时值表（`DURATIONS`）：整拍=4、半拍=2、¼拍=1、附点=6、附点半拍=3；切分不单设类型，由格位组合表达（如 1+2+1）。
- **小节不变式**：`bar.steps` 各 `beats` 之和 === `barTicks(beatsPerBar)`，`isBarFull` 随处校验，编辑操作一律通过 `setStepAt` 保持铺满（不等长放置会自动前后补空 step）。

### 4.2 拟音字映射

```
键盘字符 ──keyMap──► {instrumentId, glyphIndex} ──► 拟音字 ──techMap──► 技法(roll/mute/flam)
```

- 同一乐器多个拟音字 = 不同打法（咚=常规、八=双打、哒=闷击），`buildGlyphMap` 构建反查表时**同字跨乐器立即抛错**，杜绝串乐器。
- 谱面数据校验：`validateHitGlyphs` 保证 hit.glyph 与 instrumentId 匹配。

### 4.3 lookahead 调度（为什么不用 setTimeout）

`setTimeout(fn, delay)` 的 delay 受事件循环与计时器精度影响（可达数 ms 抖动，后台标签页被节流到 1s），节奏应用不可用。正确做法：

1. `computeEvents`（纯函数）：整谱展开为 `{time = t0 + 绝对格 × 每格秒数}` 事件表——**每击独立计算，无累加变量 → 无累积漂移**；
2. `scheduleEvents`：`setInterval(25ms)` 仅向 0.12s 窗口填事件，发声由 `AudioContext` 时间轴精确执行；
3. **播放前必须 `await ctx.resume()`**：suspended 时 `currentTime` 冻结，预排会挤在 0 附近（E2E 实测踩过）。

音频与视觉共用同一事件源（`ScheduleEvent`），高亮列不会与声音错位。

### 4.4 散板（freeMeter）

不画严格拍格、时值线为相对宽度；播放按「等格时长 × `currentBeatStretch`」近似，UI 明确标注为近似。

### 4.5 分页预演（pagination.ts + Preview.tsx）

出谱前先算页数，**排版推演是纯函数**（[lib/pagination.ts](src/lib/pagination.ts)），UI 只负责改条件与渲染：

- 条件：纸张方向（A4 横/纵）、页面可用宽（mm）、每行最多小节数、每小节拍数（预览基准，不改原谱）、乐器行数、简谱行。
- `pxPerTick` 以该方向的**物理设计可用宽**反算（名义 N 个基准小节恰好排满），用户临时调窄/调宽可用宽只改溢出判定、不让字号漂移 —— 否则「加宽到 X mm」会因字号变大而永远追不上需求宽度。
- 行打包每行最多 N 个小节，`soloBarIndices` 强制某小节独占一行；行宽 > 可用宽即溢出，宽于名义槽的小节记为偏长。
- 调整建议只给「落在溢出行里的偏长小节」：`soloPageCount`（独占一行后页数）与 `widenedPageCount`（加宽到该行实际宽后页数）由同一个内部 `layoutCore` 推演，**不递归调用公开 `paginate`**（避免建议推演二次产生建议）。
- 第一页扣 74px 标题+速度区，其后各页等容量；标题/速度说明只渲染在第一页。
- 打印方向随条件动态注入 `@page { size: A4 <orientation> }`，屏幕区 `.no-print` 隐藏、打印区 `.pv-print-area` 仅在 `@media print` 显示，物理像素 1:1 逐页 `page-break-after: always`。

## 5. 常见开发任务

### 5.1 新增乐器

编辑 [src/data/instruments.json](src/data/instruments.json)：

1. 在 `instruments` 数组添加：`id`（英文）、`name`、`glyphs`（拟音字，**不得与任何现有乐器重复**，否则 `buildGlyphMap` 抛错）、`synth`（type=drum 鼓皮 / metal 金属 / wood 木；baseHz、decay 秒）、`techMap`（字 → 技法数组，可省略=全部常规）。
2. 在 `keyMap` 为每个拟音字绑定键位（`key` 必须全表唯一）。
3. 无需改代码：设置页、曲牌库拟音字表、编辑器乐器面板均由数据驱动。

### 5.2 新增曲牌

编辑 [src/data/patterns.json](src/data/patterns.json)，格式为 `[拟音字数组, 格数][]`：

```json
"bars": [ [["哐","才","七"], 4], [["才"], 2], [["仓"], 2] ]
```

- 格数即 step.beats（整拍 4 / 半拍 2 / ¼拍 1 / 附点 6）；条目跨小节边界会自动切分（前段 tie 连打、后段转空步），末尾不足补休止——无需手工凑满小节。
- 拟音字必须存在于 instruments.json，否则 `scoreFromPattern` 抛错（有单测兜底：`T25 六个内置曲牌全部结构有效`）。
- 新增后在 [Library.tsx](src/pages/Library.tsx) 无需改动，卡片自动渲染。

### 5.3 修改默认键位/时值键

同在 instruments.json 的 `keyMap`（字母→字）与 `durationKeys`（数字→格数）。注意用户已保存的设置在 IndexedDB `settings` 仓，加载时与默认合并（用户值优先）。

### 5.4 调整合成音色

- 单实例调试：设置页直接改（仅本浏览器生效）。
- 持久默认：改 instruments.json 的 `synth` 字段。
- 算法层：[audio.ts](src/lib/audio.ts) `synthesizeHit`，三种配方的注释见 §4.3 与文件内注释；改后跑 `tests/scheduler.test.ts`（含 FakeAudioContext 结构性验证）。

### 5.5 新增编辑功能（快捷键）

编辑器快捷键集中在 [Editor.tsx](src/pages/Editor.tsx) `onKey`：先 `if (target.tagName === 'INPUT'...)` 排除输入框，再按功能分支；修改谱面的操作必须走 `patch/editBar`（不可变更新 + 铺满校验）。

## 6. 测试

### 6.1 布局

```
tests/grid.test.ts        26 用例：时值换算、切分偏移、拆格、宽度一致、曲牌结构
tests/pagination.test.ts 22 用例：字号反算、行打包/页码、偏长溢出、独占/加宽方案页数、位置查询
tests/preview-smoke.test.tsx 6 用例：Preview jsdom 渲染、条件改即重算、告警与调整按钮、打印区同构
tests/glyphs.test.ts      18 用例：反查、技法区分、键位解析、防串乐器、冲突抛错
tests/scheduler.test.ts   9 用例：漂移(<1e-9s)、齐奏同刻、循环相位、散板伸缩、lookahead 行为
tests/storage.test.ts      5 用例：CRUD、排序、覆盖更新、设置往返（fake-indexeddb）
e2e/app.spec.ts          19 用例：真实点击全链路（含分页预演 6 例，见 6.3）
```

### 6.2 约定

- 改 `grid.ts` → 必跑 grid.test；改 `audio.ts` → 必跑 scheduler.test；改 `glyphs.ts` → 必跑 glyphs.test；改数据 JSON → 全量 `npm test`（曲牌结构有兜底断言）。
- `computeEvents` 是纯函数（不碰 DOM/AudioContext），调度相关逻辑一律先写纯函数再接调度器，保证可测。

### 6.3 E2E

- 配置 [playwright.config.ts](playwright.config.ts)：自动起 `vite preview --port 4174`（`reuseExistingServer: false`，防止打到同机其他项目的服务）；用 `E2E_BASE_URL=http://localhost:8103 npx playwright test` 可对 Docker 容器复跑。
- 调度精度断言通过 `window.__scheduled()` 调试钩子（`useAudio.play` 注入，返回已排事件表），可自行扩展断言。
- 涉及持久化的用例需等待落盘（自动保存防抖 400ms / `saveSettings` 完成回调），用例内已有 `waitForTimeout`，改动时保留。

## 7. 编码约定

- **TypeScript strict**，提交前 `npm run build`（含 `tsc -b`）必须零错误。
- **时间一律整数格**，秒数仅在 audio.ts 边界换算。
- **不可变更新**：谱面修改用 `patch/editBar` 返回新对象，禁止直接 mutate state。
- **状态集中**：播放相关状态只在 `useAudio`，UI 组件只做显示与动作回调。
- 注释与 UI 文案用中文；标识符用英文。
- 样式集中在 [styles.css](src/styles.css)，谱面视觉规范：白底黑字、红小节线（#c0392b）、灰拍线、浅格线。
- 无障碍最低要求：交互元素用真实 `<button>`/`<input>`，测试用 `data-testid` 命名（E2E 依赖）。

## 8. 构建与部署

```bash
npm run build                 # 产物在 dist/（哈希文件名）
docker compose up -d --build  # 多阶段构建 → nginx，宿主 8103 端口
curl http://localhost:8103/healthz
docker compose down
```

- [Dockerfile](Dockerfile)：`node:20-alpine` 构建 → `nginx:1.27-alpine-slim` 运行（成品 21.1MB）。
- [nginx.conf](nginx.conf)：SPA 回退、`/assets/` immutable 一年缓存、`index.html` no-cache、gzip。
- **两处与原始规范的偏差**（原因详见根 README §13）：`nginx.conf` 不能进 `.dockerignore`（Dockerfile 需 COPY）；基底用 `alpine-slim`（完整版 78.2MB 超验收线）。

## 9. 故障排查

| 现象 | 原因与处理 |
|------|-----------|
| 点播放无声 | 浏览器自动播放策略要求用户手势——务必由真实点击触发 `play()`（内部已 `await ctx.resume()`）；开发时也可在站点设置允许音频 |
| 高亮列不动但有声 | `suspended` 恢复失败，查看 `__audioCtx.state`；确认未在 resume 完成前排程 |
| E2E 打到别的应用/端口冲突 | 4173 曾被同机其他项目占用导致误测；本项目固定 4174 且 `reuseExistingServer: false`，勿改回 |
| 刷新后数据丢失 | IndexedDB 按源（origin）隔离——dev(5173)/preview(4174)/docker(8103) 数据互不相通，属预期 |
| 曲牌载入报「未知拟音字」 | patterns.json 用了 instruments.json 不存在的字；或两文件拟音字冲突（`buildGlyphMap` 抛错） |
| 打印字太小 | 打印视图按 A4 横排自适应字号，4/4 曲一行最多折半小节；可在 Print.tsx 调 `pxPerTick` 上限（当前 14） |
