# GitHub 仓库数据下发指南

本文档说明如何配置 GitHub 仓库，使其作为本插件的数据下发源。

当前已启用 **直接 JSONL 模式**，使用仓库：
[awujiana/Bangumi-Archive-Anime-Excel](https://github.com/awujiana/Bangumi-Archive-Anime-Excel)

## 工作流程（直接 JSONL 模式）

```
插件 ──① 读取──▶ data/bangumi.jsonl (raw URL)
                   │
                   │ ② 逐行解析 JSONL
                   ▼
            ③ 按 SID 比对本地 Excel 行
                   │
                   │ ④ 增量写入（新增/更新/删除）
                   ▼
            ⑤ 写入 Excel 单元格
```

## 仓库结构

实际仓库 `awujiana/Bangumi-Archive-Anime-Excel` 结构：

```
Bangumi-Archive-Anime-Excel/
├── data/
│   └── bangumi.jsonl        ← 数据文件（~15.80 MB，30502 条，直接 JSONL 模式）
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
| path   | `data/bangumi.jsonl`          | 仓库中 JSONL 文件的路径 |

插件会从以下 URL 读取数据：

```
https://raw.githubusercontent.com/awujiana/Bangumi-Archive-Anime-Excel/main/data/bangumi.jsonl
```

## 数据格式

`data/bangumi.jsonl` 为 JSONL 文件（每行一个独立的 JSON 对象，无外层数组括号，无逗号分隔）。

### 实际数据示例

```jsonl
{"sid":"8","name":"Code Geass 反叛的鲁路修R2","updatedAt":"2026-07-21","date":"2008-04-06","meta_tags":["机战","TV","日本","原创","战斗"],"nsfw":false,"播放结束":"2008年9月28日","动画制作公司":"サンライズ、david production、スタジオガッツ；作画协力：GONZO","话数":"25","片长":"","制片国家":"","语言":"","类型":"","导演":"谷口悟朗","音乐":"中川幸太郎、黒石ひとみ","人物设定":"木村貴宏","机械设定":"寺岡賢司、沙倉拓実；Knightmare设计：安田朗、中田栄治、阿久津潤一","原作":"","脚本":"","分镜":"","演出":"","原案":"故事原案：大河内一楼、谷口悟朗","系列构成":"大河内一楼","在线播放平台":"","关联的动漫ID":"85 | 344 | 793"}
{"sid":"12","name":"人形电脑天使心","updatedAt":"2026-07-21","date":"2002-04-02","meta_tags":["科幻","TV","恋爱","日本","漫画改","日常"],"nsfw":false,"播放结束":"2002年9月24日","动画制作公司":"MADHOUSE","话数":"27","片长":"","制片国家":"","语言":"","类型":"","导演":"浅香守生","音乐":"高浪敬太郎","人物设定":"阿部恒","机械设定":"","原作":"CLAMP","脚本":"","分镜":"","演出":"","原案":"","系列构成":"","在线播放平台":"","关联的动漫ID":"11 | 497"}
{"sid":"50","name":"机动战士高达","updatedAt":"2026-07-21","date":"1979-04-07","meta_tags":["科幻","机战","TV","日本","原创"],"nsfw":false,"播放结束":"1980年1月26日","动画制作公司":"日本サンライズ","话数":"43","片长":"","制片国家":"","语言":"","类型":"","导演":"","音乐":"渡辺岳夫、松山祐士","人物设定":"安彦良和","机械设定":"大河原邦男","原作":"矢立肇、富野喜幸","脚本":"星山博之","分镜":"斧谷稔","演出":"貞光紳也","原案":"","系列构成":"","在线播放平台":"","关联的动漫ID":"47 | 286"}
```

### 字段定义

输出字段共 25 个，分 3 类。BGM 插件 `GithubRemoteEntry` 接口（`ts/sync/githubSyncDiff.ts`）识别全部字段。

**基础字段**（3 个）：

| 字段        | 类型   | 必填 | 说明                                                          |
| ----------- | ------ | ---- | ------------------------------------------------------------- |
| `sid`       | string | 是   | Bangumi subject ID（主键，用于比对去重）                      |
| `name`      | string | 否   | 条目名称（写入「名称」列）                                    |
| `updatedAt` | string | 否   | 远程更新日期，格式 `YYYY-MM-DD`（仅日期，不含时间，节省空间） |

**dump 顶层扩展**（3 个）：

| 字段        | 类型     | 说明                                        |
| ----------- | -------- | ------------------------------------------- |
| `date`      | string   | 开播日期（写入「开播日期」列）              |
| `meta_tags` | string[] | 标签/分级（写入「标签/分级」列，`\|` 分隔） |
| `nsfw`      | bool     | 是否 NSFW（插件暂不写入，保留字段）         |

**infobox 解析扩展**（19 个，中文命名）：

| 字段           | Excel 列名     | 说明                                |
| -------------- | -------------- | ----------------------------------- |
| `话数`         | `集数`         | 集数（独立处理，BGM 插件核心字段）  |
| `播放结束`     | `完播日`       | 完播日                              |
| `动画制作公司` | `制作公司`     | 制作公司                            |
| `片长`         | `时长`         | 时长/分钟                           |
| `制片国家`     | `制片国家`     | 同名映射                            |
| `语言`         | `语言`         | 同名映射                            |
| `类型`         | `类型`         | 同名映射                            |
| `导演`         | `导演`         | 同名映射                            |
| `音乐`         | `音乐`         | 同名映射                            |
| `人物设定`     | `人物设定`     | 同名映射                            |
| `机械设定`     | `机械设定`     | 同名映射                            |
| `原作`         | `原作`         | 同名映射                            |
| `脚本`         | `脚本`         | 同名映射                            |
| `分镜`         | `分镜`         | 同名映射                            |
| `演出`         | `演出`         | 同名映射                            |
| `原案`         | `原案`         | 同名映射                            |
| `系列构成`     | `系列构成`     | 同名映射                            |
| `在线播放平台` | `在线播放平台` | 同名映射                            |
| `关联的动漫ID` | `关联的动漫ID` | 关联 subject_id 列表，`' \| '` 分隔 |

### 不输出字段（已移除以减少冗余和内存占用）

| 字段       | 移除原因                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------- |
| `url`      | 从 `sid` 构造（`https://bgm.tv/subject/{sid}`），BGM 插件同步时自动构造写入 `Bangumi_URL` 列 |
| `type`     | dump 中恒为 `2`（动画条目类型），BGM 插件默认按 2 处理，输出冗余                             |
| `tags`     | 与 `meta_tags` 语义冗余，BGM 插件仅使用 `meta_tags` 写入「标签/分级」列                      |
| `episode`  | dump 中恒为 `0`，BGM 插件使用 infobox 的「话数」字段写入「集数」列                           |
| `platform` | BGM 插件 `EXTENDED_FIELD_MAP` 已移除该字段映射                                               |
| `score`    | dump 的 `score` 为数据源平均分（非用户打分），用户在 Excel「打分」列自行维护                 |
| `comment`  | dump 不含个人评论，用户在 Excel「剧透/感言」列自行维护                                       |

> 插件解析时仅要求 `sid` 为字符串类型，其余字段均为可选。空行与非法行会被跳过并记录警告日志，不中断整体解析。

### type 字段语义说明

> ⚠️ **`type` 字段在两个上下文中语义不同**
>
> - **Bangumi 官方 dump**：`type:2` 表示条目类型为「动画」（条目类型，1=漫画 2=动画 3=音乐 4=游戏 6=三次元）
> - **BGM 插件 → Bangumi API**：`type` 表示观看状态（1=想看 2=在看 3=看过 4=搁置 5=抛弃），由用户在 Excel「是否看完」列维护
>
> 自 2026-07-30 起，`data/bangumi.jsonl` **不再输出 `type` 字段**（dump 中恒为 2，输出冗余；BGM 插件同步记录中固定显示「动漫」类型）。两者完全无关。

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

将最新的 bangumi 数据导出为 JSONL 格式，替换仓库中的 `data/bangumi.jsonl`：

```bash
# 克隆仓库
git clone https://github.com/awujiana/Bangumi-Archive-Anime-Excel-to-sync.git
cd Bangumi-Archive-Anime-Excel-to-sync

# 替换数据文件
cp /path/to/new-bangumi.jsonl data/bangumi.jsonl

# 提交推送
git add data/bangumi.jsonl
git commit -m "feat: 更新 bangumi 数据 dump $(date +%Y-%m-%d)"
git push origin main
```

### 2. 验证

在 WPS Excel 中点击「数据同步」，插件会：

1. 从 raw URL 下载 `data/bangumi.jsonl`
2. 逐行解析 JSONL
3. 按 SID 比对本地 Excel 行
4. 根据所选策略增量写入

## 两种下发模式对比

| 特性      | 直接 JSONL 模式（当前启用） | Release Asset 模式（预留）   |
| --------- | --------------------------- | ---------------------------- |
| 适用场景  | 小文件（< 100MB）           | 大文件（> 100MB）            |
| path 配置 | `data/bangumi.jsonl`        | `latest.json`                |
| 数据格式  | 直接 JSONL                  | zip 压缩包（内含 JSONL）     |
| 版本管理  | 无（直接覆盖）              | 有（Release tag 历史）       |
| 下载方式  | raw.githubusercontent.com   | github.com/releases/download |
| 限流      | 60 次/小时（未认证）        | Release 下载不限流           |

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

> **注意**：当前插件代码仅实现了直接 JSONL 模式。Release Asset 模式（zip 下载+解压）需在 `ts/sync/githubSync.ts` 中新增实现。

## 注意事项

1. **仓库必须为 public**，否则 raw URL 读取需认证
2. **未认证限流**：raw URL 读取限 60 次/小时/IP
3. **JSONL 格式要求**：每行一个 JSON 对象，`sid` 字段必须为字符串
4. **文件大小限制**：GitHub raw URL 对单文件无硬性大小限制，但大文件下载较慢，建议 < 50MB
5. **CSP 策略**：插件 CSP 已配置 `connect-src 'self' https://api.bgm.tv https://bangumi.tv https://raw.githubusercontent.com https://api.github.com https://gitlab.com https://gitee.com`，覆盖 GitHub / GitLab / Gitee 三个同步源的域名
