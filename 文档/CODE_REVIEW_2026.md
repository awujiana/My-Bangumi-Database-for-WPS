# BGM 加载项代码审查报告 2026

> **审查日期**: 2026-06-13
> **审查范围**: TypeScript 源码 (`ts/`)、Python 工具脚本 (`clean_xlsx.py`)、构建配置文件
> **项目概述**: WPS Office 加载项，用于将 Excel 表格中的番剧数据同步到 Bangumi 网站。采用 TypeScript 编写，通过 COM 接口操作 WPS，通过 XHR 调用 Bangumi API。

---

## 一、概述

本项目代码库整体结构清晰，模块划分合理（`core/`、`services/`、`sync/`、`tools/`、`ui/`），TypeScript 类型系统使用良好。但在以下方面存在值得关注的问题：

- **类型安全**：大量 `any` 类型集中于 COM 交互层，削弱了 TypeScript 的静态检查优势
- **函数复杂度**：多个核心函数超过 200 行，承载多重职责，可维护性较低
- **异常处理**：部分路径存在静默吞错误、未解锁资源等问题，可能导致运行时死锁
- **安全性**：`postMessage` 未校验 `event.origin`，存在跨站消息伪造风险
- **数据一致性**：关键常量 `WATCH_STATUS_MAP` 与 `COLLECTION_TYPE_NAMES` 的数值定义存在互换性错误

---

## 二、紧急问题 (P0)

以下问题**必须立即修复**，可能导致数据错误、功能死锁或安全漏洞。

### P0-1：同步记录格式化函数未解锁导致永久卡死

| 属性 | 内容 |
|------|------|
| **文件** | `ts/sync/syncRecord.ts` |
| **行号** | 第 441-446 行 |
| **风险** | `_formattingInProgress` 标志在 `lastRow < 1` 提前返回时未重置，后续所有调用 `formatSyncRecordSheet` 的路径均被屏蔽 |

```typescript
if (_formattingInProgress) return;  // 第 441 行
_formattingInProgress = true;       // 第 442 行
try {
    // ...
    if (lastRow < 1) return;        // 第 446 行 — 未解锁！
    // ...
} finally {
    _formattingInProgress = false;  // 较后的 finally 才解锁
}
```

**修复建议**：将第 446 行 `return` 改为 `return` 前先执行 `_formattingInProgress = false`，或将解锁逻辑提取到统一的 finally 块中，或使用 RAII 风格封装。

### P0-2：`postMessage` 未校验 `event.origin`

| 属性 | 内容 |
|------|------|
| **文件** | `ts/ui/message.ts` |
| **行号** | 第 23 行 |
| **风险** | 任意来源的跨站消息可以伪造 `showAlert`、`showConfirm`、`updateToken` 等操作，诱导用户执行恶意动作 |

```typescript
window.addEventListener('message', (event: MessageEvent<MessageEventData>) => {
    const data = event.data;
    if (!data?.type) return;
    // 未校验 event.origin！
```

**修复建议**：在消息处理入口增加 `event.origin` 白名单校验：

```typescript
const ALLOWED_ORIGINS = ['https://bgm.tv', window.location.origin];
if (!ALLOWED_ORIGINS.includes(event.origin)) return;
```

### P0-3：`COLLECTION_TYPE_NAMES` 与 `WATCH_STATUS_MAP` 数值定义互换

| 属性 | 内容 |
|------|------|
| **文件** | `ts/core/constants.ts` |
| **行号** | 第 471-483 行（`WATCH_STATUS_MAP`）、第 503 行（`COLLECTION_TYPE_NAMES`） |
| **风险** | 直接导致预览/同步记录功能中状态显示错误："2"（看过）显示为"在看"，"3"（在看）显示为"看过" |

**定义对比**：

| 状态 | COLLECTION_TYPE_NAMES | WATCH_STATUS_MAP |
|------|----------------------|------------------|
| 想看 | `[1] = '想看'` | `"想看" = 1` |
| 在看 | `[2] = '在看'` | `"在看" = 3` ← **矛盾** |
| 看过 | `[3] = '看过'` | `"看过" = 2` ← **矛盾** |
| 搁置 | `[4] = '搁置'` | `"搁置" = 4` |
| 抛弃 | `[5] = '抛弃'` | `"抛弃" = 5` |

`COLLECTION_TYPE_NAMES` 的索引 2 对应"在看"、3 对应"看过"，而 `WATCH_STATUS_MAP` 中"看过"=2、"在看"=3——两者完全互换。当 `preview.ts` 中用 `COLLECTION_TYPE_NAMES[statusCode]` 做反向映射时，必然得到错误的显示文本。

**修复建议**：统一两套映射采用同一个 API 规范，建议以 BGM API v0 官方文档为准：1=想看, 2=看过(collect), 3=在看(do), 4=搁置, 5=抛弃。将 `COLLECTION_TYPE_NAMES` 改为 `['', '想看', '看过', '在看', '搁置', '抛弃']`，或将 `WATCH_STATUS_MAP` 中"在看"改为 2、"看过"改为 3。

---

## 三、高风险问题 (P1)

以下问题**建议尽快修复**，可能引发功能异常、性能退化或难以排查的 bug。

### P1-1：`catch (_) {}` 静默吞掉所有错误

| 属性 | 内容 |
|------|------|
| **文件** | `ts/sync/syncRecord.ts` |
| **行号** | 第 134 行 |
| **风险** | 同步记录表迁移失败时完全不记录日志，排查问题无迹可寻 |

**修复建议**：至少记录 WARN 级别日志：`catch (e) { bgmLog(LOG_LEVELS.WARN, '同步记录表迁移失败: ' + (e as Error).message); }`

### P1-2：`preview.ts` 中 `reverseMap` 两处定义不一致

| 属性 | 内容 |
|------|------|
| **文件** | `ts/ui/preview.ts` |
| **行号** | 第 133 行 vs 第 243 行 |
| **风险** | 状态码 0 在详情预览和状态归一化中有不同含义，可能导致边界情况下的显示不一致 |

- 第 133 行（`renderDetailItemHtml`）：`{ 0: '', 1: '想看', 2: '在看', 3: '看过', 4: '搁置', 5: '抛弃' }`
- 第 243 行（`normalizeStatus`）：`{ 1: '想看', 2: '在看', 3: '看过', 4: '搁置', 5: '抛弃', 0: '忽略' }`

**修复建议**：提取为共享常量统一引用，避免同一含义分散定义。

### P1-3：`setInterval` 无 `clearInterval` 导致内存泄漏

| 属性 | 内容 |
|------|------|
| **文件** | `ts/taskpane.ts` |
| **行号** | 第 728 行 |
| **风险** | 用户轮询检测变更的定时器在页面/面板生命周期结束后持续运行，造成内存泄漏和无效的 COM 调用 |

**修复建议**：保存 `setInterval` 返回的 ID，在 `window.beforeunload` 或面板关闭时 `clearInterval`。

### P1-4：`keydown` 事件监听器无 `removeEventListener`

| 属性 | 内容 |
|------|------|
| **文件** | `ts/taskpane.ts` |
| **行号** | 第 850 行 |
| **风险** | 页面重渲染或模块重新初始化时重复注册监听器，可能导致 Escape 键响应多次 `closeDetailModal` |

**修复建议**：保存引用并在 `beforeunload` 或组件卸载时移除，或使用事件委托模式。

### P1-5：对话框不支持堆叠

| 属性 | 内容 |
|------|------|
| **文件** | `ts/ui/dialog.ts` |
| **行号** | 第 168-180 行（`_dialogCallback` 单一变量） |
| **风险** | 后打开的对话框会覆盖前一个的回调，前一个对话框操作时触发的回调可能是错误的 |

**修复建议**：改用回调栈 `_dialogCallbacks: Array<{onOk, onCancel}>`，对话框关闭时 pop 而非赋值。

### P1-6：对话框回调无 try-catch 包裹

| 属性 | 内容 |
|------|------|
| **文件** | `ts/ui/dialog.ts` |
| **行号** | 第 168-180 行 |
| **风险** | 回调中抛出异常将导致对话框无法正常关闭，界面卡死 |

**修复建议**：在回调执行前后包裹 try-catch，确保 `_dialogCallback = null` 在任何情况下都被执行。

### P1-7：`message.ts` 中 window 监听器无 `removeEventListener`

| 属性 | 内容 |
|------|------|
| **文件** | `ts/ui/message.ts` |
| **行号** | 第 23 行 |
| **风险** | 存在多次调用 `initMessageListener` 导致重复注册的风险 |

**修复建议**：在注册前先 `removeEventListener` 清理旧监听器。

### P1-8：多个 200+ 行超级函数

| 属性 | 内容 |
|------|------|
| **文件** | `ts/ui/handlers.ts` |
| **行号** | `syncFromPanel`（第 326-557 行，232 行）、`handleActionClick`（第 806-996 行，191 行）、`cleanLockedDataSheet`（第 1288-1478 行，191 行） |
| **风险** | 函数承载多重职责，难以测试、调试和修改 |

**修复建议**：按职责拆分为独立的辅助函数，例如将参数校验、API 调用、UI 更新、结果回写分离。

### P1-9：`handleActionClick` 中 `setToken` case 为死代码

| 属性 | 内容 |
|------|------|
| **文件** | `ts/ui/handlers.ts` |
| **行号** | 第 806-996 行 `switch` 内 |
| **风险** | 此 data-action 在 taskpane HTML 中没有任何元素使用，但 case 保留在逻辑中，增加维护负担 |

**修复建议**：移除该 case；如果需要保留兼容，加注释说明未来用途。

### P1-10：`cleanLockedDataSheet` 完全无 try-catch 包裹

| 属性 | 内容 |
|------|------|
| **文件** | `ts/ui/handlers.ts` |
| **行号** | 第 1288-1478 行 |
| **风险** | 直接操作大量 Excel COM 对象（读取、删除行），COM 调用失败时可能导致 WPS 崩溃，且整个函数无错误恢复机制 |

**修复建议**：外层包裹 try-catch-finally，COM 调用关键位置加细粒度异常捕获。

### P1-11：`showTokenDialog` / `showUserIdDialog` 无空输入保护和取消处理

| 属性 | 内容 |
|------|------|
| **文件** | `ts/ui/handlers.ts` |
| **行号** | 第 86-95 行（`showTokenDialog`）、第 97-106 行（`showUserIdDialog`） |
| **风险** | 用户输入空值时静默跳过（无反馈），但取消操作时也无任何提示 |

**修复建议**：在回调中增加对空值的反馈提示和取消操作的处理。

---

## 四、中风险问题 (P2)

以下问题**建议在迭代中逐步修复**，可能影响代码质量或功能正确性。

### P2-1：WATCH_STATUS_MAP 模糊匹配误匹配风险

| **文件** | `ts/core/constants.ts` + `ts/sync/exceltobangumi.ts` |
|------|------|
| **行号** | constants.ts 第 471-484 行，exceltobangumi.ts 第 390-393 行 |
| **风险** | 双向子串匹配 `normalized.includes(key) \|\| key.includes(normalized)`，"完美"含"完"会误匹配到"完"→2（看过），"看"优先匹到"看过"(2)而非"在看"(3)，结果取决于遍历顺序 |

**修复建议**：优先精确匹配，模糊匹配时增加最小长度阈值（如 >= 2 字符）或使用分词后交集匹配。

### P2-2：`util.ts` 多处未使用导出

| **文件** | `ts/tools/util.ts` |
|------|------|
| **行号** | `getSheetByIndex`（第 484 行）、`shellExecuteByOAAssist`（第 691 行）、`safeActivate`（第 1162 行）、`GetUrlPath`（第 701 行） |
| **风险** | 导出无外部消费者，增加模块耦合和 API 表面，`GetUrlPath` 仅在 `showBangumiPanel` 内部使用；`_fetchBgmUserInfo`（第 628 行）虽标记为内部但通过 index.ts 导出 |

**修复建议**：清理未使用的导出，仅保留 `index.ts` 中真正被外部消费的接口。

### P2-3：`exceltobangumi.ts` 中 26+ 处 `any` 类型滥用

| **文件** | `ts/sync/exceltobangumi.ts` |
|------|------|
| **行号** | 分布在第 30-1200 行范围 |
| **风险** | COM 交互大量使用 `any` 绕过类型检查，应在边界层做类型收窄 |

**修复建议**：为 COM 对象定义更精确的接口类型，在 `getField`、`ws.Range` 等交互点使用类型守卫。

### P2-4：`clean_xlsx.py` URL 别名分割正则不完整

| **文件** | `clean_xlsx.py` |
|------|------|
| **行号** | 第 464 行 |
| **风险** | 注释承诺支持 `/|｜//／`，实际只实现了 `[/／]`（斜杠和中文斜杠），`|`（竖线）和 `｜`（中文竖线）分割完全失效 |

**修复建议**：将正则改为 `re.compile(r'[/／|｜]')`。

### P2-5：`clean_xlsx.py` `pick_column` 子串匹配误抢

| **文件** | `clean_xlsx.py` |
|------|------|
| **行号** | 第 304 行附近 |
| **风险** | "系列"会误匹配"系列集数"，"原作"会误匹配"原作标签"之前的精确匹配，但无词边界检查 |

**修复建议**：使用词边界或精确匹配优先策略，匹配前增加长度/位置校验。

### P2-6：`clean_xlsx.py` `parse_tags` 分隔符无法转义

| **文件** | `clean_xlsx.py` |
|------|------|
| **行号** | 第 87 行 |
| **风险** | 标签以 `|` 分割，如果标签内容本身包含 `|` 字符无法处理 |

**修复建议**：与 Excel 端对齐分割规则，或增加转义机制（如 `\|` 表示字面竖线）。

### P2-7：`clean_xlsx.py` 备份文件多实例竞争

| **文件** | `clean_xlsx.py` |
|------|------|
| **行号** | 第 226-232 行附近 |
| **风险** | 固定 `.bak` 后缀的备份文件名，多实例同时运行时存在 TOCTOU 竞争条件 |

**修复建议**：在备份文件名中加入时间戳或进程 ID：`filepath + f'.{int(time.time())}.bak'`。

### P2-8：`scraping.ts` API 429 无限重试

| **文件** | `ts/sync/scraping.ts` |
|------|------|
| **行号** | 第 224-227 行 |
| **风险** | `fetchAllUserCollections` 的 429 处理使用 `continue` 重试但无最大重试次数上限，可能导致无限循环 |

**修复建议**：增加重试计数器，超过 `BGM_CONFIG.MAX_RETRIES` 时抛出错误。

### P2-9：`handlers.ts` 消息监听无 `default` 分支

| **文件** | `ts/ui/handlers.ts` |
|------|------|
| **行号** | 第 1018-1056 行 |
| **风险** | 收到未知消息类型时静默忽略，不利于调试和发现上游异常 |

### P2-10：`taskpane.ts` 无统一事件绑定机制

| **文件** | `ts/taskpane.ts` |
|------|------|
| **行号** | 整个文件 |
| **风险** | 全靠 `getElementById` 手动绑定，无 `bindActions` 统一机制，遗漏绑定难发现 |

---

## 五、低风险建议 (P3)

以下项目**可作为代码风格和架构持续改进的参考**。

### P3-1：`GetUrlPath` 命名风格不一致

| **文件** | `ts/tools/util.ts` |
|------|------|
| **行号** | 第 701 行 |
| **建议** | 项目采用驼峰命名，`GetUrlPath` 为帕斯卡命名，改为 `getUrlPath` |

### P3-2：`http.ts` 与 `scraping.ts` XHR 请求代码重复

| **文件** | `ts/tools/http.ts` vs `ts/sync/scraping.ts` |
|------|------|
| **行号** | http.ts 第 150-256 行，scraping.ts 第 89-107 行 |
| **建议** | 两模块各自实现了相似的 Promise 封装 XHR 逻辑（~70 行），建议统一复用 `http.ts` |

### P3-3：`exceltobangumi.ts` 文件过大

| **文件** | `ts/sync/exceltobangumi.ts` |
|------|------|
| **行号** | 共 1448 行 |
| **建议** | 承载 10+ 职责（同步、章节标记、Token 验证、筛选状态等），建议按职责拆分到独立文件 |

### P3-4：根目录文件清理

| **文件** | 项目根目录 |
|------|------|
| **建议** | 建议将 `clean_xlsx.py`、`main.py`、`setup.py`、`.bat` 文件等移到 `scripts/` 或 `tools/` 子目录 |

### P3-5：`constants.ts` 未使用导出

| **文件** | `ts/core/constants.ts` |
|------|------|
| **行号** | `XL`（第 70 行）、`COLUMNS`（第 318 行）、`BGM_SUBJECT_TYPES`（第 194 行） |
| **建议** | 确认无外部引用后移除或标记 `@deprecated` |

---

## 六、架构优化建议

### 6.1 类型安全改进路线

建议为 COM 交互层引入类型守卫收窄策略：
- 在 `getApp()`、`getCell()` 等入口点做严格类型检查
- 使用 `WpsWorksheet`、`WpsRange` 等接口而非 `any`
- 新增 `com/types.ts` 存放所有 COM 相关类型定义

### 6.2 超级函数拆分策略

建议对以下函数按 "数据获取 → 业务处理 → UI 更新" 三层拆分：

| 函数 | 当前行数 | 建议拆分方向 |
|------|---------|-------------|
| `SyncToBangumiAsync` | 300+ | 预处理、批量请求、结果回写、日志记录 |
| `syncSelectedRows` | 200+ | 参数校验、单行同步、结果展示 |
| `syncFromPanel` | 232 | 配置读取、预览统计、冲突检测、同步执行 |
| `cleanLockedDataSheet` | 191 | 数据读取、重复检测、行删除、标签合并 |

### 6.3 错误处理统一化

- 建立"永不静默吞错误"原则：所有 `catch {}` 至少记录 WARN 日志
- `_formattingInProgress` 类标志变量统一使用 `try/finally` 模式管理
- 所有 COM 互操作路径增加细粒度异常捕获

### 6.4 缓存/轮询优化

- `taskpane.ts` 的 `setInterval` 轮询改为事件驱动 + 轮询兜底的混合模式
- 实现轮询定时器的生命周期管理（启动/停止/清理）

---

## 七、修复优先级路线图

| 优先级 | 阶段 | 问题编号 | 预估工作量 |
|--------|------|---------|-----------|
| **P0** | **立即修复** | P0-1（死锁）、P0-2（安全）、P0-3（数据一致性） | 1-2 天 |
| **P1** | **本轮迭代** | P1-1 ~ P1-11 | 3-5 天 |
| **P2** | **下个迭代** | P2-1 ~ P2-10 | 2-3 天 |
| **P3** | **代码整洁日** | P3-1 ~ P3-5 | 0.5 天 |

---

*报告生成完毕。建议在修复每个问题后，运行完整的同步流程（含筛选模式、增量同步、冲突检测）进行回归验证。*