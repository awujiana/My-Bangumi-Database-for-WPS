import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['ts/**/*.ts'],
      exclude: [
        // 入口聚合文件：仅 re-export，无独立逻辑
        'ts/index.ts',
        'ts/tools/util.ts',
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
        // ====================================================================
        // 现状（2026-07-21，699 测试）：
        //   All files: 30.12% stmts / 24.22% branch / 42% funcs / 30.83% lines
        //
        // 阈值设置在略低于现状的水平，主要用作"回归门禁"——任何使总体覆盖率
        // 下降超过 ~2% 的改动将导致 `npm run test:coverage` 失败。
        //
        // ====================================================================
        // 目标（按模块类型，待逐步提升）：
        //   - 纯函数模块 ≥ 90%（已达标：crypto/result/logBuffer/sanitize/
        //     stringUtils/stringUtilsPure/debounce/pureUtilsCore/githubSyncDiff）
        //   - 业务模块 ≥ 70%（部分达标：gistSync/localFileSync/undoStack/http/
        //     sheet/syncSourceRegistry；未达标见下方 TODO）
        //   - UI 模块 ≥ 50%（仅 conflictResolver/handlers/_constants 达标）
        // ====================================================================
        // TODO: 待补测试的低覆盖模块（按优先级）：
        //   - ts/sync/exceltobangumi/api.ts (2.18%)          — 业务，目标 70%
        //   - ts/sync/exceltobangumi/chapterMarker.ts (0%)   — 业务，目标 70%
        //   - ts/sync/exceltobangumi/progressReporter.ts (6.66%) — 业务，目标 70%
        //   - ts/sync/exceltobangumi/index.ts (47.65%)       — 业务，目标 70%
        //   - ts/sync/scraping.ts (0%)                       — 业务，目标 70%
        //   - ts/sync/syncRecord.ts (9.48%)                  — 业务，目标 70%
        //   - ts/sync/githubSync.ts (54.45%)                 — 业务，目标 70%
        //   - ts/sync/githubConfig.ts (35.41%)               — 业务，目标 70%
        //   - ts/sync/giteeSync.ts (22.22%)                  — 业务，目标 70%
        //   - ts/sync/gitlabSync.ts (22.22%)                 — 业务，目标 70%
        //   - ts/tools/util/index.ts (17.58%)                — 业务，目标 70%
        //   - ts/tools/util/cell.ts (43.75%)                 — 业务，目标 70%
        //   - ts/tools/util/sleep.ts (0%)                    — 业务，目标 70%
        //   - ts/tools/wps.ts (16.66%)                       — 业务，目标 70%
        //   - ts/tools/config.ts (1.72%)                     — 业务，目标 70%
        //   - ts/tools/autoFillUrl.ts (0%)                   — 业务，目标 70%
        //   - ts/tools/logger.ts (43.58%)                    — 业务，目标 70%
        //   - ts/tools/events.ts (19.35%)                    — 业务，目标 70%
        //   - ts/ui/dialog.ts (8.68%)                        — UI，目标 50%
        //   - ts/ui/preview.ts (5.93%)                       — UI，目标 50%
        //   - ts/ui/message.ts (2.77%)                       — UI，目标 50%
        //   - ts/ui/handlers/index.ts (42.72%)               — UI，目标 50%
        //   - ts/ui/handlers/sync.ts (0%)                    — UI，目标 50%
        //   - ts/ui/handlers/sheet.ts (0%)                   — UI，目标 50%
        //   - ts/ui/handlers/token.ts (0.76%)                — UI，目标 50%
        //   - ts/taskpane/index.ts (2.85%)                   — UI，目标 50%
        //   - ts/taskpane/panelLifecycle.ts (5.29%)          — UI，目标 50%
        //   - ts/taskpane/userInfoPolling.ts (0%)            — UI，目标 50%
        //   - ts/services/ribbonService.ts (0.32%)           — UI，目标 50%
        // ====================================================================
        // 提升路径：
        //   1. 短期（下个迭代）：补 api.ts/chapterMarker.ts/progressReporter.ts
        //      单元测试，将全局 stmts 提升至 40%+，阈值同步上调。
        //   2. 中期：补 syncRecord/scraping/githubSync 测试，全局 stmts 50%+。
        //   3. 长期：UI 模块引入 jsdom + @testing-library，全局 stmts 60%+，
        //      届时启用 perFile: true 并按模块类型设置差异化阈值。
        // ====================================================================
        statements: 28,
        branches: 22,
        functions: 38,
        lines: 28,
        perFile: false,
      },
    },
  },
});
