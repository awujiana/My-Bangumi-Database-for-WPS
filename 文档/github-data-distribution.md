# GitHub 仓库数据下发指南

本文档说明如何配置 GitHub 仓库，使其作为本插件的数据下发源。

当前已启用 **分片 JSONL 模式**（清单 + 6 片），使用仓库：
[awujiana/Bangumi-Archive-Anime-Excel](https://github.com/awujiana/Bangumi-Archive-Anime-Excel)

## 工作流程（清单选片 + 本地缓存）

```
插件 ──① 检查本地缓存──▶ 有效缓存？→ 直接返回缓存条目
                   │
                   │ ② 读表头推导需要的字段 → 读清单 data/anime.manifest.json
                   │    （清单声明各片文件名/字段/大小/哈希）
                   │
                   │ ③ 选片：必选片 base + 命中字段的片
                   │    （用户手动勾选过分片时以勾选为准）
                   │
                   │ ④ 逐片下载 anime.<shard>.jsonlines.gz (raw URL) + 解压
                   │
                   │ ⑤ 按行号拼接各片（每片都带 sid，行序一致）
                   ▼
            ⑥ 按 SID 比对本地 Excel 行
                   │
                   │ ⑦ 增量写入（新增/更新/删除）
                   ▼
            ⑧ 写入 Excel 单元格
```

### 按表头自动选片

数据文件按字段类别切成 6 片，插件**只下载本次同步真正会用到的片**：

| 情形                          | 行为                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| 表头读得到                    | 只下载 `base` + 表头命中的片（例如表里没有长文本列，就不下载 `infobox` / `summary`） |
| 表头读不到（空表 / 无工作表） | **全量下载 6 片**（保守兜底，避免写入时缺列）                                        |
| 用户在设置面板手动勾选分片    | 以勾选结果为准，但 `base` 固定必选不可取消                                           |

> 实测：Excel 实际用到的 27 列压完只有 **3.37 MiB**，相对全量 21 MB **减少约 84%** 下载量。
> `infobox`（8.4 MB）+ `summary`（7.8 MB）两片就占了全部体积的 77%。

### 缓存机制说明

为避免每次同步都重复下载（全部分片 gzip 后合计约 21 MB），插件实现了基于 localStorage 的本地缓存策略：

- **缓存有效期**：24 小时（可在 UI 中手动清除）
- **哈希算法**：DJB2（32 位无符号整数，8 位十六进制，冲突率可忽略）
- **降级策略**：网络请求失败或超时时，自动降级使用已缓存数据
- **缓存内容**：解析后的条目数组、原始文本哈希、数据源 URL、下载时间戳
- **UI 显示**：GitHub 配置区域实时显示缓存状态（条目数、哈希前 8 位、缓存年龄）

### 同步策略

插件支持 5 种同步策略（在 GitHub 配置区域下拉选择）：

| 策略              | 说明                                 |
| ----------------- | ------------------------------------ |
| `add-update`      | 新增+更新，不删除（默认，保守）      |
| `add-only`        | 仅新增本地不存在的 SID，不更新已有行 |
| `update-only`     | 仅更新本地已存在的 SID，不新增行     |
| `mirror`          | 镜像同步（新增+更新+删除本地多余行） |
| `force-overwrite` | 强制覆盖（用远程值覆盖本地，含空值） |

## 仓库结构

实际仓库 `awujiana/Bangumi-Archive-Anime-Excel` 结构：

```
Bangumi-Archive-Anime-Excel/
├── data/                        ← BGM 插件数据源（6 片 + 清单，合计 ~21 MB / 解压 57.35 MiB，30836 条）
│   ├── anime.manifest.json      ← 清单（插件先读它，再决定下载哪些片）
│   ├── anime.base.jsonlines.gz
│   ├── anime.meta.jsonlines.gz
│   ├── anime.relations.jsonlines.gz
│   ├── anime.stats.jsonlines.gz
│   ├── anime.summary.jsonlines.gz
│   └── anime.infobox.jsonlines.gz
├── differences/             ← 差异文件目录
├── xlsx/                    ← Excel 文件目录
├── .gitignore
├── github-data-distribution.md
└── 项目操作指南.md
```

## 插件配置

在 WPS Excel 加载项面板中填写以下配置：

| 配置项   | 值                            | 说明                              |
| -------- | ----------------------------- | --------------------------------- |
| 同步源   | GitHub                        | 选择 GitHub 同步源                |
| owner    | `awujiana`                    | GitHub 仓库所有者                 |
| repo     | `Bangumi-Archive-Anime-Excel` | 仓库名称                          |
| branch   | `main`                        | 分支名（默认 main）               |
| path     | `data/anime.manifest.json`    | 仓库中**分片清单**的路径          |
| 数据分片 | 留空 = 自动                   | 勾选即手动指定（`base` 固定必选） |

插件会从以下 URL 读取清单：

```
https://raw.githubusercontent.com/awujiana/Bangumi-Archive-Anime-Excel/main/data/anime.manifest.json
```

> 清单里的 `file` 只写文件名，插件按**清单所在目录**解析分片路径，因此数据仓库把 `data/` 改名或挪位置都不需要改插件配置。
>
> 历史配置里的旧路径（`data/bangumi.jsonlines` / `data/bangumi.jsonlines.gz`）会在读取时被 `github-config.ts` 的迁移表一次性改写成清单路径，不需要用户手工修改。
> **旧单片文件已不再兼容**：路径不是 `.json` 时插件会直接给出明确报错，而不是拿二进制去 `JSON.parse`。

## 数据格式

### 清单 `data/anime.manifest.json`

插件**先读清单**再决定下载哪些片。清单只有 2 KB 出头，一次 GET 就能拿到全部分片的文件名、字段列表、字节数与 sha256 —— 不必靠 404 试探某个片存不存在。

```json
{
  "formatVersion": 1,
  "subjectType": 2,
  "typeLabel": "anime",
  "updatedAt": "2026-09-08",
  "recordCount": 30836,
  "shards": [
    {
      "name": "base",
      "file": "anime.base.jsonlines.gz",
      "fields": ["sid", "name", "name_original", "updatedAt", "date", "meta_tags", "nsfw"],
      "bytes": 1114259,
      "sha256": "7a63103de0fd5284c11dee2d4225d59f57e6264b7acee4c921bf8347f93deb8b"
    }
  ]
}
```

> 上面只列了 `base` 一片，实际有 6 项；`sha256` 可用于下载后的完整性校验。

| 分片        | 文件                           | 字段数 | 大小    | 内容                                                                       |
| ----------- | ------------------------------ | ------ | ------- | -------------------------------------------------------------------------- |
| `base`      | `anime.base.jsonlines.gz`      | 7      | ~1.1 MB | `sid`、`name`、`name_original`、`updatedAt`、`date`、`meta_tags`、`nsfw`   |
| `meta`      | `anime.meta.jsonlines.gz`      | 20     | ~2.0 MB | infobox 解析出的 19 个中文列                                               |
| `relations` | `anime.relations.jsonlines.gz` | 2      | ~0.3 MB | `关联的动漫ID`                                                             |
| `stats`     | `anime.stats.jsonlines.gz`     | 8      | ~1.6 MB | `platform`、`series`、`score`、`rank`、`score_details`、`favorite`、`tags` |
| `summary`   | `anime.summary.jsonlines.gz`   | 2      | ~7.8 MB | `summary`（简介）                                                          |
| `infobox`   | `anime.infobox.jsonlines.gz`   | 2      | ~8.4 MB | `infobox`（wiki 原文）                                                     |

### 分片格式

**每个分片各自独立**，都是「**表头 + 值数组**」两段式 JSONL：第 1 个非空行是该片的**表头**（纯字符串数组），其后每行是与表头**等长**的**值数组**。

以 `base` 片为例：

```jsonl
["sid","name","name_original","updatedAt","date","meta_tags","nsfw"]
["8","Code Geass 反叛的鲁路修R2","コードギアス 反逆のルルーシュR2","2026-09-08","2008-04-06",["机战","TV","日本","原创","战斗"],false]
```

以 `meta` 片为例（`sid` 之后是 infobox 解析出的 19 个中文列）：

```jsonl
["sid","播放结束","动画制作公司","话数","片长","制片国家","语言","类型","导演","音乐","人物设定","机械设定","原作","脚本","分镜","演出","原案","系列构成","在线播放平台","别名"]
["8","2008年9月28日","サンライズ、david production、スタジオガッツ；作画协力：GONZO","25","","","","","谷口悟朗","中川幸太郎、黒石ひとみ","木村貴宏","寺岡賢司、沙倉拓実；Knightmare设计：安田朗、中田栄治、阿久津潤一","","","","","故事原案：大河内一楼、谷口悟朗","大河内一楼","85 | 344 | 793 | … | 667019","叛逆的鲁路修R2 | …"]
```

> 为便于阅读，上例中长值已用 `…` 截断，第二条记录已省略。
> 仍然是合法的 JSON Lines（每行一个合法 JSON 值）。值数组的顺序与长度**严格对应该片的表头**；
> 缺失字段补默认值（字符串 `""`、`meta_tags`/`score_details`/`favorite` 补数组、`nsfw`/`series` 补 `false`、`platform`/`score`/`rank` 补 `0`）。
> 字段名只在各片表头出现一次；嵌套结构（`tags`/`score_details`/`favorite`）再做结构压缩，合计省约 7 MiB，且完全无损。

### 拼接约定

- **每片都带 `sid`**：它是唯一的连接键；各片行序与 dump 完全一致，所以按**行号**即可拼接（不必建索引，也不要求 sid 可比较大小）。
- 除 `sid` 外各片字段**两两不重叠**，任意组合下载都不会互相覆盖。
- 拼接时会校验：各片行数一致、除 `sid` 外无字段重复、每行长度与表头一致 —— 任一不满足即报错，不产出半成品。

### 字段定义

输出字段共 **36 个**（不含 `type`），按分片归为 6 组；`sid` 为唯一必填主键，其余字段均为可选。
BGM 插件 `GithubRemoteEntry` 接口（`ts/sync/github-sync-diff.ts`）识别全部字段。

**基础字段**（4 个，在 `base` 片）：

| 字段            | 类型   | 必填 | 说明                                                          |
| --------------- | ------ | ---- | ------------------------------------------------------------- |
| `sid`           | string | 是   | Bangumi subject ID（主键，用于比对去重）                      |
| `name`          | string | 否   | 条目名称（写入「名称」列）                                    |
| `name_original` | string | 否   | 原始名（dump.name，与 name 并存，避免原始名丢失）             |
| `updatedAt`     | string | 否   | 远程更新日期，格式 `YYYY-MM-DD`（仅日期，不含时间，节省空间） |

**dump 顶层扩展**（3 个，在 `base` 片）：

| 字段        | 类型     | 说明                                        |
| ----------- | -------- | ------------------------------------------- |
| `date`      | string   | 开播日期（写入「开播日期」列）              |
| `meta_tags` | string[] | 标签/分级（写入「标签/分级」列，`\|` 分隔） |
| `nsfw`      | bool     | 是否 NSFW（插件暂不写入，保留字段）         |

**infobox 解析扩展**（19 个，中文命名，在 `meta` 片）：

| 字段           | Excel 列名     | 说明                                  |
| -------------- | -------------- | ------------------------------------- |
| `别名`         | （暂无）       | 别名，`' \| '` 分隔（99.7% 记录都有） |
| `话数`         | `集数`         | 集数（独立处理，BGM 插件核心字段）    |
| `播放结束`     | `完播日`       | 完播日                                |
| `动画制作公司` | `制作公司`     | 制作公司                              |
| `片长`         | `时长`         | 时长/分钟                             |
| `制片国家`     | `制片国家`     | 同名映射                              |
| `语言`         | `语言`         | 同名映射                              |
| `类型`         | `类型`         | 同名映射                              |
| `导演`         | `导演`         | 同名映射                              |
| `音乐`         | `音乐`         | 同名映射                              |
| `人物设定`     | `人物设定`     | 同名映射                              |
| `机械设定`     | `机械设定`     | 同名映射                              |
| `原作`         | `原作`         | 同名映射                              |
| `脚本`         | `脚本`         | 同名映射                              |
| `分镜`         | `分镜`         | 同名映射                              |
| `演出`         | `演出`         | 同名映射                              |
| `原案`         | `原案`         | 同名映射                              |
| `系列构成`     | `系列构成`     | 同名映射                              |
| `在线播放平台` | `在线播放平台` | 同名映射                              |

**关联字段**（1 个，在 `relations` 片）：

| 字段           | Excel 列名     | 说明                                |
| -------------- | -------------- | ----------------------------------- |
| `关联的动漫ID` | `关联的动漫ID` | 关联 subject_id 列表，`' \| '` 分隔 |

**全量保真扩展**（9 个，`stats` 片 7 个 + `summary`/`infobox` 各 1 个，2026-09-13 起新增）：

| 字段            | 类型     | 所在片    | 说明                                                      |
| --------------- | -------- | --------- | --------------------------------------------------------- |
| `platform`      | number   | `stats`   | 平台代码                                                  |
| `series`        | bool     | `stats`   | 是否系列作                                                |
| `score`         | number   | `stats`   | 数据源平均分（写入「评分」列）                            |
| `rank`          | number   | `stats`   | 类别内排名（写入「排名」列）                              |
| `score_details` | number[] | `stats`   | 评分分布，固定序 `[1分..10分]` 各自人数（结构压缩）       |
| `favorite`      | number[] | `stats`   | 收藏统计，固定序 `[想看,看过,在看,搁置,抛弃]`（结构压缩） |
| `tags`          | string   | `stats`   | 用户标签，压缩为 `"名称:计数\|名称:计数"`                 |
| `summary`       | string   | `summary` | 简介                                                      |
| `infobox`       | string   | `infobox` | infobox 原文（不裁剪，含全部 7361 种键）                  |

### 已裁剪字段（仅剩 dump 中本就不存在或恒定的字段）

| 字段      | 说明                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `type`    | 条目类型恒为 2（动画），由文件名 `anime` 表达，**不再输出**（2026-09-18 起）                            |
| `url`     | dump 不含，从 `sid` 构造（`https://bgm.tv/subject/{sid}`），BGM 插件同步时自动构造写入 `Bangumi_URL` 列 |
| `episode` | dump 不含观看集数，BGM 插件使用 infobox 的「话数」字段写入「集数」列                                    |
| `comment` | dump 不含个人评论，用户在 Excel「剧透/感言」列自行维护                                                  |

> 插件解析时仅要求 `sid` 为字符串类型，其余字段均为可选。空行与非法行会被跳过并记录警告日志，不中断整体解析。

### type 字段为何被移除

> ⚠️ **`type` 在两个上下文中语义不同，因此已从数据里删除**
>
> - **Bangumi 官方 dump**：`type:2` 表示条目类型为「动画」（1=漫画 2=动画 3=音乐 4=游戏 6=三次元）
> - **BGM 插件 → Bangumi API**：`type` 表示观看状态（1=想看 2=在看 3=看过 4=搁置 5=抛弃），由用户在 Excel「是否看完」列维护
>
> 两者完全无关。数据仓库只存 `type=2`，该字段恒定且冗余，留着还容易被误读为观看状态，
> 因此自 2026-09-18 起**任何数据文件都不再输出 `type`**，改用文件名里的 `anime` 表示「仅 type=2」。
> 移除它本身只省 30,836 字节（0.05%）—— 下载收益来自分片，不来自删字段。

## 同步策略

插件支持 5 种同步策略，在面板中选择：

| 策略              | 说明                                 |
| ----------------- | ------------------------------------ |
| `add-update`      | 新增+更新，不删除（默认，保守）      |
| `add-only`        | 仅新增本地不存在的 SID，不更新已有行 |
| `update-only`     | 仅更新本地已存在的 SID，不新增行     |
| `mirror`          | 镜像同步（新增+更新+删除本地多余行） |
| `force-overwrite` | 强制覆盖（用远程值覆盖本地，含空值） |

## 发布新版本流程

### 1. 更新数据文件

分片与清单由 Archive 流水线步骤⑨ 直接生成 gzip 并下发到本仓库，正常无需手工替换；确需手工替换时按下面的方式压缩：

```bash
# 克隆仓库
git clone https://github.com/awujiana/Bangumi-Archive-Anime-Excel-to-sync.git
cd Bangumi-Archive-Anime-Excel-to-sync

# 逐个分片压缩（-n 去掉时间戳，保证相同内容产出相同字节；与流水线参数一致）
for shard in base meta relations stats summary infobox; do
  gzip -9 -n -c "/path/to/anime.${shard}.jsonlines" > "data/anime.${shard}.jsonlines.gz"
done

# 提交推送（清单里的 bytes / sha256 也要同步更新，否则校验会失败）
git add data/anime.*.jsonlines.gz data/anime.manifest.json
git commit -m "feat: 更新 bangumi 分片数据 $(date +%Y-%m-%d)"
git push origin main
```

> **不要用 Git LFS**：raw CDN 对二进制 `.jsonlines` **不做透明 gzip**，必须自行压缩。

### 2. 验证

在 WPS Excel 中点击「数据同步」，插件会：

1. 读表头推导需要的字段，拉取 `data/anime.manifest.json`
2. 按清单选片（`base` 必选 + 命中字段的片）
3. 逐片从 raw URL 下载并解压
4. 按行号拼接各片，校验行数与字段
5. 按 SID 比对本地 Excel 行
6. 根据所选策略增量写入

## 两种下发模式对比

| 特性      | 分片 JSONL 模式（当前启用）             | Release Asset 模式（预留）   |
| --------- | --------------------------------------- | ---------------------------- |
| 适用场景  | 分片后合计 < 100 MB（当前 21.11 MiB）   | 大文件（> 100 MB）           |
| path 配置 | `data/anime.manifest.json`              | `latest.json`                |
| 数据格式  | 6 片 gzip 压缩的 JSONL + 一份 JSON 清单 | zip 压缩包（内含 JSONL）     |
| 按需下载  | 支持（按表头选片，最多省 ~84%）         | 不支持（整包下载）           |
| 版本管理  | 无（直接覆盖）                          | 有（Release tag 历史）       |
| 下载方式  | raw.githubusercontent.com               | github.com/releases/download |
| 限流      | 60 次/小时（未认证）                    | Release 下载不限流           |

### Release Asset 模式（预留，当前未实现）

若数据文件超过 100MB，可改用 Release Asset 模式。需在仓库根目录放置 `latest.json`：

```json
{
  "browser_download_url": "https://github.com/awujiana/Bangumi-Archive-Anime-Excel/releases/download/v2026-07-21/dump-2026-07-21.zip",
  "content_type": "application/zip",
  "created_at": "2026-07-21T21:04:41Z",
  "digest": "sha256:e1120169088407c66a94dacacda4dffaabe0e2e08cbcc8238c880f6c0140dd57",
  "id": 485155893,
  "label": "",
  "name": "dump-2026-07-21.zip",
  "size": 419054508,
  "updated_at": "2026-07-21T21:05:00Z",
  "url": "https://api.github.com/repos/awujiana/Bangumi-Archive-Anime-Excel/releases/assets/485155893"
}
```

插件读取此 JSON 后，通过 `browser_download_url` 下载 zip 并解压。

> **注意**：当前插件代码仅实现了直接 JSONL 模式。Release Asset 模式（zip 下载+解压）需在 `ts/sync/github-sync.ts` 中新增实现。

## 注意事项

1. **仓库必须为 public**，否则 raw URL 读取需认证
2. **未认证限流**：raw URL 读取限 60 次/小时/IP（分片模式下一次同步最多 7 次请求：1 清单 + 最多 6 片）
3. **JSONL 格式要求**：每个分片的第 1 个非空行为表头（纯字符串数组），其后每行为等长值数组，`sid` 字段必须为字符串
4. **文件大小限制**：GitHub raw URL 对单文件无硬性大小限制，但大文件下载较慢，建议 < 50MB（分片后最大单片 8.4 MB）
5. **CSP 策略**：插件 CSP 已配置 `connect-src 'self' https://api.bgm.tv https://bangumi.tv https://raw.githubusercontent.com https://api.github.com https://gitlab.com https://gitee.com`，覆盖 GitHub / GitLab / Gitee 三个同步源的域名
6. **Gist 源不支持分片**：Gist API 的 `files[*].content` 只承载文本，读不了 gzip 分片，因此 Gist 同步源不提供分片选择
