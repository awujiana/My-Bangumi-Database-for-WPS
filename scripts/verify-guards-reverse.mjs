#!/usr/bin/env node
/**
 * @fileoverview 门禁的「反向验证」——证明每个源码级断言真的会红
 *
 * 为什么需要这个脚本：
 *   一条**永远为真**的断言等于没有断言，而它看起来和有效断言一模一样 —— 都是绿色的。
 *   源码级断言（静态检查脚本、对源码文本做断言的测试）尤其容易退化成空断言：
 *     · 正则写宽了，匹配不到任何东西，却报「0 问题」；
 *     · 锚点漂移（改了变量名/文件路径），解析结果变空，仍然静默通过；
 *     · 校验的字段名写错，永远读到 undefined，比较永远相等。
 *   这三类都不会让门禁变红，只会让它**无声地失去作用**。
 *
 *   本项目历史上已多次被这类「静默失效」咬过（平行清单、双份副本、错误的生产者），
 *   所以每加一条源码级断言，都必须回答：**注入一个已知违规，它会红吗？**
 *   本脚本把这个回答变成可执行的用例。
 *
 * 每个用例的四步（缺一步都不算验证过）：
 *   ① 前置：基线状态下该门禁必须是**绿**的（本来就红 → 用例无效，先修门禁本身）；
 *   ② 注入：对目标文件施加一个**已知违规**的变异（锚点必须命中，否则报错而非静默跳过）；
 *   ③ 断言：门禁必须变红，**且失败输出里出现预期片段** ——
 *      只判退出码不够：脚本崩了、依赖没装、路径写错，退出码同样非 0，那是「因错而红」。
 *   ④ 还原：逐字节写回原文件，并在收尾校验工作区仍然干净。
 *
 * 用法：
 *   node scripts/verify-guards-reverse.mjs            # 全部用例
 *   node scripts/verify-guards-reverse.mjs cycles     # 只跑 id 含 cycles 的用例
 *
 * 退出码：0 全部有效；1 存在失效用例（空断言 / 理由不对 / 基线就红）。
 *
 * ⚠️ 本脚本会**临时改写**工作区文件（随后逐字节还原），因此：
 *   · 收尾会核对「脏文件集合跑前跑后完全一致」—— 允许带改动运行，
 *     但一旦崩溃留下残留，`git status` 会立刻多出条目，核对会失败；
 *   · **不要**放进 `npm run gate`、也不要挂进提交钩子（会与其它进程抢文件、且耗时）。
 *     它是「改了 check-*.mjs 之后手工跑一次」的检查。
 *
 * ⚠️ 新增源码级断言时，**必须在本文件 CASES 里补一个变异用例**，
 *    否则这条断言就只是「看起来在守门」。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @typedef {object} GuardCase
 * @property {string} id - 用例标识（也是命令行过滤键）
 * @property {string} label - 这条断言在守什么
 * @property {string} check - 要跑的检查脚本（相对项目根）
 * @property {{ file: string, mode: 'literal' | 'append' | 'regex', from: string, to: string }[]} mutations
 *   `literal` 要求 `from` 恰好出现 1 次；`regex` 用 `from` 作正则替换全部；`append` 追加 `to`。
 * @property {string[]} expectInOutput - 失败输出里必须出现的片段（证明「因预期理由而红」）
 */

/** @type {GuardCase[]} */
// 变异锚点**不能硬编码版本号**：dompurify 一升级（3.4.15 → 3.4.17）锚点就漂移，
// 变异静默不命中 → 这条用例变成「空断言」，正是本脚本要防的事故。
// 改为从被校验文件自身读出当前版本串。
const vendoredDomPurifyLabel =
  /DOMPurify \d+\.\d+\.\d+/.exec(readFileSync(join(projectRoot, 'libs/purify.js'), 'utf8'))?.[0] ??
  ''

const CASES = [
  {
    id: 'ribbon-buttons',
    label: '按钮 id 与 ts/ribbon.ts 的分发表脱节 → 点击静默无反应',
    check: 'scripts/check-ribbon-buttons.mjs',
    mutations: [
      {
        file: 'ribbon.xml',
        mode: 'literal',
        from: 'id="btnSetToken"',
        to: 'id="btnSetTokenProbe"',
      },
    ],
    expectInOutput: ['btnSetTokenProbe'],
  },
  {
    id: 'dompurify-version',
    label: 'vendored 副本与 npm 安装版本漂移 → 「已升级」是假象',
    check: 'scripts/check-dompurify-version.mjs',
    mutations: [
      {
        file: 'libs/purify.js',
        mode: 'literal',
        from: vendoredDomPurifyLabel,
        to: 'DOMPurify 3.0.0',
      },
    ],
    expectInOutput: ['vendored 副本与安装版本不一致'],
  },
  {
    id: 'com-in-loop',
    label: '循环条件里读 COM 属性 → 每轮多一次跨进程往返',
    check: 'scripts/check-com-in-loop.mjs',
    mutations: [
      {
        file: 'ts/tools/log-buffer.ts',
        mode: 'append',
        from: '',
        to:
          '\nexport function __probeReverseVerify(sheets: { Count: number }): void {\n' +
          '  for (let index = 1; index <= sheets.Count; index += 1) {\n' +
          '    void index\n' +
          '  }\n' +
          '}\n',
      },
    ],
    expectInOutput: ['循环条件里直接读 COM 属性', 'Count'],
  },
  {
    id: 'nav-order',
    label: '页面 HTML 的模块 id 与 PAGE_MODULES 脱节 → 拖了排序没反应',
    check: 'scripts/check-nav-order.mjs',
    mutations: [
      {
        file: 'ui/panel.html',
        mode: 'literal',
        from: 'id="sec-remote"',
        to: 'id="sec-probeGhost"',
      },
    ],
    expectInOutput: ['sec-probeGhost'],
  },
  {
    id: 'naming-convention',
    label: '新写的缩写标识符（`ws` / `col`）溜过门禁 → 前几轮人工排查的坑重现',
    // 用 probe-naming.mjs（不加载主配置、几秒出结果）而非 eslint（2.5 分钟）：
    // 两者规则配置同源（scripts/probe-naming.mjs 与 eslint.config.mjs 的四条
    // naming-convention 配置逐项一致），探针红 = 门禁红。
    check: 'scripts/probe-naming.mjs',
    mutations: [
      {
        file: 'ts/tools/log-buffer.ts',
        mode: 'append',
        from: '',
        to: '\nexport const __probeReverseVerifyWs = 1\nexport const __probeReverseVerifyCol = 2\n',
      },
    ],
    expectInOutput: ['__probeReverseVerifyWs', '__probeReverseVerifyCol'],
  },
  {
    id: 'module-manifest',
    label: 'main.js 登记了不存在的模块 → critical 链路断，功能区按钮全废（真机才报）',
    check: 'scripts/check-module-manifest.mjs',
    mutations: [
      {
        file: 'main.js',
        mode: 'literal',
        from: "src: 'dist-ts/core/constants.js'",
        to: "src: 'dist-ts/core/crypto.js'",
      },
    ],
    expectInOutput: ['dist-ts/core/crypto.js', 'dist-ts/ 下没有这个文件'],
  },
  {
    id: 'cycles',
    label: '新增 import 环（logger ↔ log-buffer）→ 顶层跨模块读取的 TDZ 风险',
    check: 'scripts/check-import-cycles.mjs',
    mutations: [
      {
        file: 'ts/tools/log-buffer.ts',
        mode: 'append',
        from: '',
        to: "\nimport { getRecentLogs } from './logger.js'\nvoid getRecentLogs\n",
      },
    ],
    expectInOutput: ['log-buffer', 'logger'],
  },
  {
    id: 'tests-types',
    label: 'tests/ 新增类型错误 → mock 形状与真实接口脱节',
    check: 'scripts/check-tests-types.mjs',
    mutations: [
      {
        file: 'tests/debounce.test.ts',
        mode: 'append',
        from: '',
        to: "\nconst __probeReverseVerify: number = 'not-a-number'\nvoid __probeReverseVerify\n",
      },
    ],
    expectInOutput: ['相对基线增加', 'debounce.test.ts'],
  },
]

/** 运行一个命令，返回退出码与合并输出 */
function run(command, args) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, output: stdout }
  } catch (error) {
    if (error.stdout === undefined && error.stderr === undefined) throw error
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

/** 当前工作区脏文件清单（未跟踪文件也算） */
function snapshotStatus() {
  try {
    return execFileSync('git', ['status', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim()
  } catch {
    return '<无法读取 git 状态>'
  }
}

/**
 * 施加变异，返回原始字节供还原。
 * 锚点失配一律抛错 —— 静默跳过会让这个用例变成新的空断言。
 */
function mutate({ file, mode, from, to }) {
  const target = join(projectRoot, file)
  const original = readFileSync(target)
  const text = original.toString('utf8')
  let mutated

  if (mode === 'literal') {
    const hits = text.split(from).length - 1
    if (hits !== 1) {
      throw new Error(
        `变异锚点在 ${file} 中应恰好出现 1 次，实际 ${hits} 次：${JSON.stringify(from)}`,
      )
    }
    mutated = text.replace(from, to)
  } else if (mode === 'regex') {
    mutated = text.replace(new RegExp(from, 'gu'), to)
    if (mutated === text) throw new Error(`正则变异在 ${file} 中未命中：${JSON.stringify(from)}`)
  } else {
    mutated = text + to
  }

  if (mutated === text) throw new Error(`变异后 ${file} 内容未变化 —— 该用例什么都没验证`)
  writeFileSync(target, mutated, 'utf8')
  return { target, original }
}

function main() {
  const filters = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const cases =
    filters.length > 0 ? CASES.filter((item) => filters.some((f) => item.id.includes(f))) : CASES

  // 不变式：跑前跑后的脏文件集合必须**完全一致**。
  // 比「要求工作区干净」更准 —— 既允许带改动运行，又能抓住「崩溃残留」。
  const statusBefore = snapshotStatus()

  console.log(
    `反向验证 ${String(cases.length)} 条源码级断言（逐字节还原，跑前跑后脏文件集合须一致）\n`,
  )
  if (statusBefore !== '') {
    console.log(`· 提示：当前工作区本就有改动（${String(statusBefore.split('\n').length)} 项），`)
    console.log('  收尾会核对脏文件集合未变化，因此不会把「你原本的改动」误判成残留。\n')
  }
  const results = []

  for (const item of cases) {
    console.log(`===== ${item.id}  ${item.label}`)
    const checkArgs = [item.check]

    // ① 基线必须绿
    const base = run(process.execPath, checkArgs)
    if (base.code !== 0) {
      console.log(`  [跳过] 基线就是红的（退出码 ${String(base.code)}）—— 用例无效，先修门禁本身`)
      console.log(`  ${base.output.trim().split('\n').slice(0, 4).join('\n  ')}`)
      results.push({ id: item.id, verdict: 'SKIP', note: '基线红' })
      continue
    }
    console.log('  [1/4] 基线绿 ✔')

    // ②③④ 注入 → 断言 → 还原
    const applied = []
    try {
      try {
        for (const mutation of item.mutations) {
          applied.push(mutate(mutation))
          console.log(`  [2/4] 已注入违规 → ${mutation.file}`)
        }
      } catch (error) {
        console.log(`  [2/4] ✖ 变异失败：${error.message}`)
        results.push({ id: item.id, verdict: 'MUTATION-ERROR', note: error.message.slice(0, 60) })
        continue
      }

      const mutated = run(process.execPath, checkArgs)
      if (mutated.code === 0) {
        console.log('  [3/4] ✖ 仍是绿的 —— 这是一条空断言（永远为真）')
        results.push({ id: item.id, verdict: 'VACUOUS', note: '注入违规后仍绿' })
        continue
      }

      const missing = item.expectInOutput.filter((fragment) => !mutated.output.includes(fragment))
      if (missing.length > 0) {
        console.log(`  [3/4] ⚠ 变红了，但输出里没有预期片段 ${JSON.stringify(missing)}`)
        console.log(
          '         这通常意味着脚本是**崩了**而非断言命中 —— 退出码非 0 不足以证明断言有效。',
        )
        console.log(`  ${mutated.output.trim().split('\n').slice(0, 6).join('\n  ')}`)
        results.push({ id: item.id, verdict: 'WRONG-REASON', note: `缺片段 ${missing.join(',')}` })
        continue
      }

      const headline = mutated.output.split('\n').find((line) => line.trim() !== '') ?? ''
      console.log(`  [3/4] 变红且理由正确 ✔（退出码 ${String(mutated.code)}）`)
      console.log(`        首行：${headline.trim().slice(0, 100)}`)
      results.push({ id: item.id, verdict: 'OK', note: '' })
    } finally {
      for (const { target, original } of applied) {
        writeFileSync(target, original)
        if (!readFileSync(target).equals(original)) throw new Error(`还原失败：${target}`)
      }
      console.log('  [4/4] 已逐字节还原 ✔\n')
    }
  }

  console.log('='.repeat(74))
  for (const { id, verdict, note } of results) {
    console.log(`${id.padEnd(20)} ${verdict.padEnd(15)} ${note}`)
  }
  console.log('='.repeat(74))

  const bad = results.filter((item) => item.verdict !== 'OK')
  console.log(
    `\n共 ${String(results.length)} 条：有效 ${String(results.length - bad.length)}，有问题 ${String(bad.length)}`,
  )

  const statusAfter = snapshotStatus()
  if (statusAfter !== statusBefore) {
    console.error('\n✖ 收尾时脏文件集合发生了变化 —— 有文件未被还原：')
    console.error(`  跑前：\n${statusBefore}`)
    console.error(`  跑后：\n${statusAfter}`)
    process.exit(1)
  }
  console.log('· 收尾核对：脏文件集合未变化，无残留 ✔')

  if (bad.length > 0) process.exit(1)
}

main()
