# GitHub 仓库数据下发指南

本文档说明如何配置 GitHub 仓库，使其作为本插件的数据下发源。

当前已启用 **直接 JSONL 模式**，使用仓库：
[awujiana/Bangumi-Archive-Anime-Excel](https://github.com/awujiana/Bangumi-Archive-Anime-Excel)

## 工作流程（直接 JSONL 模式 + 本地缓存）

```
插件 ──① 检查本地缓存──▶ 有效缓存？→ 直接返回缓存条目
                   │
                   │ ② 下载 data/bangumi.jsonlines.gz (raw URL) + 计算哈希
                   │
                   │ ③ 哈希比对：与缓存一致？→ 更新时间戳，返回缓存条目
                   │
                   │ ④ 哈希不同 → 逐行解析 JSONL
                   ▼
            ⑤ 按 SID 比对本地 Excel 行
                   │
                   │ ⑥ 增量写入（新增/更新/删除）
                   ▼
            ⑦ 写入 Excel 单元格
```

### 缓存机制说明

为避免每次同步都下载完整的 JSONL 文件（数据文件 gzip 后 20.86 MiB），插件实现了基于 localStorage 的本地缓存策略：

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
├── data/
│   └── bangumi.jsonlines.gz     ← 数据文件（gzip，~21 MB / 解压 55.83 MiB，30836 条）
├── differences/             ← 差异文件目录
├── xlsx/                    ← Excel 文件目录
├── .gitignore
├── github-data-distribution.md
└── 项目操作指南.md
```

## 插件配置

在 WPS Excel 加载项面板中填写以下配置：

| 配置项 | 值                            | 说明                    |
| ------ | ----------------------------- | ----------------------- |
| 同步源 | GitHub                        | 选择 GitHub 同步源      |
| owner  | `awujiana`                    | GitHub 仓库所有者       |
| repo   | `Bangumi-Archive-Anime-Excel` | 仓库名称                |
| branch | `main`                        | 分支名（默认 main）     |
| path   | `data/bangumi.jsonlines.gz`   | 仓库中 JSONL 文件的路径 |

插件会从以下 URL 读取数据：

```
https://raw.githubusercontent.com/awujiana/Bangumi-Archive-Anime-Excel/main/data/bangumi.jsonlines.gz
```

## 数据格式

`data/bangumi.jsonlines.gz` 为「**表头 + 值数组**」两段式 JSONL 文件：
第 1 个非空行是**表头**（纯字符串数组），其后每行是与表头**等长**的**值数组**。

### 实际数据示例

```jsonl
["sid","name","updatedAt","date","meta_tags","nsfw","播放结束","动画制作公司","话数","片长","制片国家","语言","类型","导演","音乐","人物设定","机械设定","原作","脚本","分镜","演出","原案","系列构成","在线播放平台","关联的动漫ID","name_original","type","platform","series","score","rank","score_details","favorite","tags","summary","infobox","别名"]
["8","Code Geass 反叛的鲁路修R2","2026-09-08","2008-04-06",["机战","TV","日本","原创","战斗"],false,"2008年9月28日","サンライズ、david production、スタジオガッツ；作画协力：GONZO","25","","","","","谷口悟朗","中川幸太郎、黒石ひとみ","木村貴宏","寺岡賢司、沙倉拓実；Knightmare设计：安田朗、中田栄治、阿久津潤一","","","","","故事原案：大河内一楼、谷口悟朗","大河内一楼","85 | 344 | 793 | … | 667019","コードギアス 反逆のルルーシュR2",2,1,false,8.3,84,[55,23,45,91,213,756,2597,6175,5714,3071],[2356,29462,500,492,181],"叛逆的鲁鲁修:3072|SUNRISE:2344|原创:1601|…","　　“东京决战”一年后…（325 字符）","{{Infobox animanga/TVAnime\r\n|中文名= Code Geass 反叛的鲁路修R2\r\n…（1992 字符）","叛逆的鲁路修R2 | Code Geass: Hangyaku no Lelouch R2 | …"]
```

> 为便于阅读，上例中 `关联的动漫ID`、`tags`、`summary`、`infobox`、`别名` 的长值已用 `…` 截断，第二条记录已省略。
> 仍然是合法的 JSON Lines（每行一个合法 JSON 值）。值数组的顺序与长度严格对应表头；
> 缺失字段补默认值（字符串 `""`、`meta_tags`/`score_details`/`favorite` 补数组、`nsfw`/`series` 补 `false`、`type`/`platform`/`score`/`rank` 补 `0`）。
> 字段名只在表头出现一次；嵌套结构（`tags`/`score_details`/`favorite`）再做结构压缩，合计省约 7 MiB，且完全无损。

### 字段定义

输出字段共 37 个，分 4 类。BGM 插件 `GithubRemoteEntry` 接口（`ts/sync/github-sync-diff.ts`）识别全部字段。

**基础字段**（4 个）：

| 字段            | 类型   | 必填 | 说明                                                          |
| --------------- | ------ | ---- | ------------------------------------------------------------- |
| `sid`           | string | 是   | Bangumi subject ID（主键，用于比对去重）                      |
| `name`          | string | 否   | 条目名称（写入「名称」列）                                    |
| `name_original` | string | 否   | 原始名（dump.name，与 name 并存，避免原始名丢失）             |
| `updatedAt`     | string | 否   | 远程更新日期，格式 `YYYY-MM-DD`（仅日期，不含时间，节省空间） |

**dump 顶层扩展**（3 个）：

| 字段        | 类型     | 说明                                        |
| ----------- | -------- | ------------------------------------------- |
| `date`      | string   | 开播日期（写入「开播日期」列）              |
| `meta_tags` | string[] | 标签/分级（写入「标签/分级」列，`\|` 分隔） |
| `nsfw`      | bool     | 是否 NSFW（插件暂不写入，保留字段）         |

**infobox 解析扩展**（19 个，中文命名）：

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

**关联字段**（1 个）：

| 字段           | Excel 列名     | 说明                                |
| -------------- | -------------- | ----------------------------------- |
| `关联的动漫ID` | `关联的动漫ID` | 关联 subject_id 列表，`' \| '` 分隔 |

**全量保真扩展**（10 个，2026-09-13 起新增，原始 dump 顶层字段不再裁剪）：

| 字段            | 类型     | 说明                                                      |
| --------------- | -------- | --------------------------------------------------------- |
| `type`          | number   | 条目类型（2=动画）                                        |
| `platform`      | number   | 平台代码                                                  |
| `series`        | bool     | 是否系列作                                                |
| `score`         | number   | 数据源平均分                                              |
| `rank`          | number   | 排名                                                      |
| `score_details` | number[] | 评分分布，固定序 `[1分..10分]` 各自人数（结构压缩）       |
| `favorite`      | number[] | 收藏统计，固定序 `[想看,看过,在看,搁置,抛弃]`（结构压缩） |
| `tags`          | string   | 用户标签，压缩为 `"名称:计数\|名称:计数"`                 |
| `summary`       | string   | 简介                                                      |
| `infobox`       | string   | infobox 原文（不裁剪，含全部 7361 种键）                  |

### 已裁剪字段（仅剩 dump 中本就不存在或恒定的字段）

| 字段      | 说明                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `url`     | dump 不含，从 `sid` 构造（`https://bgm.tv/subject/{sid}`），BGM 插件同步时自动构造写入 `Bangumi_URL` 列 |
| `episode` | dump 不含观看集数，BGM 插件使用 infobox 的「话数」字段写入「集数」列                                    |
| `comment` | dump 不含个人评论，用户在 Excel「剧透/感言」列自行维护                                                  |

> 插件解析时仅要求 `sid` 为字符串类型，其余字段均为可选。空行与非法行会被跳过并记录警告日志，不中断整体解析。

### type 字段语义说明

> ⚠️ **`type` 字段在两个上下文中语义不同**
>
> - **Bangumi 官方 dump**：`type:2` 表示条目类型为「动画」（条目类型，1=漫画 2=动画 3=音乐 4=游戏 6=三次元）
> - **BGM 插件 → Bangumi API**：`type` 表示观看状态（1=想看 2=在看 3=看过 4=搁置 5=抛弃），由用户在 Excel「是否看完」列维护
>
> 自 2026-09-13 起，`data/bangumi.jsonlines.gz` **重新输出 dump 的 `type` 字段**（作为全量保真字段之一），但插件**不会**把它写入任何 Excel 列。两者完全无关。

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

数据文件由 Archive 流水线步骤⑨ 直接生成 gzip 并下发到本仓库，正常无需手工替换；确需手工替换时按下面的方式压缩：

```bash
# 克隆仓库
git clone https://github.com/awujiana/Bangumi-Archive-Anime-Excel-to-sync.git
cd Bangumi-Archive-Anime-Excel-to-sync

# 压缩替换数据文件（-n 去掉时间戳，保证相同内容产出相同字节）
gzip -9 -n -c /path/to/new-bangumi.jsonlines > data/bangumi.jsonlines.gz

# 提交推送
git add data/bangumi.jsonlines.gz
git commit -m "feat: 更新 bangumi 数据 dump $(date +%Y-%m-%d)"
git push origin main
```

### 2. 验证

在 WPS Excel 中点击「数据同步」，插件会：

1. 从 raw URL 下载 `data/bangumi.jsonlines.gz`
2. 逐行解析 JSONL
3. 按 SID 比对本地 Excel 行
4. 根据所选策略增量写入

## 两种下发模式对比

| 特性      | 直接 JSONL 模式（当前启用）          | Release Asset 模式（预留）   |
| --------- | ------------------------------------ | ---------------------------- |
| 适用场景  | gzip 后 < 100 MB（当前 20.86 MiB）   | 大文件（> 100 MB）           |
| path 配置 | `data/bangumi.jsonlines.gz`          | `latest.json`                |
| 数据格式  | gzip 压缩的 JSONL（`.jsonlines.gz`） | zip 压缩包（内含 JSONL）     |
| 版本管理  | 无（直接覆盖）                       | 有（Release tag 历史）       |
| 下载方式  | raw.githubusercontent.com            | github.com/releases/download |
| 限流      | 60 次/小时（未认证）                 | Release 下载不限流           |

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
2. **未认证限流**：raw URL 读取限 60 次/小时/IP
3. **JSONL 格式要求**：第 1 个非空行为表头（纯字符串数组），其后每行为等长值数组，`sid` 字段必须为字符串
4. **文件大小限制**：GitHub raw URL 对单文件无硬性大小限制，但大文件下载较慢，建议 < 50MB
5. **CSP 策略**：插件 CSP 已配置 `connect-src 'self' https://api.bgm.tv https://bangumi.tv https://raw.githubusercontent.com https://api.github.com https://gitlab.com https://gitee.com`，覆盖 GitHub / GitLab / Gitee 三个同步源的域名
