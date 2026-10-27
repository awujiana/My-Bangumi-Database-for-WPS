import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.ts'

// 临时配置：仅用于本地覆盖率实测。
// - clean:false 跳过 coverage/.tmp 的批量删除（沙箱 safe-delete 守卫会拦截 >50 文件的 rm）
// - reportOnFailure:true 即使有（已知 flaky 的 ui-bridge 5s 超时）失败也照常产出报告
export default mergeConfig(
  base,
  defineConfig({
    test: {
      coverage: {
        clean: false,
        reportOnFailure: true,
      },
    },
  }),
)
