# 新番表富化功能设计文档

**创建日期**: 2026-08-24
**状态**: 已批准
**版本**: 1.0

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
│ 📂 文件选择与识别                            │
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
2. **选择文件**：通过文件对话框选择 .xlsx 文件，或手动输入路径
3. **自动识别**：点击「🔍 自动识别」解析表头结构
4. **调整映射**：确认或手动调整列映射
5. **匹配预览**：查看匹配结果，确认无误
6. **执行富化**：点击「📤 执行富化」开始处理
7. **查看记录**：富化完成后查看记录

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

| 新番表字段  | Bangumi 追踪表目标列 | 冲突策略                  | 说明               |
| ----------- | -------------------- | ------------------------- | ------------------ |
| 名称        | —                    | 匹配用                    | 不写入             |
| 标签 (TAGS) | 标签列               | 追加 `现有 / 新标签`      | 去重合并           |
| 首播        | 开播日期列           | 空值填充                  | 仅当目标为空时写入 |
| 集数        | 集数列               | 空值填充                  | 仅当目标为空时写入 |
| 周更时间    | 特点/印象列          | 追加 `现有 \| 周更: 周一` | 去重合并           |
| 播放平台    | 特点/印象列          | 追加 `现有 \| 平台: ...`  | 去重合并           |
| 独播        | 特点/印象列          | 追加 `现有 \| 独播: ...`  | 去重合并           |
| 特殊        | 特点/印象列          | 追加 `现有 \| 特殊: ...`  | 去重合并           |

### 4.4 字段映射自动识别

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
}
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

## 8. 测试策略

### 8.1 单元测试

- `enrichEngine.test.ts`：匹配算法、富化规则、冲突策略
- `enrichRecord.test.ts`：记录表读写
- 列名自动识别：覆盖已知列名映射表

### 8.2 集成测试

- 使用目标文件 `2026年4月新番表v2.13 byHazx.xlsx` 进行端到端测试
- 验证富化结果写入正确
- 验证记录表完整记录

### 8.3 异常测试

- 空文件/空工作表
- Bangumi 追踪表为空
- 特殊字符名称匹配
- 用户中途取消
- 网络异常（如适用）

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
