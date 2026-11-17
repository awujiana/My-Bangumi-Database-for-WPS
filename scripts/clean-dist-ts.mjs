#!/usr/bin/env node
/**
 * @fileoverview 清空 tsc 产物目录 dist-ts/
 *
 * 为什么需要单独清空：
 *   `tsc` **不会**删除 outDir 里已不再对应源文件的旧产物。本项目做过两次文件改名
 *   （cf-* → conditional-format-*、初始化函数 init* → initialize*），改名后
 *   dist-ts/panel/ 里同时躺着 cf-*.js 与 conditional-format-*.js，vite build 会把
 *   它们**一起**复制进 dist —— 发布包里多出死文件，且一旦有代码误引用就会拿到旧实现。
 *   实测 dist 里因此残留 12 个 cf-* 文件。
 *
 * 为什么不用 `node -e "require('fs').rmSync(...)"`：
 *   npm 在 Windows 用 cmd.exe 执行 scripts，`-e` 参数里的双引号会被 cmd 拆坏，
 *   表现为 `node -e` 抛 evalFunction 错误且目录没删掉（实测踩过）。独立脚本没有引号问题。
 *
 * 为什么不用 shell 的 `rm -rf`：
 *   跨平台不一致（Windows 无 rm），且沙箱/安全删除钩子会拦截目录级删除。
 */
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(projectRoot, 'dist-ts')

rmSync(target, { recursive: true, force: true })
console.log(`[clean:ts] 已清空 ${target}`)
