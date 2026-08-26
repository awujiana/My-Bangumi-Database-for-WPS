# 新番表富化功能设计文档

**创建日期**: 2026-08-24
**版本**: 2.2（+ 边界情况加固）
**状态**: 已实现 + 待 UI 集成

## 1. 概述

为 BGM 插件新增独立的「新番表富化」功能，支持打开第三方新番表 Excel 文件（如 Hazx 版新番表），自动识别表头结构，将标签、首播日期、集数、播放平台等数据富化到用户的 Bangumi 追踪表中。

### 1.1 核心目标

1. **文件识别**：支持打开指定路径的 Excel 文件，自动识别工作表和表头结构
2. **智能匹配**：通过名称+别名双重匹配，将新番表条目与 Bangumi 追踪表条目关联
3. **数据富化**：将新番表的标签、首播时间、集数、播放平台等字段合并到追踪表
4. **独立页面**：在独立的 HTML 页面中完成所有操作，与现有 Task Pane 完全隔离
5. **操作记录**：富化操作写入独立的富化记录表，支持追溯和审计

### 1.2 技术约束

- 与现有代码库保持一致的 TypeScript 严格模式
- 遵循项目已有的分层架构（UI → Service → Data → Infra）
- 所有用户输入和外部数据经过运行时校验（zod schema）
- 请求/操作可取消，防止资源泄漏

## 2. 文件结构

### 2.1 新增文件

```
BGM/
├── ui/
│   ├── enrich.html              # 富化页面 HTML
│   └── enrich-bootstrap.js       # 富化页面入口脚本
├── ts/
│   ├── ui/
│   │   └── enrich.ts             # 富化页面 UI 控制器（新建）
│   ├── sync/
│   │   ├── enrichEngine.ts       # 富化核心引擎（新建）
│   │   └── enrichRecord.ts       # 富化记录表操作（新建）
│   └── index.ts                  # 更新：导出新模块
└── css/
    └── enrich.css                # 富化页面专属样式（新建）
```

### 2.2 修改文件

- `manifest.xml` — 注册新的 Task Pane 入口
- `ribbon.xml` — 添加富化功能按钮
- `ts/index.ts` — 导出新模块
- `css/styles.css` — 可能需要的通用样式调整

## 3. 页面设计

### 3.1 页面布局

```
┌─────────────────────────────────────────────┐
│ 📺 新番表富化工具          [← 返回] [✕]       │
├─────────────────────────────────────────────┤
│                                             │
│ 🎯 目标 Bangumi 追踪表                      │
│ ┌─────────────────────────────────────────┐ │
│ │ 📁 工作簿:   [当前活动工作簿 ▼]  [🔒锁定] │ │
│ │ 📑 工作表:   [Bangumi追踪表 ▼]  [🔄 刷新] │ │
│ │ 📊 状态:     ✅ 已锁定: Bangumi.xlsx      │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 📂 新番表文件选择与识别                      │
│ ┌─────────────────────────────────────────┐ │
│ │ 📁 文件路径: [_________________________] │ │
│ │ 📑 工作表:   [2026年4月新番表 ▼]       │ │
│ │ 🔢 表头行号: [2]  数据起始行: [5]      │ │
│ │ [🔍 自动识别] [📁 选择文件] [🔄 刷新]  │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 📋 识别结果（可手动调整映射）                 │
│ ┌─────────────────────────────────────────┐ │
│ │ 已识别列:                                │ │
│ │ 名称→列3 | 标签→列14 | 首播→列11        │ │
│ │ 集数→列12 | 周更→列4 | 平台→列6         │ │
│ │ 独播→列10 | 特殊→列13                   │ │
│ │ [✏️ 手动调整映射]                         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 🔍 匹配预览                                 │
│ ┌─────────────────────────────────────────┐ │
│ │ 总计: 136  ✅精确: 85  🔄别名: 13        │ │
│ │  ⚠️未匹配: 38  ❌错误: 0                 │ │
│ │ ┌───┬──────┬────┬──────────────────┐   │ │
│ │ │#  │名称    │方式│富化字段          │   │ │
│ │ ├───┼──────┼────┼──────────────────┤   │ │
│ │ │1  │淫狱团地│精确│标签/首播/集数/... │   │ │
│ │ │2  │欺诈游戏│别名│首播/集数/特点    │   │ │
│ │ │...│       │    │                  │   │ │
│ │ └───┴──────┴────┴──────────────────┘   │ │
│ │ [📤 执行富化] [📊 查看全部]              │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 📊 富化进度                                 │
│ ┌██████████████████░░░░░░ 75% ▐ 98/136 ─┐ │
│ │ 当前: 尖帽子的魔法工房                   │ │
│ │ ✅75  ⚠️20  ❌3  ⏱️ 12.3s  预计 4.1s   │ │
│ │ [⏸️ 暂停] [⏹️ 停止]                     │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 📜 富化记录  [📋 全部] [🗑️ 清除]            │
│ ┌─────────────────────────────────────────┐ │
│ │ 15:30  ✅ 淫狱团地   标签+首播+集数富化  │ │
│ │ 15:30  ✅ 欺诈游戏   首播+集数追加       │ │
│ │ ...                                     │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 3.2 交互流程

1. **进入页面**：点击 Ribbon 按钮或 Task Pane 链接进入
2. **确认目标 Bangumi 追踪表**：
   - 若已锁定工作簿，自动选中锁定的工作簿和工作表
   - 若未锁定，从下拉框选择目标工作簿和工作表
   - 点击「🔒 锁定」保存选择，下次自动恢复
3. **选择新番表文件**：通过文件对话框选择 .xlsx 文件，或手动输入路径
4. **自动识别**：点击「🔍 自动识别」解析新番表表头结构
5. **调整映射**：确认或手动调整列映射
6. **匹配预览**：查看匹配结果，确认无误
7. **执行富化**：点击「📤 执行富化」开始处理
8. **查看记录**：富化完成后查看记录

## 4. 核心引擎设计

### 4.1 富化引擎流程

```
enrichEngine.ts
├── parseFile(filePath) → ParsedSheet
│   ├── 打开 Excel 文件
│   ├── 读取所有工作表名称
│   └── 解析指定工作表的表头和数据
│
├── detectColumns(headerRow) → EnrichColumnMapping
│   ├── 扫描表头行，识别已知列名
│   └── 返回列映射配置
│
├── matchEntries(bangumiSheet, newAnimeSheet) → MatchResult[]
│   ├── 精确匹配: 名称 == 名称
│   ├── 别名匹配: 名称 ∈ 别名
│   └── 返回匹配结果列表
│
├── enrichEntries(matchResults, config) → EnrichResult[]
│   ├── 遍历匹配结果
│   ├── 按字段映射执行富化
│   ├── 应用冲突策略
│   └── 记录富化日志
│
└── writeEnrichRecord(results) → void
    └── 写入富化记录表
```

### 4.2 匹配算法

```typescript
// 双重匹配策略
function matchEntries(bangumiRows: BangumiRow[], newAnimeRows: NewAnimeRow[]): MatchResult[] {
  const bangumiMap = new Map<string, BangumiRow>()
  const aliasMap = new Map<string, BangumiRow>()

  // 构建 Bangumi 追踪表索引
  for (const row of bangumiRows) {
    // 精确匹配索引
    bangumiMap.set(row.name, row)
    // 别名索引（支持 |、/、; 分隔）
    for (const alias of splitAliases(row.aliases)) {
      aliasMap.set(alias, row)
    }
  }

  const results: MatchResult[] = []
  for (const newRow of newAnimeRows) {
    // 1. 精确匹配
    if (bangumiMap.has(newRow.name)) {
      results.push({ matchType: 'exact', bangumiRow: bangumiMap.get(newRow.name)! })
    }
    // 2. 别名匹配
    else if (aliasMap.has(newRow.name)) {
      results.push({ matchType: 'alias', bangumiRow: aliasMap.get(newRow.name)! })
    }
    // 3. 未匹配
    else {
      results.push({ matchType: 'unmatched' })
    }
  }
  return results
}
```

### 4.3 富化规则

#### 4.3.1 第一阶段：新番表主工作表富化

| 新番表字段  | Bangumi 追踪表目标列 | 冲突策略                  | 说明               |
| ----------- | -------------------- | ------------------------- | ------------------ |
| 名称        | —                    | 匹配用                    | 不写入             |
| 标签 (TAGS) | 标签/分级列          | 追加 `现有 \| 新标签`     | 去重合并           |
| 首播        | 开播日期列           | 空值填充                  | 仅当目标为空时写入 |
| 集数        | 集数列               | 空值填充                  | 仅当目标为空时写入 |
| 周更时间    | 特点/印象列          | 追加 `现有 \| 周更: 周一` | 去重合并           |
| 播放平台    | 特点/印象列          | 追加 `现有 \| 平台: ...`  | 去重合并           |
| 独播        | 特点/印象列          | 追加 `现有 \| 独播: ...`  | 去重合并           |
| 特殊        | 特点/印象列          | 追加 `现有 \| 特殊: ...`  | 去重合并           |

#### 4.3.2 第二阶段：简介工作表富化

简介工作表（如"2026年4月新番简介"）提供制作人员、声优、原作等详细信息。
通过 `isIntroSheet()` 自动检测是否为简介工作表。

**字段映射表**：

| 简介工作表字段 | Bangumi 追踪表列 | 标注处理               | 说明                  |
| -------------- | ---------------- | ---------------------- | --------------------- |
| 导演           | 导演             | 不标注（同名）         | 直接写入              |
| 编剧           | 脚本             | ✅ 标注 `值(编剧)`     | 源字段名→目标列名不同 |
| 人设           | 人物设定         | ✅ 标注 `值(人设)`     | 源字段名→目标列名不同 |
| CG导演         | 演出             | ✅ 标注 `值(CG导演)`   | 源字段名→目标列名不同 |
| 音乐           | 音乐             | 不标注（同名）         | 直接写入              |
| 动画制作       | 动画制作公司     | **不标注**（用户指定） | 映射到公司列          |
| 系列构成       | 系列构成         | 不标注（同名）         | 直接写入              |
| 分镜           | 分镜             | 不标注（同名）         | 直接写入              |
| 原作           | 原作             | 不标注（同名）         | 直接写入              |
| 语言           | 语言             | 不标注（同名）         | 直接写入              |
| 制片国家       | 制片国家         | 不标注（同名）         | 直接写入              |
| 声优           | 声优             | 不标注（同名）         | 直接写入（需新增列）  |

**标注白名单机制**：

```typescript
const ANNOTATED_FIELD_MAPPINGS = new Set<string>(['编剧→脚本', '人设→人物设定', 'CG导演→演出'])

function getAnnotatedValue(sourceKey: string, targetColName: string, value: string): string {
  if (!value) return value // 空值不添加标注
  if (sourceKey === targetColName) return value // 同名不标注
  const mappingKey = `${sourceKey}→${targetColName}`
  if (!ANNOTATED_FIELD_MAPPINGS.has(mappingKey)) return value
  return `${value}(${sourceKey})` // 白名单映射添加标注
}
```

**自动添加缺失列**：

`ensureBangumiColumns()` 会自动检测 Bangumi 追踪表中缺失的列，在最后添加并从现有列复制样式：

```typescript
// 列映射常量（COLUMN_RULES）已添加声优等字段
[/声优|配音|cv/i, '声优'],
[/角色设定|人物设定|人设/, '人物设定'],
```

### 4.4 字段映射自动识别

#### 4.4.1 新番表列名映射

```typescript
// 已知列名映射表（用于自动识别表头）
const KNOWN_COLUMN_MAP: Record<string, keyof EnrichColumnMapping> = {
  名称: 'nameCol',
  动漫名称: 'nameCol',
  番组名: 'nameCol',
  TAGS: 'tagsCol',
  标签: 'tagsCol',
  分类: 'tagsCol',
  首播: 'premiereCol',
  开播: 'premiereCol',
  播出日期: 'premiereCol',
  集数: 'episodesCol',
  话数: 'episodesCol',
  周更时间: 'weekdayCol',
  播出时间: 'weekdayCol',
  播放平台: 'platformCol',
  平台: 'platformCol',
  独播: 'exclusiveCol',
  特殊: 'specialCol',
  备注: 'specialCol',
  // 简介工作表列名
  简介: 'introCol',
  剧情简介: 'introCol',
  动画制作: 'studioCol',
  制作公司: 'studioCol',
  导演: 'directorCol',
  监督: 'directorCol',
  音乐: 'musicCol',
  配乐: 'musicCol',
  声优: 'voiceCol',
  声优阵容: 'voiceCol',
  OP: 'opCol',
  ED: 'edCol',
  PV: 'pvCol',
  // 简介专有列
  编剧: 'screenplayCol',
  脚本: 'screenplayCol',
  人设: 'characterDesignCol',
  人物设定: 'characterDesignCol',
  CG导演: 'cgDirectorCol',
  演出: 'cgDirectorCol',
  系列构成: 'seriesCompositionCol',
  分镜: 'storyboardCol',
  原作: 'originalWorkCol',
  语言: 'languageCol',
  制片国家: 'productionCountryCol',
  类型: 'typeCol',
}
```

#### 4.4.2 Bangumi 追踪表列识别（COLUMN_RULES）

使用正则匹配表头文本，动态定位列位置，**不受列顺序变化影响**：

```typescript
const COLUMN_RULES: [RegExp, string][] = [
  // URL / ID
  [/bangumi.*url/i, 'Bangumi_URL'],
  // 状态/日期
  [/是否看完|观看状态|状态/, '是否看完'],
  [/开播日期|首播/, '开播日期'],
  // 标签/分级
  [/原作标签/, '原作标签'],
  [/标签\/分级|标签|分级/, '标签/分级'],
  [/特点\/印象|特点|印象/, '特点/印象'],
  // 制作人员
  [/人物设定|人设|角色设计/, '人物设定'],
  [/系列构成/, '系列构成'],
  [/集数|总集/, '集数'],
  [/动画制作公司/, '动画制作公司'],
  [/导演|director/i, '导演'],
  [/音乐|music/i, '音乐'],
  [/脚本|编剧|剧本/, '脚本'],
  [/声优|配音|cv/i, '声优'], // 新增
  // 其他
  [/序列号|序号/, '序列号'],
  // ... 更多规则
]
```

#### 4.4.3 数据同步字段映射（EXTENDED_FIELD_MAP）

远程 JSONL 字段 → Excel 列名映射，用于数据同步功能：

```typescript
export const EXTENDED_FIELD_MAP: ReadonlyArray<readonly [string, string]> = [
  ['date', '开播日期'],
  ['播放结束', '完播日'],
  ['动画制作公司', '制作公司'],
  ['片长', '时长'],
  ['制片国家', '制片国家'],
  ['语言', '语言'],
  ['类型', '类型'],
  ['导演', '导演'],
  ['音乐', '音乐'],
  ['人物设定', '人物设定'],
  ['原作', '原作'],
  ['脚本', '脚本'],
  ['分镜', '分镜'],
  ['演出', '演出'],
  ['原案', '原案'],
  ['系列构成', '系列构成'],
  ['在线播放平台', '在线播放平台'],
  ['关联的动漫ID', '关联的动漫ID'],
] as const
```

## 5. 数据结构

### 5.1 核心接口

```typescript
// 新番表列映射配置
interface EnrichColumnMapping {
  nameCol: number
  tagsCol?: number
  premiereCol?: number
  episodesCol?: number
  weekdayCol?: number
  platformCol?: number
  exclusiveCol?: number
  specialCol?: number
}

// 富化配置
interface EnrichConfig {
  filePath: string
  sheetName: string
  headerRow: number
  dataStartRow: number
  columnMapping: EnrichColumnMapping
  targetSheetName?: string // Bangumi 追踪表工作表名
  targetWorkbookName?: string // Bangumi 追踪表工作簿名（新增：支持跨工作簿）
}

// 富化工作簿锁定状态
interface EnrichWorkbookState {
  lockedWorkbookName: string | null
  lockedSheetName: string | null
  isLocked: boolean
  lockedSheetIndex: number | null
}

// 锁定信息（用于 PluginStorage 持久化）
interface EnrichLockedInfo {
  workbookName: string
  sheetName: string
  sheetIndex: number
}

// 匹配结果
interface MatchResult {
  kind: 'exact' | 'alias' | 'unmatched' | 'error'
  newAnimeRow: number
  newAnimeName: string
  bangumiRow?: number
  bangumiName?: string
  aliases?: string[]
}

// 富化结果项
interface EnrichResultItem {
  kind: 'matched' | 'unmatched' | 'error'
  newAnimeRow: number
  name: string
  matchType?: 'exact' | 'alias'
  enrichedFields: EnrichedField[]
  errorMessage?: string
}

interface EnrichedField {
  fieldName: string
  bangumiColumn: number
  oldValue: string | null
  newValue: string
  action: 'fill' | 'append' | 'skip'
}

// 富化进度回调
interface EnrichProgress {
  current: number
  total: number
  currentName: string
  stats: {
    matched: number
    enriched: number
    skipped: number
    failed: number
  }
  etaMs: number
}
```

### 5.2 富化记录表结构

富化记录表自动创建在当前工作簿中，命名为 `富化记录`：

| 列       | 说明                   |
| -------- | ---------------------- |
| 时间戳   | 操作时间               |
| 匹配方式 | 精确/别名              |
| 动漫名称 | 新番表中的名称         |
| 行号     | Bangumi 追踪表中的行号 |
| 富化字段 | 富化了哪些字段         |
| 原字段   | 富化前的值             |
| 新字段   | 富化后的值             |
| 操作类型 | fill/append/skip/error |
| 备注     | 其他信息               |

## 6. 分层架构

### 6.1 分层模型

```
┌──────────────────────────────────────────────┐
│  视图层 (enrich.html + enrich.ts)             │
│  页面渲染、用户交互、表单验证                    │
├──────────────────────────────────────────────┤
│  富化服务层 (enrichEngine.ts)                 │
│  匹配算法、富化规则、进度追踪                    │
├──────────────────────────────────────────────┤
│  数据访问层 (enrichRecord.ts)                 │
│  富化记录表读写、状态管理                        │
├──────────────────────────────────────────────┤
│  基础设施层 (复用现有模块)                      │
│  WPS 接口、日志、配置、事件总线                  │
└──────────────────────────────────────────────┘
```

### 6.2 依赖方向

```
enrich.html → enrich.ts → enrichEngine.ts → wps.ts / logger.ts
                                       ↘
                                        enrichRecord.ts → wps.ts
```

## 7. 错误处理

### 7.1 错误分类

| 错误类型           | 处理方式             | 用户提示                              |
| ------------------ | -------------------- | ------------------------------------- |
| 文件不存在         | 捕获并提示           | "文件路径无效，请检查"                |
| 文件格式错误       | 捕获并提示           | "无法解析此文件，请确认是 .xlsx 格式" |
| 工作表不存在       | 捕获并提示           | "未找到指定工作表"                    |
| Bangumi 追踪表为空 | 捕获并提示           | "当前工作表无 Bangumi 追踪数据"       |
| 名称匹配失败       | 记录日志，不中断     | 标记为"未匹配"                        |
| 写入失败           | 回滚当前行，继续处理 | 记录错误日志                          |
| 用户中途取消       | 暂停写入，保留进度   | "已取消，已富化的数据已保存"          |

### 7.2 资源清理

- 富化引擎创建的临时对象（Map、数组）在操作完成后释放
- 进度计时器在操作取消/完成时清除
- WPS ScreenUpdating 在操作完成时恢复

### 7.3 工作簿选择与锁定机制

#### 7.3.1 设计目标

富化功能需要支持从**任意打开的工作簿**中选择 Bangumi 追踪表作为目标，而非仅限于当前活动工作簿。选择后可锁定，确保后续富化操作始终写入同一目标。

#### 7.3.2 状态管理

富化工作簿锁定状态存储在 `BGM.enrich` 命名空间中，与 Taskpane 的 `BGM.sheet` 锁定状态独立：

```typescript
// BGM 命名空间扩展
namespace BGM {
  const enrich: {
    workbook: EnrichWorkbookState
  }
}
```

PluginStorage 持久化键：`bgm_enrich_locked_workbook`

#### 7.3.3 核心函数

```typescript
/**
 * 刷新工作簿列表（所有打开的 Excel 工作簿）
 * 填充 workbookSelect 下拉框
 */
export function refreshEnrichWorkbooks(): void

/**
 * 刷新指定工作簿的工作表列表
 * @param workbookName 目标工作簿名称，null 表示当前活动工作簿
 */
export function refreshEnrichSheets(workbookName?: string | null): void

/**
 * 切换工作簿锁定状态
 * 锁定：保存当前选中的工作簿+工作表到 PluginStorage
 * 解锁：清除锁定信息
 */
export function toggleEnrichWorkbookLock(): void

/**
 * 保存锁定信息到 PluginStorage
 */
export function saveEnrichLockedWorkbook(info: EnrichLockedInfo | null): void

/**
 * 启动时恢复锁定状态
 * 验证锁定的工作簿是否仍存在，不存在则清除
 * @returns 是否成功恢复
 */
export function restoreEnrichLockedWorkbook(): boolean

/**
 * 获取锁定的 Bangumi 追踪表工作表引用
 * @returns [工作簿, 工作表] 或 null
 */
export function getLockedEnrichSheet(): [WpsWorkbook, WpsWorksheet] | null
```

#### 7.3.4 锁定状态流转

```
┌──────────────┐  用户选择工作簿   ┌──────────────┐
│  未锁定状态   │ ──────────────→  │  已锁定状态   │
│              │  + 锁定按钮      │              │
│ - 默认活动WB │                 │ - 持久化存储  │
│ - 无持久化   │                 │ - 启动恢复    │
└──────────────┘                 └──────────────┘
       ↑                               │
       │          用户点击解锁          │
       └───────────────────────────────┘
```

#### 7.3.5 启动恢复与校验

```typescript
export function restoreEnrichLockedWorkbook(): boolean {
  const app = getApp()
  if (!app?.PluginStorage) return false

  const raw = app.PluginStorage.getItem('bgm_enrich_locked_workbook')
  if (!raw) return false

  try {
    const info = JSON.parse(raw) as EnrichLockedInfo

    // 验证锁定的工作簿是否仍然存在
    if (app.Workbooks) {
      let workbookFound = false
      for (let i = 1; i <= app.Workbooks.Count; i++) {
        if (app.Workbooks.Item(i).Name === info.workbookName) {
          workbookFound = true
          break
        }
      }
      if (!workbookFound) {
        // 工作簿已关闭，清除锁信息
        saveEnrichLockedWorkbook(null)
        return false
      }
    }

    // 恢复状态
    BGM.enrich.workbook = {
      lockedWorkbookName: info.workbookName,
      lockedSheetName: info.sheetName,
      lockedSheetIndex: info.sheetIndex,
      isLocked: true,
    }
    return true
  } catch {
    saveEnrichLockedWorkbook(null)
    return false
  }
}
```

#### 7.3.6 与富化引擎集成

`enrichEntries()` 和 `matchEntries()` 函数在执行前，优先从锁定状态获取目标工作表：

```typescript
export function enrichEntries(
  newAnimeSheet: WpsWorksheet,
  config: EnrichConfig,
  progressCb?: ProgressCallback,
): EnrichResult[] {
  // 若配置中未指定目标工作簿，尝试从锁定状态获取
  let bangumiSheet: WpsWorksheet
  if (config.targetWorkbookName) {
    const locked = getLockedEnrichSheet()
    if (locked) {
      bangumiSheet = locked[1] // 使用锁定的工作表
    } else {
      // 跨工作簿查找指定工作表
      bangumiSheet = findSheetInWorkbook(config.targetWorkbookName, config.targetSheetName)
    }
  } else {
    // 使用当前活动工作表（兼容旧逻辑）
    bangumiSheet = getApp()?.ActiveWorkbook?.ActiveSheet as WpsWorksheet
  }

  // ... 执行富化逻辑
}
```

#### 7.3.7 UI 组件结构

```html
<!-- 目标 Bangumi 追踪表选择区域 -->
<div class="enrich-target-section">
  <div class="enrich-section-title">🎯 目标 Bangumi 追踪表</div>
  <div class="enrich-form-row">
    <label>工作簿：</label>
    <select id="enrichWorkbookSelect" onchange="onEnrichWorkbookChange()">
      <option value="">-- 当前活动工作簿 --</option>
      <!-- 动态填充：所有打开的 Excel 工作簿 -->
    </select>
    <button id="enrichLockBtn" onclick="toggleEnrichWorkbookLock()">🔒 锁定</button>
  </div>
  <div class="enrich-form-row">
    <label>工作表：</label>
    <select id="enrichSheetSelect">
      <option value="">-- 请选择 --</option>
      <!-- 动态填充：所选工作簿的工作表 -->
    </select>
    <button onclick="refreshEnrichSheets()">🔄 刷新</button>
  </div>
  <div id="enrichLockStatus" class="enrich-lock-status" style="display:none;">
    ✅ 已锁定: <span id="enrichLockStatusText"></span>
  </div>
</div>
```

#### 7.3.8 与 Taskpane 锁定的对比

| 特性             | Taskpane 锁定            | 富化功能锁定                 |
| ---------------- | ------------------------ | ---------------------------- |
| PluginStorage 键 | `bgm_locked_sheet`       | `bgm_enrich_locked_workbook` |
| 目标对象         | Bangumi 追踪表工作表     | Bangumi 追踪表工作簿+工作表  |
| 跨工作簿         | 不支持（仅限当前活动WB） | **支持**（任意打开的WB）     |
| 自动恢复         | 启动时恢复               | 进入富化页面时恢复           |
| 影响范围         | 主 Taskpane 所有操作     | 仅富化功能                   |
| 解锁影响         | 不影响富化锁定           | 不影响 Taskpane 锁定         |

#### 7.3.9 边界情况处理

| 场景                       | 处理方式                                                                 |
| -------------------------- | ------------------------------------------------------------------------ |
| 锁定的工作簿被关闭         | 清除锁定状态，提示"锁定的工作簿已关闭"                                   |
| 锁定的工作表被删除         | 清除锁定状态，提示"锁定的工作表已被删除"                                 |
| 切换工作簿后工作表列表变化 | 重新加载工作表列表，若之前锁定的工作表不存在则清除锁定                   |
| 无任何工作簿打开           | 禁用下拉框，提示"请先打开包含 Bangumi 追踪表的工作簿"                    |
| 锁定后新增工作簿           | 不影响锁定状态，仅在下拉框中显示新工作簿                                 |
| WPS API 返回 null          | `Workbooks.Item(i)` 和 `Worksheets.Item(i)` 均添加 null 检查，跳过无效项 |
| PluginStorage 不可用       | 记录警告日志，返回 false，不影响功能继续使用                             |
| 持久化数据损坏             | JSON 解析失败时自动清除锁定状态，降级为未锁定模式                        |
| 重复锁定同一目标           | 自动切换为解锁状态，清除所有锁定信息                                     |

## 8. 测试策略

### 8.1 单元测试

- `enrichEngine.boundary.test.ts`：边界情况测试（42 个用例）
  - `normalizeName` 空值/特殊字符处理
  - `splitAliases`/`splitTags` 分隔符识别
  - `mergeTags`/`appendFeatures` 去重逻辑
  - `parseRemoteContent` 空值/格式异常处理
  - 标注白名单机制验证
- `enrichLock.test.ts`：工作簿锁定模块测试（43 个用例）
  - `refreshEnrichWorkbooks` 工作簿列表刷新
  - `refreshEnrichSheets` 工作表列表刷新
  - `toggleEnrichWorkbookLock` 锁定/解锁切换
  - `updateEnrichLockButton` 按钮状态更新
  - `saveEnrichLockedWorkbook` 持久化存储
  - `restoreEnrichLockedWorkbook` 启动恢复与校验
  - `getLockedEnrichSheet` 获取锁定工作表引用
  - `findWorkbookByName` / `findSheetInWorkbook` 辅助函数
  - `initEnrichLock` 初始化流程
  - WPS API null 返回安全处理
  - 锁定状态失效自动清除
- `enrichEngine.test.ts`：富化引擎核心测试
  - `getLockedEnrichSheet` 锁定状态获取
  - `restoreEnrichLockedWorkbook` 恢复与校验
  - `toggleEnrichWorkbookLock` 锁定/解锁切换
  - `saveEnrichLockedWorkbook` 持久化
  - 跨工作簿工作表查找 `findSheetInWorkbook`
- `githubSync.test.ts`：数据同步核心逻辑
- `githubSyncDiff.test.ts`：差异计算和字段映射

### 8.2 列位置无关性验证

数据同步功能通过以下机制保证不受列位置变化影响：

| 组件                 | 工作方式                                   | 验证      |
| -------------------- | ------------------------------------------ | --------- |
| `getColumnMap`       | 扫描表头行，用 `COLUMN_RULES` 正则匹配列名 | ✅ 已验证 |
| `githubSync.ts`      | 使用 `colMap.get(key)` 动态获取列号        | ✅ 已验证 |
| `EXTENDED_FIELD_MAP` | 定义远程字段→Excel列名映射                 | ✅ 已验证 |

**验证方法**：

1. 调整工作表列顺序后，运行同步功能
2. 验证数据正确写入对应列（而非原位置）
3. 确认新增列能被正确识别和写入

### 8.3 集成测试

- 使用目标文件 `2026年4月新番表v2.13 byHazx.xlsx` 进行端到端测试
- 验证富化结果写入正确
- 验证记录表完整记录
- 验证标注白名单行为符合预期
- **工作簿锁定集成测试**：
  - 跨工作簿选择 Bangumi 追踪表并锁定
  - 关闭锁定的工作簿后验证自动清除锁定
  - 重新打开工作簿后验证恢复失败的提示
  - 锁定状态在页面刷新后正确恢复
  - Taskpane 锁定与富化锁定互不干扰

### 8.4 边界与异常测试

- 空文件/空工作表
- Bangumi 追踪表为空
- 特殊字符名称匹配
- 用户中途取消
- `parseRemoteContent` null/undefined 输入
- `getAnnotatedValue` 空值处理
- 纯空行 JSONL 文件
- 行列数不匹配的 CSV 数据
- 工作簿锁定失效自动清除
- PluginStorage 不可用降级处理
- JSON 损坏恢复机制
- WPS API Item() 返回 null 安全跳过
- 重复锁定同一目标切换为解锁

## 9. 实施计划

### 阶段划分

1. **阶段 1**：核心引擎（enrichEngine.ts + enrichRecord.ts）
   - 匹配算法实现
   - 富化规则实现
   - 记录表操作
   - 单元测试

2. **阶段 2**：UI 页面（enrich.html + enrich.ts + enrich.css）
   - 页面布局实现
   - 文件选择与识别
   - 匹配预览表格
   - 进度条实现

3. **阶段 3**：集成与注册
   - manifest.xml 注册
   - ribbon.xml 入口
   - 端到端测试
   - 文档更新

### 风险与缓解

| 风险                         | 缓解措施                          |
| ---------------------------- | --------------------------------- |
| 新番表列名不规范导致识别失败 | 提供手动调整列映射功能            |
| 大文件处理超时               | 分批次处理 + 进度回调 + 可取消    |
| 名称匹配误判                 | 支持预览后确认，提供精确/别名标记 |
| WPS COM 性能瓶颈             | 使用 ScreenUpdating 暂停屏幕刷新  |

## 10. 未来扩展

- 支持更多新番表格式（季度新番、月刊等）
- 支持自定义列映射模板保存
- 富化数据的撤销/回滚功能
- 与 Bangumi API 自动关联 SID
- 批量富化多个文件
