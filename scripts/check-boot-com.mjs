#!/usr/bin/env node
/**
 * @fileoverview 校验各窗格 bootstrap 遵守「首屏零 COM + 过闸门」约束
 *
 * 背景（高亮页面打开卡 70 秒）：WPS 任务窗格在「新窗格打开 → 宿主渲染进程 attach →
 * COM 桥建好」之间存在初始化窗口。在这个窗口里从渲染进程发起**同步跨进程 COM**
 * （getDataSheet / Worksheet.Range.Read / PluginStorage 读写）会让宿主主线程与渲染
 * 进程互锁死等，直到 JSAPI 桥看门狗超时。真机 bisect：
 *   - 只 import 页面模块不调函数            → 秒开
 *   - 调 initializeHighlightPage（3 轻 COM） → 卡 10 秒
 *   - 原版（3 轻 COM + 一次大 Range 读）     → 卡 70 秒
 *   - load + setTimeout(0) 再调              → **仍卡**（离 load 只有几毫秒）
 *
 * 所以「在 bootstrap 里直接同步跑初始化」是**结构性错误**，不是调参问题。本脚本
 * 静态守住两条：
 *   1. 每个 bootstrap 必须 import `tools/com-ready.js` 并调用 `openComGate('<pageKey>')`；
 *   2. bootstrap 里不得出现**顶层立即调用**的 COM 初始化函数（缩进 0~2 空格的
 *      `initializeXxxPage()` / `startPaneHeartbeat()` / `startThemeSync()` /
 *      `startNavModeSync()` / `startNavOrderSync()` / `startModuleStateSync()` /
 *      `initializeTheme()`）。走闸门时这些调用都嵌在 `run:` 属性或箭头函数里，
 *      缩进必然 ≥4，不会被误伤。
 *
 * 退出码：0 通过；1 失败（打印修复指引）。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const panelDirectory = join(projectRoot, 'ts', 'panel')

/** 顶层立即调用即违规的 COM 初始化函数 */
const FORBIDDEN_IMMEDIATE_CALL =
  /^[ \t]{0,2}(initialize\w*Page|startPaneHeartbeat|startThemeSync|startNavModeSync|startNavOrderSync|startModuleStateSync|initializeTheme)\(/mu

/** 临时诊断文件（bisect / 探针）不参与校验 */
const isTemporaryFile = (name) => /bisect|probe|trunc/u.test(name)

/** 收集到的问题 */
const problems = []

/** 统计：确保解析器真的读到了东西 */
let checkedFiles = 0

const files = readdirSync(panelDirectory)
  .filter((name) => name.endsWith('-bootstrap.ts'))
  .filter((name) => !isTemporaryFile(name))
  .sort()

for (const file of files) {
  const source = readFileSync(join(panelDirectory, file), 'utf8')

  if (!source.includes("'../tools/com-ready.js'")) {
    problems.push(
      `ts/panel/${file} 没有 import tools/com-ready.js —— 页面的 COM 初始化必须过闸门`,
    )
  }
  if (!/openComGate\(/u.test(source)) {
    problems.push(
      `ts/panel/${file} 没有调用 openComGate('<pageKey>') —— 不开闸门则所有 COM 任务永远排队不执行`,
    )
  }

  const offending = FORBIDDEN_IMMEDIATE_CALL.exec(source)
  if (offending) {
    problems.push(
      `ts/panel/${file} 在顶层直接调用了 ${offending[1]}() —— 同步 COM 会撞上宿主初始化窗口` +
        `（卡 10~70 秒）。放进 runComPhases 的分片里（run: xxx / () => xxx）`,
    )
  }

  checkedFiles += 1
}

if (checkedFiles < 6) {
  problems.push(
    `只解析到 ${String(checkedFiles)} 个 bootstrap（期望 ≥6）—— 本脚本的过滤逻辑失效了，必须修而不是空转`,
  )
}

if (problems.length > 0) {
  console.error('✗ 启动期 COM 约束校验失败：\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    '\n修复：把 COM 初始化包进 runComPhases(pageKey, [{ name, run }])，' +
      'bootstrap 顶层只留纯 DOM（按钮门禁 / 外壳导航 / 拖出面板 / 兜底 UI）与 openComGate()。\n' +
      '背景与机制见 ts/tools/com-ready.ts 文件头。',
  )
  process.exit(1)
}

console.log(`✓ 启动期 COM 约束校验通过（${String(checkedFiles)} 个 bootstrap 均走闸门）`)
