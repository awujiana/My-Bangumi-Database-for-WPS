# 新番表富化功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 BGM 插件中新增独立的「新番表富化」功能，支持打开第三方新番表 Excel 文件，自动识别表头结构，将标签、首播日期、集数、播放平台等数据富化到用户的 Bangumi 追踪表中。

**Architecture:** 采用独立 HTML 页面架构（`enrich.html`），通过 Task Pane 导航进入。核心逻辑分为三层：富化引擎（匹配+写入逻辑）、富化记录表（持久化）、UI 控制器（交互+渲染）。利用现有 WPS COM 接口操作 Excel，复用 syncRecord 模块的设计模式。

**Tech Stack:** TypeScript (strict ES2022), WPS COM API, HTML/CSS, ES Modules

---

## 实施状态总览

| 任务                             | 状态        | 完成日期   |
| -------------------------------- | ----------- | ---------- |
| 任务 1：创建富化记录表模块       | ✅ 已完成   | 2026-08-24 |
| 任务 2：创建富化引擎核心模块     | ✅ 已完成   | 2026-08-24 |
| 任务 3：创建富化页面 HTML 和 CSS | ⏳ 待完成   | —          |
| 任务 4：创建富化页面 UI 控制器   | ⏳ 待完成   | —          |
| 任务 5：集成与注册               | ⏳ 待完成   | —          |
| 任务 6：集成测试与验证           | ✅ 部分完成 | 2026-08-26 |

### 已完成的扩展功能

| 功能                        | 状态 | 说明                                                    |
| --------------------------- | ---- | ------------------------------------------------------- |
| 第二阶段：简介工作表富化    | ✅   | 支持制作人员、声优、原作等字段映射                      |
| 字段映射标注白名单          | ✅   | 编剧→脚本、人设→人物设定、CG导演→演出 标注              |
| 动画制作→动画制作公司不标注 | ✅   | 用户指定不标注                                          |
| 自动添加缺失列              | ✅   | ensureBangumiColumns 自动在末尾添加并复制样式           |
| 数据同步列位置无关性        | ✅   | getColumnMap + COLUMN_RULES 动态定位                    |
| 声优字段支持                | ✅   | COLUMN_RULES + KNOWN_COLUMN_MAP 已添加                  |
| 边界情况修复                | ✅   | parseRemoteContent 空值检查、getAnnotatedValue 空值守卫 |
| 边界测试                    | ✅   | 42 个测试用例全部通过                                   |

---

## 文件结构

### 新增文件

| 文件                      | 职责                                                 |
| ------------------------- | ---------------------------------------------------- |
| `ts/sync/enrichEngine.ts` | 富化核心引擎：列映射识别、双重匹配算法、数据合并规则 |
| `ts/sync/enrichRecord.ts` | 富化记录表操作：创建、写入、查询富化记录             |
| `ts/ui/enrich.ts`         | 富化页面 UI 控制器：状态管理、DOM 操作、事件绑定     |
| `ui/enrich.html`          | 富化页面 HTML 结构                                   |
| `ui/enrich-bootstrap.js`  | 富化页面 ES Module 入口                              |
| `css/enrich.css`          | 富化页面专属样式                                     |

### 修改文件

| 文件          | 修改内容                                 |
| ------------- | ---------------------------------------- |
| `ts/index.ts` | 导出新模块（enrichEngine, enrichRecord） |
| `ribbon.xml`  | 添加「新番表富化」按钮                   |

---

## 任务 1：创建富化记录表模块

**Files:**

- Create: `ts/sync/enrichRecord.ts`

- [ ] **Step 1: 创建 enrichRecord.ts**

创建富化记录表模块，包含：

- 常量定义（表名、列定义、列索引）
- 类型定义（EnrichRecord、AddEnrichRecordParams）
- 核心函数：getOrCreateEnrichRecordSheet、addEnrichRecord、addEnrichRecords、clearEnrichRecords、getAllEnrichRecords
- 辅助函数：getActionColor

具体代码参见设计文档中的 [enrichRecord.ts 实现](file:///d:/编程/awujiana/Excel加载项/BGM/BGM/docs/superpowers/specs/2026-08-24-enrich-engine-design.md)。

- [ ] **Step 2: 验证代码无类型错误**

运行 TypeScript 编译检查，确保无类型错误。

---

## 任务 2：创建富化引擎核心模块

**Files:**

- Create: `ts/sync/enrichEngine.ts`

- [ ] **Step 1: 创建 enrichEngine.ts**

创建富化引擎核心模块，包含：

- 常量：KNOWN_COLUMN_MAP、TAG_SEPARATOR、FEATURE_SEPARATOR
- 类型定义：EnrichColumnMapping、EnrichConfig、MatchResult、EnrichResultItem、EnrichedField、EnrichProgress、ProgressCallback
- 核心函数：detectColumns、matchEntries、enrichEntries
- 辅助函数：normalizeName、splitAliases、findAliasColumn、getBangumiColumnMap、readNewAnimeRow、enrichTags、enrichDate、enrichEpisodes、enrichFeatures、mergeTags、splitTags、appendFeatures

具体代码参见设计文档中的 [enrichEngine.ts 实现](file:///d:/编程/awujiana/Excel加载项/BGM/BGM/docs/superpowers/specs/2026-08-24-enrich-engine-design.md)。

- [ ] **Step 2: 验证代码无类型错误**

运行 TypeScript 编译检查，确保无类型错误。

---

## 任务 3：创建富化页面 HTML 和 CSS

**Files:**

- Create: `ui/enrich.html`
- Create: `css/enrich.css`

- [ ] **Step 1: 创建 enrich.html**

创建富化页面 HTML，包含：

- 头部导航（返回、关闭按钮）
- 步骤指示器（3 步：文件识别 → 匹配预览 → 执行富化）
- 步骤 1：文件选择表单（路径、工作表、表头行号、数据起始行）+ 识别结果展示
- 步骤 2：匹配统计 + 预览表格 + 分页 + 执行按钮
- 步骤 3：进度条 + 进度详情 + 暂停/停止控制
- 富化记录区域
- 手动映射编辑模态框
- 详情查看模态框

- [ ] **Step 2: 创建 enrich.css**

创建富化页面专属样式，包含：

- 步骤指示器样式
- 表单样式
- 识别结果样式
- 匹配统计卡片样式
- 预览表格样式
- 进度条样式
- 富化记录列表样式
- 模态框样式

- [ ] **Step 3: 验证 HTML/CSS 正确性**

检查 HTML 结构和 CSS 类名一致性。

---

## 任务 4：创建富化页面 UI 控制器

**Files:**

- Create: `ts/ui/enrich.ts`
- Create: `ui/enrich-bootstrap.js`

- [ ] **Step 1: 创建 enrich-bootstrap.js**

创建 ES Module 入口脚本，加载并初始化富化页面。

- [ ] **Step 2: 创建 ts/ui/enrich.ts**

创建富化页面 UI 控制器，包含：

- 状态管理接口（EnrichPageState）
- 初始化函数 initEnrichPage
- 文件选择处理
- 自动识别处理
- 列映射显示和手动编辑
- 匹配预览渲染
- 富化执行和进度回调
- 富化记录查看

- [ ] **Step 3: 验证代码无类型错误**

运行 TypeScript 编译检查。

---

## 任务 5：集成与注册

**Files:**

- Modify: `ts/index.ts`
- Modify: `ribbon.xml`

- [ ] **Step 1: 修改 ts/index.ts**

在文件末尾添加新模块的导出：

```typescript
// ============================================================================
// 22. 新番表富化模块（来自 sync/enrichEngine + sync/enrichRecord）
// ============================================================================
export {
  detectColumns,
  matchEntries,
  enrichEntries,
  type EnrichColumnMapping,
  type EnrichConfig,
  type MatchResult,
  type EnrichResultItem,
  type EnrichedField,
  type EnrichProgress,
  type ProgressCallback,
} from './sync/enrichEngine.js'

export {
  getOrCreateEnrichRecordSheet,
  getAllEnrichRecords,
  clearEnrichRecords,
  addEnrichRecord,
  addEnrichRecords,
  type EnrichRecord,
  type AddEnrichRecordParams,
  ENRICH_RECORD_SHEET_NAME,
  ENRICH_RECORD_COLUMNS,
} from './sync/enrichRecord.js'
```

- [ ] **Step 2: 修改 ribbon.xml**

在 `bangumiGroup` 中添加新按钮：

```xml
<button id="btnEnrichAnime" label="新番表富化" onAction="OnAction" getImage="GetBangumiImage" size="large"/>
```

- [ ] **Step 3: 在 UI 事件处理器中注册富化按钮**

修改 `ts/ui/handlers/index.ts`，添加对 `btnEnrichAnime` 的处理：打开 `enrich.html` 页面。

---

## 任务 6：集成测试与验证

**Files:**

- No new files

- [ ] **Step 1: 单元测试匹配算法**

使用测试用例验证：

- 精确匹配：新番表名称与 Bangumi 名称完全一致
- 别名匹配：新番表名称在 Bangumi 别名中找到
- 未匹配：不存在的名称
- 空值处理：新番表或 Bangumi 表为空

- [ ] **Step 2: 单元测试富化规则**

验证：

- 标签追加：现有标签 + 新标签去重合并
- 首播空值填充：Bangumi 为空时写入，已有值时跳过
- 集数空值填充：同上
- 特点/印象追加：周更/平台/独播/特殊信息追加

- [ ] **Step 3: 端到端集成测试**

使用目标文件 `2026年4月新番表v2.13 byHazx.xlsx` 测试：

1. 打开新番表文件
2. 自动识别表头
3. 预览匹配结果
4. 执行富化
5. 验证 Bangumi 追踪表数据已更新
6. 检查富化记录表

- [ ] **Step 4: 验证富化记录表**

确认：

- 记录表自动创建
- 列结构正确
- 记录内容完整
- 操作类型颜色标记正确

---

## 任务 7：工作簿选择与锁定机制

**Files:**

- Create: `ts/sync/enrichLock.ts` — 工作簿锁定核心逻辑
- Modify: `ts/sync/enrichEngine.ts` — 集成锁定状态
- Modify: `ts/index.ts` — 导出新模块
- Modify: `dist-ts/index.d.ts` — 添加 BGM.enrich 类型定义

- [ ] **Step 1: 创建 enrichLock.ts 核心模块**

创建工作簿锁定模块，包含：

- 类型定义：`EnrichWorkbookState`、`EnrichLockedInfo`
- 常量：`ENRICH_LOCK_STORAGE_KEY = 'bgm_enrich_locked_workbook'`
- 核心函数：
  - `refreshEnrichWorkbooks()` — 刷新工作簿列表
  - `refreshEnrichSheets(workbookName?)` — 刷新工作表列表
  - `toggleEnrichWorkbookLock()` — 切换锁定状态
  - `saveEnrichLockedWorkbook(info)` — 持久化到 PluginStorage
  - `restoreEnrichLockedWorkbook()` — 启动时恢复+校验
  - `getLockedEnrichSheet()` — 获取锁定的 [工作簿, 工作表]
  - `findSheetInWorkbook(wbName, sheetName)` — 跨工作簿查找工作表
- 辅助函数：
  - `updateEnrichLockButton()` — 更新锁定按钮 UI
  - `updateEnrichLockStatus()` — 更新锁定状态显示

- [ ] **Step 2: 更新 BGM 命名空间类型**

在 `dist-ts/index.d.ts` 中添加 `BGM.enrich` 命名空间：

```typescript
namespace BGM {
  const enrich: {
    workbook: {
      lockedWorkbookName: string | null
      lockedSheetName: string | null
      isLocked: boolean
      lockedSheetIndex: number | null
    }
  }
}
```

- [ ] **Step 3: 集成到 enrichEngine**

修改 `enrichEntries()` 和 `matchEntries()` 函数：

- 新增 `targetWorkbookName` 参数支持
- 执行前优先从锁定状态获取目标工作表
- 跨工作簿场景下使用 `findSheetInWorkbook` 查找

- [ ] **Step 4: 添加 UI 区域**

在 `ui/enrich.html` 中添加目标 Bangumi 追踪表选择区域：

```html
<div class="enrich-target-section">
  <div class="enrich-section-title">🎯 目标 Bangumi 追踪表</div>
  <div class="enrich-form-row">
    <label>工作簿：</label>
    <select id="enrichWorkbookSelect">
      ...
    </select>
    <button id="enrichLockBtn">🔒 锁定</button>
  </div>
  <div class="enrich-form-row">
    <label>工作表：</label>
    <select id="enrichSheetSelect">
      ...
    </select>
    <button>🔄 刷新</button>
  </div>
  <div id="enrichLockStatus">...</div>
</div>
```

- [ ] **Step 5: 添加单元测试**

创建测试用例：

- `toggleEnrichWorkbookLock` 锁定/解锁切换
- `restoreEnrichLockedWorkbook` 恢复与校验（工作簿存在/不存在）
- `findSheetInWorkbook` 跨工作簿查找
- 锁定状态与 Taskpane 锁定独立性

- [ ] **Step 6: 验证代码无类型错误**

运行 TypeScript 编译检查，确保无类型错误。

---

## 风险与缓解

| 风险                         | 缓解措施                            |
| ---------------------------- | ----------------------------------- |
| 新番表列名不规范导致识别失败 | 提供手动调整列映射功能              |
| 大文件处理超时               | 分批次处理 + 进度回调 + 可取消      |
| 名称匹配误判                 | 支持预览后确认，提供精确/别名标记   |
| WPS COM 性能瓶颈             | 使用 ScreenUpdating 暂停屏幕刷新    |
| 锁定的工作簿被关闭导致失效   | 启动时校验 + 运行时自动检测         |
| Taskpane 锁定与富化锁定冲突  | 使用独立 PluginStorage 键，互不干扰 |

---

## 提交规范

每个任务完成后执行：

```bash
git add <files>
git commit -m "feat: <task description>"
```

示例：

```bash
git add ts/sync/enrichRecord.ts
git commit -m "feat: 新增富化记录表模块"
```
