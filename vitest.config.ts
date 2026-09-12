import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 测试环境保真：jsdom 环境下默认注入真实 DOMPurify，使单测走与生产一致的
    // 严格白名单路径（背景见 tests/setup/dompurify.ts 与 文档/TS_AUDIT_2026_09_10.md P0-2）
    setupFiles: ['tests/setup/dompurify.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['ts/**/*.ts'],
      exclude: [
        // 入口聚合文件：仅 re-export，无独立逻辑
        'ts/index.ts',
        'ts/tools/utility.ts',
        'ts/sync/exceltobangumi.ts',
        // Ribbon / 入口文件：依赖 WPS 宿主，无法在 Node 测试环境执行
        'ts/ribbon.ts',
        'ts/entry/**',
        // 构建产物
        'dist-ts/**',
      ],
      thresholds: {
        // ====================================================================
        // 全局聚合覆盖率门禁（perFile: false）
        // 注意：perFile:false 下 v8 的「glob 单文件阈值」不会被检查（实测改成 101 也不报错），
        // 别在这里给单个文件加阈值 —— 它不会生效。单模块 100% 只能靠测试本身维持。
        // ====================================================================
        // 实测基线（2026-09-13，2348 测试）：
        //   All files: 46.62% stmts / 40.57% branch / 53.51% funcs / 46.82% lines
        //
        // 各指标留 5~8 个点的安全余量，让门禁只拦真实回归、不拦日常波动：
        //   - stmts / lines 设 40（余量约 6.7）：主线指标，即要求的 40 线
        //   - funcs 设 45（余量约 8.5）：实测已 53.5，沿用 40 等于形同虚设
        //   - branch 设 35（余量约 5.6）：实测仅 40.57，设 40 会天天误报
        //
        // 命中后 `npm run test:coverage` 失败，需要补测试或显式下调并说明理由。
        //
        // ====================================================================
        // 目标（按模块类型，待逐步提升）：
        //   - 纯函数模块 ≥ 90%（已达标：crypto/result/logBuffer/sanitize/
        //     string-utilities/string-utilities-pure/debounce/pure-utilities-core/githubSyncDiff）
        //   - 业务模块 ≥ 70%（部分达标：gistSync/localFileSync/undoStack/http/
        //     sheet/syncSourceRegistry；未达标见 文档/COVERAGE_BACKLOG.md）
        //   - UI 模块 ≥ 50%（仅 conflictResolver/handlers/_constants 达标）
        // ====================================================================
        // 待补测试清单：见 文档/COVERAGE_BACKLOG.md（按「可获覆盖行数」排序 + 难度分级）。
        // 数据每次 coverage 都会变，别在这里手抄百分比 —— 抄了必然过时（旧版 TODO 里的
        // config.ts 1.72%、wps.ts 16.66% 等数字与实测早已不符，已被本指针取代）。
        // ====================================================================
        // 提升路径（2026-09-13 更新，基线 46.82% lines / 2348 测试）：
        //   1. 短期：tools/util/index.ts（+2.47%）、auto-fill-url、panel-events、
        //      settings-bindings 等纯逻辑 / 低风险模块，目标 lines 55%。
        //   2. 中期：enrich-page（+4.92%）、panel-lifecycle（+3.55%）这类 2000+ 行、
        //      覆盖率 <6% 的大文件 —— 必须先拆自洽切片再测，直接补测产出的是假覆盖。
        //   3. 长期：UI 模块 jsdom + testing-library，目标 60%+。
        // 注：ts/sync/** 的 COM 模块不建议为了数字去 mock —— 建议改用集成测试或人工验收。
        // ====================================================================
        statements: 40,
        branches: 35,
        functions: 45,
        lines: 40,
        perFile: false,
      },
    },
  },
});
