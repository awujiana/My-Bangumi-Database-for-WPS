#!/usr/bin/env node
/**
 * 一键发布：把「只含发布文件」的 publish 分支推送到远端 release
 *
 * 用法（二选一）：
 *   node scripts/release/publish.mjs          # 在仓库根运行
 *   双击上级目录的 publish.cmd                 # 转发壳，等价于上一条
 *   只演练不推送：node scripts/release/publish.mjs --no-push
 *
 * 本文件在 2026-11-21 收入仓库（原先只存在于上级目录，没有任何版本控制兜底）。
 * 上级目录的 `publish.mjs` / `publish.cmd` 现在是转发壳，逻辑只在这里维护。
 *
 * 流程：
 *   0. fetch 远端（只取信息，不合并）
 *   1. 在 main 上提交本地改动（只提交真实内容变化，行尾差异不会产生提交）
 *   2. 从 main 重建 publish 分支，并把本地工具链从该分支移除
 *   3. 切回 main
 *   4. 推送 publish → origin/release（--force-with-lease：发布分支每次重建，与远端旧提交是兄弟关系）
 *   5. 把本地 main 快进推到 origin/main（普通 push，绝不 force）
 *
 * 分支模型（2026-11-21 起）：
 *   origin/main    = 完整开发树（工具链 / 测试 / 文档全在）—— 正常 git pull，不会再删文件
 *   origin/release = 只含发布文件 + download/ 更新包 —— 插件运行期从这条分支读
 *                    version.json / 更新包 zip / 语言包
 *
 * 为什么不再推 main：远端 main 曾经是「发布树」，任何 `git pull --rebase origin main`
 * 都会把本地工具链连同提交一起删掉（2026-11-08 踩过：丢掉 4 个工具链文件，
 * 另有 52 份从未入库的文档整批消失）。发布产物挪到独立分支后，main 恒为开发树，
 * pull / merge / rebase 都是安全的。**任何时候都不要把发布树推回 main。**
 *
 * 说明：脚本通过自身位置定位仓库根（本文件在 <仓库>/scripts/release/ 下，上溯两级），
 * 不依赖当前工作目录，也不硬编码中文路径。
 */

import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectDir = resolve(scriptDir, '..', '..')
const noPush = process.argv.slice(2).includes('--no-push')

/**
 * 不进入 `release` 发布树的内容
 *
 * 两类：
 * 1. **开发工具链**（`package.json` / `tests` / `scripts` / `tsconfig*` …）——
 *    用户装上也不需要，且含 devDependencies 会误导人 `npm install`。
 * 2. **只给维护者看的内部资料**（`文档/` 约 2.5 MB 架构稿与历史审计报告、`ux-audit.py`
 *    配色验收脚本）—— 它们随 `main` 分发，但没必要占发布树的体积。
 *
 * 注意：`README*` / `CHANGELOG.md` / `PLUGIN-SPEC.md` / `AGENTS.md` / `CONTRIBUTING.md`
 * **不在此列** —— 它们是仓库门面（README 的文档索引直接链到 CHANGELOG），
 * 曾误把 CHANGELOG 列进来，导致远端发布树里根本没有 CHANGELOG。
 * 另外 `locales/` 必须保留：插件运行期要从发布分支下载语言包。
 */
const NOT_IN_RELEASE = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'vite.config.mjs',
  'scripts',
  'tests',
  'patches',
  'eslint.config.mjs',
  'eslint.shadow.config.mjs',
  'lint-staged.config.js',
  'vitest.config.ts',
  'vitest.cov.config.ts',
  '.npmrc',
  '.prettierignore',
  '.prettierrc',
  '文档',
  'ux-audit.py',
]

function git(command, { capture = false } = {}) {
  return execSync(`git ${command}`, {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
}

function gitText(command) {
  return String(git(command, { capture: true })).trim()
}

function hasStagedChanges() {
  try {
    execSync('git diff --cached --quiet', { cwd: projectDir })
    return false
  } catch {
    return true
  }
}

function fail(message) {
  console.error(`\n❌ ${message}`)
  process.exit(1)
}

if (!existsSync(join(projectDir, '.git'))) {
  fail(`找不到项目仓库：${projectDir}`)
}

console.log(`项目目录：${projectDir}`)

// 生成 download/version.json：API 限流时的兜底版本源（发布分支不含 package.json）
//
// v2.2.4 起还写入更新包的 sha256 / size：插件下载完先比对哈希，不一致**直接拒绝安装**。
// 这一环是整条更新链路上唯一的完整性关卡 —— HTTPS 挡不住企业代理做中间人，
// 也挡不住仓库被改（供应链投毒），只有哈希能。
const packageVersion = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).version
mkdirSync(join(projectDir, 'download'), { recursive: true })
const packageName = `My-Bangumi-Database-for-WPS-v${packageVersion}.zip`
const packagePath = join(projectDir, 'download', packageName)
const manifest = { version: packageVersion }
if (existsSync(packagePath)) {
  const buffer = readFileSync(packagePath)
  manifest.sha256 = createHash('sha256').update(buffer).digest('hex')
  manifest.size = buffer.length
  console.log(`更新包指纹：${packageName}（${manifest.size} 字节）sha256=${manifest.sha256}`)
} else {
  console.warn(`⚠️ 没找到 download/${packageName}，version.json 将不含 sha256（客户端会跳过校验）`)
}
writeFileSync(
  join(projectDir, 'download', 'version.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)
console.log(`兜底版本文件：download/version.json（${packageVersion}）`)

// 更新包会被 .gitignore 的 *.zip 忽略，必须显式强制加入（否则远端 raw 404）
try {
  execSync('git add -f download/*.zip', { cwd: projectDir, stdio: 'inherit' })
} catch {
  // 还没有 zip 时忽略
}

// 同步安装包到 release/（本地归档；release/ 被 .gitignore 忽略，不入库）
const releaseDirectory = join(projectDir, 'release')
mkdirSync(releaseDirectory, { recursive: true })
const downloadDirectory = join(projectDir, 'download')
for (const file of readdirSync(downloadDirectory)) {
  if (file.toLowerCase().endsWith('.zip')) {
    copyFileSync(join(downloadDirectory, file), join(releaseDirectory, file))
  }
}
const builtExecutable = join(projectDir, 'wps-addon-build', 'my-bangumi-database-for-wps.exe')
const releaseExecutable = join(
  releaseDirectory,
  `my-bangumi-database-for-wps-v${packageVersion}.exe`,
)
if (existsSync(builtExecutable)) {
  // 有品牌图标就用 Resource Hacker 换掉 wpsjs 的默认图标（脚本自带「除 .rsrc 外逐字节相同」校验）
  const appIcon = join(projectDir, 'images', 'app-icon.ico')
  if (!existsSync(appIcon)) {
    copyFileSync(builtExecutable, releaseExecutable)
    console.warn(`⚠️ 没有 images/app-icon.ico，exe 沿用 wpsjs 默认图标`)
  } else if (process.argv.slice(2).includes('--no-icon')) {
    copyFileSync(builtExecutable, releaseExecutable)
    console.warn('⚠️ --no-icon：跳过换图标，exe 沿用 wpsjs 默认图标')
  } else {
    const iconResult = spawnSync(
      process.execPath,
      ['scripts/replace-icon.mjs', '--icon', appIcon, '--out', releaseExecutable],
      { cwd: projectDir, stdio: 'inherit' },
    )
    if (iconResult.status !== 0) {
      fail(
        '换图标失败（Resource Hacker 未安装 / 路径变了 / 校验没过）。\n' +
          '   用 --no-icon 可以跳过，但发出去的 exe 会是默认图标。',
      )
    }
  }
}
console.log(`安装包已同步到 release/（${packageVersion}）`)

// 0. 只 fetch 远端信息；不 merge。main 是开发树、release 是发布树，两者互不合并。
try {
  gitText('fetch origin')
  const ahead = Number(gitText('rev-list --count HEAD..origin/main'))
  if (ahead > 0) {
    console.log(`⚠️ 远端 main 比本地多 ${ahead} 个提交（正常应是 0 —— main 只由本地推送）`)
    console.log('   请先 git log HEAD..origin/main 看是什么，确认无误再继续；发布产物只该进 release。')
  }
} catch {
  console.warn('⚠️ 无法访问远端（跳过 fetch），继续本地发布')
}

// 1. 提交本地改动（git add -A 后若无真实内容差异则不会产生提交）
console.log('\n检查本地改动…')
git('add -A')
// dist-ts/ 在 .gitignore 里，但历史提交已跟踪它的 185 个产物文件（发布分支需要）。
// 新增模块的编译产物不会被 `git add -A` 收进去 → 发布分支会静默缺文件（装上后 404）。
// 2026-10-27 踩过：新增 tools/update-install.ts 时差点漏发。
try {
  execSync('git add -f dist-ts', { cwd: projectDir, stdio: 'inherit' })
} catch {
  console.warn('⚠️ 强制加入 dist-ts 失败（不影响其它文件）')
}
if (hasStagedChanges()) {
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
  console.log(`发现改动，自动提交：release: 自动发布 ${stamp}`)
  git(`commit -m "release: 自动发布 ${stamp}"`)
} else {
  console.log('没有需要提交的改动')
}

// 2. 重建 publish（移除工具链与内部资料）
console.log('\n重建 publish 分支（移除工具链与内部资料）…')
git('checkout -B publish')
// 用参数数组而不是拼字符串：`文档` 是中文路径，走 cmd.exe 时会被当前代码页（GBK）
// 重新编码，git（期望 UTF-8）匹配不上 → 文档会静默留在发布树里。
const removeResult = spawnSync(
  'git',
  ['rm', '-r', '--cached', '--ignore-unmatch', ...NOT_IN_RELEASE],
  { cwd: projectDir, stdio: 'inherit' },
)
if (removeResult.status !== 0) {
  fail('从 publish 移除工具链失败（git rm 返回非 0）。发布树没清理干净，已中止。')
}
if (hasStagedChanges()) {
  git('commit -m "publish: 仅发布文件（不含本地工具链与内部文档）"')
} else {
  console.log('publish 无新改动（已是最新）')
}

// 3. 切回 main（工具链在 publish 上是未跟踪、在 main 上被跟踪，必须 -f）
git('checkout -f main')

// 4. 推送（发布分支每次从 main 重建，与远端旧发布提交是兄弟关系，需要 force）
if (noPush) {
  console.log('\n（--no-push：跳过推送，publish 分支已在本地更新）')
} else {
  // 发布内容与远端一致时不必推送（避免每次空推一个新提交）
  const changed = gitText('diff --name-only publish origin/release') !== ''
  if (!changed) {
    console.log('\n发布内容与远端一致，无需推送')
  } else {
    console.log('\n推送 publish → origin/release …')
    try {
      git('push --force-with-lease origin publish:release')
    } catch {
      fail('推送失败。请检查网络 / GitHub 凭据；若远端刚被别处改过，先 git fetch origin 再重跑。')
    }
  }
}

// 5. 顺手把本地 main 推到 origin/main（开发树，正常快进推送，绝不用 force）
//    放在最后：万一 push release 失败，main 也还没动，不会出现「源码推了、包没推」。
if (!noPush) {
  const mainAhead = Number(gitText('rev-list --count origin/main..HEAD'))
  if (mainAhead === 0) {
    console.log('origin/main 已是最新')
  } else {
    console.log(`\n推送 main → origin/main（开发树，${mainAhead} 个提交）…`)
    try {
      git('push origin main:main')
    } catch {
      fail(
        '推送 main 失败。main 是开发树且**不允许 force push**：\n' +
          '   先在 GitHub 上确认 origin/main 是否被别处改过（git log HEAD..origin/main）。',
      )
    }
  }
}

console.log('\n✅ 完成：远端 release 只包含发布文件，远端 main 保留工具链。')
