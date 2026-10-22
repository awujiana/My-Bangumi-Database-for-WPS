import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 默认 10s 太紧：全量并发起 142 个 jsdom 环境（每文件 ~4.5s 启动 + 安全软件扫描），
    // 遇到机器负载高时 beforeEach 钩子会偶发超时（实测同一个文件单跑 3.6s、全量跑 >10s）。
    // 抬到 30s 只影响本来就该失败的慢钩子，快路径零成本。
    hookTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    // 不设 `isolate: false`（vitest 每轮都会提示"可再省约 49s/轮"）——2026-10-22 实测三轮：
    //   基线（isolate 默认 true）：153 文件 / 4837 用例全过，60.6s；
    //   `--no-isolate`：① 12 文件 / 272 用例失败，134.7s；② 48.1s 处异常中断；
    //               ③ 8 文件 / 102 用例失败，192.3s。没有一轮既通过又更快。
    // 两轮失败的文件集不同（gitee-sync vs utility-index / nav-order / scraping），
    // 污染对象随执行顺序漂移 —— worker 复用后**模块注册表跨文件共享**、模块级
    // 单例互相污染（实测 gitee-sync 的 `getGithubConfig()` 读到上个文件留下的
    // undefined）。本套件刻意依赖「每文件一个全新模块注册表」做隔离（见
    // tests/enrich-page.test.ts 文件头：`enrichWatchTimer` 等模块级状态只能靠
    // 独立文件保住初值）。那 ~3.8s/文件的启动成本换来的正是隔离性。
    // 测试环境保真：jsdom 环境下默认注入真实 DOMPurify，使单测走与生产一致的
    // 严格白名单路径（背景见 tests/setup/dompurify.ts 与 文档/TS_AUDIT_2026_09_10.md P0-2）
    setupFiles: ['tests/setup/dompurify.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['ts/**/*.ts'],
      exclude: [
        // 测试代码与其共享 helper：本数组是**显式**的，会整体替换 vitest 的默认
        // exclude（默认含 `test?(s)/**`）。少了这一条，`tests/helpers/**` 一旦被
        // 测试 import 就会被 v8 采样进报告，虚增未覆盖行数并稀释全项目百分比。
        'tests/**',
        // 入口聚合文件：仅 re-export，无独立逻辑
        'ts/index.ts',
        'ts/tools/utility.ts',
        'ts/sync/exceltobangumi.ts',
        // Ribbon 实现：依赖 WPS 宿主（COM 回调注册），无法在 Node 测试环境执行
        'ts/ribbon.ts',
        // 调试面板主文件：随 index.html 一起发布，但生产环境被 `isDebugEnvironment()`
        // （`window.WpsInvoke === undefined`）拦成 inert。余下约 140 行是**开发期专用**的
        // DOM 事件管线（Tab 切换 / Ribbon 卡片点击 / 日志轮询 / 诊断报告导出），只经内部
        // 函数触达。按 §3 既定口径「entry/** 类装配脚本降级为集成冒烟，不为数字硬造 mock」，
        // 这里只保留 `tests/debug-panel.test.ts` 对**守卫与启动时机**的冒烟。
        'ts/entry/debug-panel.ts',
        // ⚠️ `ts/entry/**` 的其余 4 个文件**不在**排除之列。2026-09-15 实测：它们依赖收敛、
        // 可在 jsdom 下执行（`tests/entry-smoke.test.ts` 装配冒烟 + `tests/debug-panel-render.test.ts`），
        // 4 个文件全部 **100% lines**。原先把 `ts/entry/**` 整体排除的理由是「依赖 WPS 宿主，
        // 无法在 Node 测试环境执行」—— 这与 `debug-panel-render.ts` 自己文件头写的
        // 「本模块**无 import 时副作用**，可直接单测」直接矛盾（该模块正是为了可测才从
        // debug-panel.ts 拆出来的，整体排除把拆分目的抹掉了）。故把排除收窄到上述单文件。
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
