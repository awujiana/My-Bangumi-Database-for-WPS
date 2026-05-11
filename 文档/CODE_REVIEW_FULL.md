# BGM Excel加载项 - 全面代码审查报告

**审查日期**: 2026-05-11  
**审查范围**: TypeScript 源代码 (ts/)、编译产物 (dist-ts/)  
**审查依据**: 安全最佳实践、TDD原则、代码质量标准

---

## 执行摘要

本次审查对BGM Excel加载项进行了全面的静态代码分析，重点关注**安全性**、**代码架构**、**测试覆盖**三个维度。发现的主要问题包括：

### 🔴 严重问题 (需立即修复)

| 问题ID | 严重程度 | 类型 | 位置 |
|--------|---------|------|------|
| S-001 | **严重** | 安全 - Token加密强度不足 | [crypto.ts#L154](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/crypto.ts#L154) |
| S-002 | **严重** | 安全 - eval代码注入风险 | [wpsjsrpcsdk.js#L609](file:///d:/编程/Excel加载项/BGM/BGM/wpsjsrpcsdk.js#L609) |
| S-003 | **中等** | 安全 - DOM XSS风险 | [taskpane.ts#L565](file:///d:/编程/Excel加载项/BGM/BGM/ts/taskpane.ts#L565) |

### 🟡 重要问题 (建议修复)

| 问题ID | 严重程度 | 类型 | 位置 |
|--------|---------|------|------|
| A-001 | 重要 | 架构 - 全局状态耦合 | [util.ts#L6-L37](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L6-L37) |
| T-001 | 重要 | 测试 - 完全缺乏单元测试 | 整个项目 |
| Q-001 | 中等 | 代码质量 - 魔法数字 | constants.ts各处 |
| Q-002 | 中等 | 代码质量 - 缺少类型守卫 | wps.ts |

---

## 一、代码架构分析

### 1.1 项目结构概览

```
BGM/
├── ts/                           # TypeScript 源代码
│   ├── core/                     # 核心模块
│   │   ├── constants.ts          # 全局常量定义
│   │   ├── crypto.ts             # Token加密/解密
│   │   └── result.ts             # 统一返回类型
│   ├── sync/                     # 同步业务逻辑
│   │   ├── exceltobangumi.ts     # Excel→Bangumi同步
│   │   ├── scraping.ts           # Bangumi API拉取
│   │   └── syncRecord.ts         # 同步记录管理
│   ├── tools/                    # 工具函数
│   │   ├── events.ts             # 事件总线
│   │   ├── http.ts              # HTTP请求封装
│   │   ├── util.ts              # 通用工具
│   │   └── wps.ts               # WPS COM接口定义
│   ├── ui/                       # UI组件
│   │   ├── dialog.ts             # 对话框组件
│   │   ├── handlers.ts          # 事件处理器
│   │   ├── message.ts           # 消息通知
│   │   └── preview.ts           # 预览组件
│   ├── index.ts                  # 统一导出入口
│   ├── ribbon.ts                 # Ribbon回调
│   └── taskpane.ts              # 任务窗格主模块
├── dist-ts/                      # 编译产物
└── 文档/                         # 文档目录
```

### 1.2 架构优势

#### ✅ 模块化设计良好
- 职责划分清晰：core处理核心逻辑、sync处理业务、ui处理界面、tools处理基础设施
- 使用TypeScript类型系统进行接口约束
- 统一的导出入口([index.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/index.ts))降低耦合度

#### ✅ 类型定义完善
- [wps.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/wps.ts) 提供了完整的COM接口类型定义
- 使用interface而非any增强类型安全
- 提供了类型守卫函数(isWpsApp, isWpsWorksheet等)

#### ✅ 错误处理机制
- [result.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/result.ts) 提供统一的Result类型
- 自定义BgmError类用于业务错误
- ErrorLevel枚举区分错误处理策略

### 1.3 架构问题

#### ❌ 问题A-001: 全局状态耦合

**位置**: [util.ts#L6-L37](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L6-L37)

**问题描述**:
```typescript
export const BGM: {
    cache: BGMCache;
    sheet: BGMSheet;
    sync: BGMSync;
    // ...大量状态和方法
} = {
    // 内联初始化所有状态
    cache: { totalRows: 0, userId: null, ... },
    sheet: { lockedIndex: null, ... },
    // ...
};
```

**影响**:
- 所有模块直接依赖全局对象，测试时难以mock
- 状态分散在各处，难以追踪数据流
- 不符合SOLID原则中的依赖倒置原则

**建议**:
```typescript
// 建议重构为依赖注入模式
class BGMState {
    private cache: BGMCache;
    private sheet: BGMSheet;
    
    constructor(cache: BGMCache, sheet: BGMSheet) {
        this.cache = cache;
        this.sheet = sheet;
    }
    
    // 提供只读访问器
    getCache(): Readonly<BGMCache> {
        return Object.freeze({ ...this.cache });
    }
}
```

#### ❌ 问题A-002: 循环依赖风险

**位置**: [index.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/index.ts)

**问题描述**:
index.ts作为统一导出入口，但从[index.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/index.ts)看到，它导入并重导出了几乎所有模块。这可能导致：
- 构建时的循环依赖检测困难
- 打包时包含过多无用代码
- 模块加载顺序敏感

**建议**:
- 使用`barrel`模式但保持树摇(tree-shaking)友好
- 考虑拆分为多个入口文件(如`@bgm/core`, `@bgm/sync`等)

---

## 二、安全性审查

### 2.1 Token加密问题 (S-001)

#### 🔴 严重: XOR加密强度不足

**位置**: [crypto.ts#L151-L171](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/crypto.ts#L151-L171)

**问题代码**:
```typescript
export function encryptToken(token: string): string {
    const payload = buildPayload(token);
    const payloadBytes = strToBytes(payload);
    const keyBytes = strToBytes(TOKEN_CONFIG.XOR_KEY);  // 硬编码密钥

    // 生成随机IV
    const iv = new Uint8Array(16);
    crypto.getRandomValues(iv);

    // XOR加密 - 安全性极低！
    const encrypted = new Uint8Array(payloadBytes.length);
    for (let i = 0; i < payloadBytes.length; i++) {
        encrypted[i] = payloadBytes[i] ^ keyBytes[i % keyBytes.length] ^ iv[i % iv.length];
    }
    // ...
}
```

**风险分析**:
1. **密钥硬编码**: `TOKEN_CONFIG.XOR_KEY = "bgmtoken_secret_key_2024"` 直接写在代码中
2. **加密算法薄弱**: XOR加密无法抵御已知明文攻击
3. **密钥泄露即全军覆没**: 一旦代码被反编译，可立即解密所有存储的Token

**攻击场景**:
```javascript
// 攻击者获取加密Token后可轻易解密
const key = "bgmtoken_secret_key_2024";
// XOR解密逻辑与加密相同，直接逆向即可
```

**修复建议**:
```typescript
// 方案1: 使用Web Crypto API进行AES-GCM加密
export async function encryptTokenSecure(token: string): Promise<string> {
    const payload = buildPayload(token);
    
    // 从用户输入派生密钥(使用PBKDF2)
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(userPassword),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );
    
    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(payload)
    );
    
    return `3.${toBase64(salt)}.${toBase64(iv)}.${toBase64(encrypted)}`;
}
```

**紧急程度**: 🔴 高 - 建议在下一版本中实现并强制迁移

### 2.2 代码注入风险 (S-002)

#### 🔴 严重: eval动态代码执行

**位置**: [wpsjsrpcsdk.js#L609](file:///d:/编程/Excel加载项/BGM/BGM/wpsjsrpcsdk.js#L609), [L690](file:///d:/编程/Excel加载项/BGM/BGM/wpsjsrpcsdk.js#L690)

**问题代码**:
```javascript
eval("strData = '" + JSON.stringify(startInfo) + "';");
```

**风险分析**:
1. 如果`startInfo`包含用户输入或外部数据，可能导致代码注入
2. JSON.stringify在特殊字符处理上可能存在边界情况
3. eval本身会禁用JavaScript安全沙箱

**修复建议**:
```javascript
// 使用Function构造函数或直接对象赋值
const strData = JSON.stringify(startInfo);
// 或者
const data = {};
data.strData = JSON.stringify(startInfo);
```

**紧急程度**: 🔴 高 - 这是第三方SDK文件，建议替换为安全的替代品

### 2.3 DOM XSS风险 (S-003)

#### 🟡 中等: innerHTML直接赋值

**位置**: [taskpane.ts#L565](file:///d:/编程/Excel加载项/BGM/BGM/ts/taskpane.ts#L565)

**问题代码**:
```typescript
previewBox.innerHTML = previewRows.length > 0
    ? renderPreviewTable(previewRows, sheetIndex, sheetName, meta.headerRow)
    : `<p class="hint">已选择工作表索引: ${sheetIndex} (${escapeHtml(sheetName)})<br>未检测到数据</p>`;
```

**分析**:
- 当前代码使用了`escapeHtml()`函数对部分数据进行转义
- 但`renderPreviewTable`函数内部使用字符串拼接构建HTML
- 如果用户数据中包含恶意脚本，可能造成XSS

**改进建议**:
```typescript
// 使用DOM API或安全的模板库
function safeRenderPreview(rows: PreviewRow[]): HTMLElement {
    const table = document.createElement('table');
    table.className = 'preview-table';
    
    rows.forEach(row => {
        const tr = document.createElement('tr');
        // 使用textContent而非innerHTML设置内容
        const numTd = document.createElement('td');
        numTd.textContent = row.isHeader ? 'H' : String(row.row);
        tr.appendChild(numTd);
        
        if (row.aligned) {
            (row.cols as string[]).forEach(col => {
                const td = document.createElement('td');
                td.textContent = col || '';  // 自动转义
                tr.appendChild(td);
            });
        }
    });
    return table;
}
```

**紧急程度**: 🟡 中 - 风险取决于用户数据来源，建议逐步迁移到安全渲染

### 2.4 授权令牌暴露 (S-004)

#### 🟡 中等: Token在LocalStorage/POST请求中明文传输

**位置**: [scraping.ts#L44](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts#L44)

**问题代码**:
```typescript
xhr.setRequestHeader('Authorization', `Bearer ${token}`);
```

**建议**:
- 确保所有API请求使用HTTPS
- 考虑实现Token刷新机制，避免长期存储
- 添加CSRF Token防护

---

## 三、代码质量问题

### 3.1 测试覆盖 (T-001)

#### 🔴 严重: 缺乏任何单元测试

**现状**:
- 项目根目录未发现任何`.test.ts`、`.spec.ts`文件
- tsconfig.json中未配置Jest/Vitest等测试框架
- 所有功能都依赖手动测试

**影响**:
- 重构风险极高，无法保证代码正确性
- 回归测试成本巨大
- 不符合TDD原则

**建议测试框架**:
```bash
# 建议使用Vitest (与Vite集成良好)
npm install -D vitest @testing-library/dom

# 或使用Jest
npm install -D jest @types/jest ts-jest
```

**优先级测试用例**:

```typescript
// 1. 加密模块测试 (crypto.test.ts)
import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken, calcChecksum } from '../core/crypto';

describe('Token加密', () => {
    it('应该正确加密和解密Token', () => {
        const token = 'test-token-12345';
        const encrypted = encryptToken(token);
        expect(encrypted).not.toBe(token);
        
        const decrypted = decryptToken(encrypted);
        expect(decrypted).toBe(token);
    });
    
    it('应该拒绝格式无效的加密字符串', () => {
        expect(decryptToken('invalid')).toBeNull();
        expect(decryptToken('1.2')).toBeNull();
    });
});

// 2. URL提取测试 (util.test.ts)
describe('URL模式匹配', () => {
    it('应该从Bangumi URL提取subject ID', () => {
        const url = 'https://bgm.tv/subject/123456';
        const sid = extractSubjectId(url);
        expect(sid).toBe('123456');
    });
    
    it('应该处理无效URL', () => {
        expect(extractSubjectId('invalid')).toBeNull();
        expect(extractSubjectId('')).toBeNull();
    });
});
```

**紧急程度**: 🔴 高 - 建议立即引入测试框架

### 3.2 代码规范问题

#### 问题Q-001: 魔法数字

**位置**: 多处

**示例**:
```typescript
// constants.ts中定义
UP: -4162,  // 应该使用有名称的常量

// 但在其他文件中
lastRow = lastCell.End(-4162).Row;  // 魔法数字
```

**建议**: 确保所有魔法数字都使用TypeScript const enum或readonly const定义

#### 问题Q-002: 缺少类型守卫充分性检查

**位置**: [wps.ts#L164-L195](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/wps.ts#L164-L195)

**问题**: 类型守卫函数存在但未在所有关键位置使用

**建议**: 在所有COM对象访问前使用类型守卫

#### 问题Q-003: 错误处理不一致

**示例对比**:
```typescript
// 方式1: try-catch + 静默失败
try {
    const result = doSomething();
} catch (_) {}

// 方式2: try-catch + 日志
try {
    const result = doSomething();
} catch (e) {
    bgmLog(LOG_LEVELS.ERROR, '操作失败: ' + (e as Error).message);
}

// 方式3: 返回Result类型
function safeOperation(): Result {
    return Result.Ok(data);
    // 或
    return Result.Fail(new BgmError('失败原因'));
}
```

**建议**: 统一错误处理策略，优先使用Result类型

---

## 四、性能优化建议

### 4.1 Excel操作优化

#### 建议1: 批量操作替代逐行操作

**当前代码** ([exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts)):
```typescript
// 逐行读取
for (let i = startRow; i <= lastRow; i++) {
    const value = readCell(ws, i, col);
    // 处理...
}
```

**优化方案**:
```typescript
// 批量读取
const range = ws.Range(`${colNumToLetter(col)}${startRow}:${colNumToLetter(col)}${lastRow}`);
const values = range.Value;  // 一次性获取整列数据
```

#### 建议2: 避免重复的AutoFilter检测

**问题**: [detectFilterState](file:///d:/编程/Excel加载项/BGM/BGM/ts/taskpane.ts#L418)函数每次调用都会遍历大量行

**优化**: 缓存筛选状态，只在检测到变化时重新计算

### 4.2 网络请求优化

#### 建议: 请求合并

当前代码对每个subject独立发起请求。建议：
- 使用Bangumi API的批量查询接口
- 实现请求队列和并发控制
- 添加请求去重

---

## 五、依赖管理审查

### 5.1 依赖清单

**生产依赖**: 无显式生产依赖（纯原生JS/WPS API）  
**开发依赖**:
- vite: ^6.0.0
- typescript: ^6.0.3
- wpsjs: latest

### 5.2 安全建议

#### 🟡 建议D-001: 锁定依赖版本

**当前**: `^6.0.0` 允许次版本升级

**建议**:
```json
{
    "typescript": "6.0.3",
    "vite": "6.0.0"
}
```

或使用npm shrinkwrap

#### 🟡 建议D-002: 审计第三方代码

**问题**: wpsjsrpcsdk.js包含eval用法

**建议**: 
- 评估是否必须使用此SDK
- 考虑fork并修复安全问题
- 或使用WPS官方推荐的安全API

---

## 六、文档审查

### 6.1 现有文档

| 文档 | 位置 | 内容 |
|------|------|------|
| WPS开发文档 | [WPS 开发文档.html](file:///d:/编程/Excel加载项/BGM/BGM/文档/WPS%20开发文档.html) | WPS API参考 |
| 代码Wiki | [CODE_WIKI_V2.md](file:///d:/编程/Excel加载项/BGM/BGM/CODE_WIKI_V2.md) | 开发指南 |
| 代码审查报告 | [代码审查报告.md](file:///d:/编程/Excel加载项/BGM/BGM/文档/代码审查报告.md) | 过往审查记录 |

### 6.2 文档缺失

- ❌ API文档（TypeDoc/JSDoc覆盖不完整）
- ❌ 部署指南
- ❌ 贡献指南
- ❌ 安全漏洞报告流程

---

## 七、优先级修复路线图

### Phase 1: 安全紧急修复 (1-2周)

| 优先级 | 任务 | 影响 | 预估工时 |
|--------|------|------|----------|
| P0 | 移除/重构wpsjsrpcsdk.js中的eval | 防止代码注入 | 4小时 |
| P0 | 实现AES-GCM Token加密替代XOR | 保护用户凭证 | 2天 |
| P1 | 统一innerHTML使用，迁移到安全渲染 | 防止XSS | 3天 |

### Phase 2: 质量提升 (2-4周)

| 优先级 | 任务 | 影响 | 预估工时 |
|--------|------|------|----------|
| P1 | 引入Vitest测试框架 | 质量保障基础 | 1天 |
| P1 | 编写核心模块单元测试 | 回归防护 | 1周 |
| P2 | 重构BGM全局状态为依赖注入 | 可测试性 | 3天 |
| P2 | 统一错误处理策略 | 代码一致性 | 2天 |

### Phase 3: 长期优化 (1-2月)

| 优先级 | 任务 | 影响 | 预估工时 |
|--------|------|------|----------|
| P2 | 性能优化：批量Excel操作 | 响应速度 | 1周 |
| P2 | API请求合并优化 | 网络效率 | 3天 |
| P3 | 完善文档和类型注释 | 可维护性 | 持续 |

---

## 八、附录

### A. 审查方法论

- **静态分析工具**: TypeScript编译器检查、ESLint (如配置)
- **手动代码审查**: 逐模块阅读关键代码路径
- **安全模式匹配**: 正则搜索危险函数(eval, innerHTML, document.write)

### B. 参考标准

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [CWE 常见弱点枚举](https://cwe.mitre.org/)
- [TypeScript 安全最佳实践](https://typescript-eslint.io/)

### C. 审查清单

```
□ 安全性
  □ Token加密强度
  □ 代码注入风险(eval/Function)
  □ XSS漏洞(innerHTML)
  □ 敏感数据暴露
  □ HTTPS使用

□ 代码质量
  □ TypeScript类型完整性
  □ 错误处理一致性
  □ 魔法数字消除
  □ 代码重复度
  □ 命名规范性

□ 架构设计
  □ 模块耦合度
  □ 全局状态使用
  □ 依赖注入应用
  □ SOLID原则遵守

□ 测试
  □ 测试框架引入
  □ 单元测试覆盖
  □ 集成测试
  □ E2E测试

□ 性能
  □ Excel操作效率
  □ 网络请求优化
  □ 内存使用
```

---

**报告生成**: AI Code Review Assistant  
**下次审查建议**: 3个月后或重大版本发布前
