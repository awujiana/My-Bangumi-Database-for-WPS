# GitHub 仓库数据下发指南

本文档说明如何配置 GitHub 仓库，使其作为本插件的数据下发源。

当前已启用 **直接 JSONL 模式**，使用仓库：
[awujiana/Bangumi-Archive-Anime-Excel-to-sync](https://github.com/awujiana/Bangumi-Archive-Anime-Excel-to-sync)

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

实际仓库 `awujiana/Bangumi-Archive-Anime-Excel-to-sync` 结构：

```
Bangumi-Archive-Anime-Excel-to-sync/
├── data/
│   └── bangumi.jsonl        ← 数据文件（7.67MB，直接 JSONL 模式）
├── differences/             ← 差异文件目录
├── dump/                    ← 原始 dump 目录
├── .gitignore
├── github-data-distribution.md
└── 项目操作指南.md
```

## 插件配置

在 WPS Excel 加载项面板中填写以下配置：

| 配置项 | 值                                    | 说明                    |
| ------ | ------------------------------------- | ----------------------- |
| 同步源 | GitHub                                | 选择 GitHub 同步源      |
| owner  | `awujiana`                            | GitHub 仓库所有者       |
| repo   | `Bangumi-Archive-Anime-Excel-to-sync` | 仓库名称                |
| branch | `main`                                | 分支名（默认 main）     |
| path   | `data/bangumi.jsonl`                  | 仓库中 JSONL 文件的路径 |

插件会从以下 URL 读取数据：

```
https://raw.githubusercontent.com/awujiana/Bangumi-Archive-Anime-Excel-to-sync/main/data/bangumi.jsonl
```

## 数据格式

`data/bangumi.jsonl` 为 JSONL 文件（每行一个独立的 JSON 对象，无外层数组括号，无逗号分隔）。

### 实际数据示例

```jsonl
{"sid":"8","url":"https://bgm.tv/subject/8","name":"Code Geass 反叛的鲁路修R2","type":2,"score":8.3,"tags":["叛逆的鲁鲁修","SUNRISE","TV","原创","反逆のルルーシュ","还是死妹控","妹控","2008","codegeass","谷口悟朗","机战"],"comment":"","episode":0,"updatedAt":"2026-07-21T00:00:00Z"}
{"sid":"12","url":"https://bgm.tv/subject/12","name":"人形电脑天使心","type":2,"score":7.5,"tags":["CLAMP","人形电脑天使心","MADHouse","TV","2002","叽","治愈","chobits","漫画改","恋爱","田中理惠"],"comment":"","episode":0,"updatedAt":"2026-07-21T00:00:00Z"}
{"sid":"50","url":"https://bgm.tv/subject/50","name":"机动战士高达","type":2,"score":7.8,"tags":["高达","SUNRISE","富野悠由季","TV","0079","原创","元祖高达","1979","科幻","GUNDAM","阿姆罗"],"comment":"","episode":0,"updatedAt":"2026-07-21T00:00:00Z"}
```

### 字段定义

| 字段        | 类型     | 必填 | 说明                                           |
| ----------- | -------- | ---- | ---------------------------------------------- |
| `sid`       | string   | 是   | Bangumi subject ID（主键，用于比对去重）       |
| `url`       | string   | 否   | 条目 URL，如 `https://bgm.tv/subject/8`        |
| `name`      | string   | 否   | 条目名称                                       |
| `type`      | number   | 否   | 条目类别：1=书籍 2=动漫 3=音乐 4=游戏 6=三次元 |
| `score`     | number   | 否   | 评分（0-10，支持小数如 8.3）                   |
| `tags`      | string[] | 否   | 标签数组                                       |
| `comment`   | string   | 否   | 个人评论（可为空字符串）                       |
| `episode`   | number   | 否   | 看到集数                                       |
| `updatedAt` | string   | 否   | 远程更新时间戳（ISO 8601）                     |

> 插件解析时仅要求 `sid` 为字符串类型，其余字段均为可选。空行与非法行会被跳过并记录警告日志，不中断整体解析。

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

在 WPS Excel 中点击「GitHub 同步」，插件会：

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
  "browser_download_url": "https://github.com/awujiana/Bangumi-Archive-Anime-Excel-to-sync/releases/download/v2026-07-21/dump-2026-07-21.zip",
  "content_type": "application/zip",
  "created_at": "2026-07-21T21:04:41Z",
  "digest": "sha256:e1120169088407c66a94dacacda4dffaabe0e2e08cbcc8238c880f6c0140dd57",
  "id": 485155893,
  "label": "",
  "name": "dump-2026-07-21.zip",
  "size": 419054508,
  "updated_at": "2026-07-21T21:05:00Z",
  "url": "https://api.github.com/repos/awujiana/Bangumi-Archive-Anime-Excel-to-sync/releases/assets/485155893"
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
