// 一次性 codemod：把 @typescript-eslint/naming-convention 报出的缩写标识符全拼化。
// dry-run（默认）只打印映射与命中数；加 --apply 才写文件。
// 用法：node scripts/rename-abbreviations.mjs [--apply]
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TARGET_DIRS = ['ts', 'tests']

// ===== 1) 显式覆盖：自动化规则会出错或语义不佳的名字 =====
const EXPLICIT = {
  // ⚠️ img / win / cls 存在**字符串字面量**同名出现（'img' 是 DOM 标签白名单、
  // 'win.xlsx' 是测试路径、', cls: ' 是调试文本），整体替换会改坏数据，
  // 故这三个**不进自动替换表**，由人工逐处改名。
  imgUrlElement: 'imageUrlElement',
  winApp: 'windowApp',
  // 第二批（首轮 codemod 之后 lint 仍报出的残留）
  impl: 'implementation',
  utilMock: 'utilityMock',
  origParse: 'originalParse',
  vals: 'values',
  _def: '_definition',
  _val: '_value',
  wbOpt: 'workbookOption',
  setWin: 'setWindowProperty',
  delWin: 'deleteWindowProperty',
  ws1: 'worksheet1',
  _ws2: '_worksheet2',
  COL_MAP: 'COLUMN_MAP',
  DEFAULT_COL_MAP: 'DEFAULT_COLUMN_MAP',
  BASE_COL_MAP: 'BASE_COLUMN_MAP',
  COL_NAME: 'COLUMN_NAME',
  COL_STATUS: 'COLUMN_STATUS',
  COL_RATE: 'COLUMN_RATE',
  COL_TAGS: 'COLUMN_TAGS',
  COL_EPISODES: 'COLUMN_EPISODES',
  COL_SEQ: 'COLUMN_SEQ',
  opt: 'option',
  vals: 'values',
  _vals: '_values',
  impl: 'implementation',
  origParse: 'originalParse',
  delRow: 'rowToDelete',
  delCount: 'countToDelete',
  _ws: '_worksheet',
  _col: '_column',
  _colMap: '_columnMap',
  ws2: 'worksheet2',
  // UPPER_CASE 常量（大小写规则覆盖不到）
  DEFAULT_SEQ_COL: 'DEFAULT_SEQ_COLUMN',
  ENRICH_RECORD_COL: 'ENRICH_RECORD_COLUMN',
  FULL_COL_MAP: 'FULL_COLUMN_MAP',
  IMPORTANT_COLS: 'IMPORTANT_COLUMNS',
  PREVIEW_FIELD_COLS: 'PREVIEW_FIELD_COLUMNS',
  SYNC_RECORD_COL: 'SYNC_RECORD_COLUMN',
  XINFAN_SCAN_COLS: 'XINFAN_SCAN_COLUMNS',
  TXT_MIME: 'TEXT_MIME',
  TXT_SEPARATOR: 'TEXT_SEPARATOR',
  MAX_COMMENT_LEN: 'MAX_COMMENT_LENGTH',
}

// ===== 2) 词段规则：只替换「后接大写/数字/_/结尾」的词段，避免误伤 Color / Column =====
// 顺序敏感：复数先替换，避免 `Cols` 被单数规则拆坏。
const SEGMENT_RULES = [
  [/Sids(?=[A-Z0-9_]|$)/gu, 'SubjectIds'],
  [/Sid(?=[A-Z0-9_]|$)/gu, 'SubjectId'],
  [/Cols(?=[A-Z0-9_]|$)/gu, 'Columns'],
  [/Col(?=[A-Z0-9_]|$)/gu, 'Column'],
  [/Num(?=[A-Z0-9_]|$)/gu, 'Number'],
  [/Img(?=[A-Z0-9_]|$)/gu, 'Image'],
  [/Ws(?=[A-Z0-9_]|$)/gu, 'Worksheet'],
  [/Err(?=[A-Z0-9_]|$)/gu, 'Error'],
  [/Opt(?=[A-Z0-9_]|$)/gu, 'Option'],
  [/Impl(?=[A-Z0-9_]|$)/gu, 'Implementation'],
]

// 第二批：首轮 codemod 之后 `npx eslint ts tests` 仍报出的 60 个名字
const NAMES = `COL_MAP DEFAULT_COL_MAP BASE_COL_MAP COL_NAME COL_STATUS COL_RATE COL_TAGS
COL_EPISODES COL_SEQ badWs goodWs setWin delWin createColMap throwOnCol fallbackColMap wbOpt
sheetOpt mockColNumToLetter origParse impl defaultWs fakeWs makeSelectableWs asWs buildColMap
createGridWs _mockErrorWs MockWsRange MockWs createMockWs ws1 _ws2 firstNonEmptyCol readColName
mappedCols failCols _def _val vals LiteZodImpl thSid maxWriteCol categoryCol finishedCol scoreCol
commentCol conflictSids seqColForLocate avatarImg topbarAvatarImg tokenAvatarImg byCol readCol
urlColForLocate nextCol richColMap syncRecordCol selectImpl`
  .split(/\s+/u)
  .filter(Boolean)

const buildNewName = (name) => {
  if (Object.hasOwn(EXPLICIT, name)) return EXPLICIT[name]
  let out = name
  for (const [pattern, replacement] of SEGMENT_RULES) {
    out = out.replace(pattern, replacement)
  }
  return out
}

const MAPPING = new Map(NAMES.map((name) => [name, buildNewName(name)]))
// 长名优先，避免 `maxCol` 先命中导致 `maxCols` 被拆坏
const orderedNames = [...MAPPING.keys()].sort((a, b) => b.length - a.length)
const combined = new RegExp(
  `(?<![A-Za-z0-9_$])(${orderedNames.map((n) => n.replace(/\$/gu, '\\$')).join('|')})(?![A-Za-z0-9_$])`,
  'gu',
)

const listFiles = (dir) => {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

const apply = process.argv.includes('--apply')
let hitTotal = 0
const fileHits = new Map()

for (const dir of TARGET_DIRS) {
  for (const file of listFiles(path.join(ROOT, dir))) {
    const source = fs.readFileSync(file, 'utf8')
    const replaced = source.replace(combined, (match) => MAPPING.get(match) ?? match)
    if (replaced === source) continue
    const count = [...source.matchAll(combined)].length
    hitTotal += count
    fileHits.set(path.relative(ROOT, file), count)
    if (apply) fs.writeFileSync(file, replaced)
  }
}

console.log(apply ? '已写入' : 'DRY-RUN', '命中', hitTotal, '处 /', fileHits.size, '个文件')
for (const [file, count] of [...fileHits].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(String(count).padStart(6), file)
}
if (!apply) {
  console.log('\n映射表：')
  for (const [old, next] of MAPPING) console.log('  ', old, '→', next)
}
