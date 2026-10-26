/**
 * 分片清单浮窗的示例数据（**自动生成，勿手改**）
 *
 * 由 scripts/build-shard-samples.mjs 从本地分片数据生成：
 * 挑一条 2026-10-20 数据里 2026 年播出、字段最全的记录
 * （sid=243430 机动战士高达 闪光的哈萨维 喀耳刻的魔女），按 manifest 字段清单输出
 * 每片的「字段 → 类型 → 示例值 → 本地列」。
 *
 * 重新生成：node scripts/build-shard-samples.mjs
 * 一致性守护：tests/shard-samples.test.ts（localColumn 与
 * github-sync-diff 的映射表对齐，防漂移）。
 */
export const SHARD_SAMPLES = {
    "dataUpdatedAt": "2026-10-20",
    "sampleSid": "243430",
    "sampleName": "机动战士高达 闪光的哈萨维 喀耳刻的魔女",
    "shards": [
        {
            "name": "base",
            "fields": [
                {
                    "name": "sid",
                    "type": "string",
                    "sample": "243430",
                    "localColumn": null,
                    "note": "跨片连接键，并用于构造 Bangumi_URL 列（不单独成列）"
                },
                {
                    "name": "name",
                    "type": "string",
                    "sample": "机动战士高达 闪光的哈萨维 喀耳刻的魔女",
                    "localColumn": "名称"
                },
                {
                    "name": "name_original",
                    "type": "string",
                    "sample": "機動戦士ガンダム 閃光のハサウェイ キルケーの魔女",
                    "localColumn": null,
                    "note": "原始名称（与「名称」语义重叠，刻意不映射）"
                },
                {
                    "name": "updatedAt",
                    "type": "string",
                    "sample": "2026-10-20",
                    "localColumn": null,
                    "note": "远端更新时间（仅作数据新鲜度判据）"
                },
                {
                    "name": "date",
                    "type": "string",
                    "sample": "2026-01-30",
                    "localColumn": "开播日期"
                },
                {
                    "name": "meta_tags",
                    "type": "数组",
                    "sample": "科幻 | 剧场版 | 机战 | 悬疑 | 日本 | 剧情 | 小说改",
                    "localColumn": "标签/分级"
                },
                {
                    "name": "nsfw",
                    "type": "boolean",
                    "sample": "false",
                    "localColumn": null,
                    "note": "NSFW 标记"
                }
            ]
        },
        {
            "name": "meta",
            "fields": [
                {
                    "name": "sid",
                    "type": "string",
                    "sample": "243430",
                    "localColumn": null,
                    "note": "跨片连接键，并用于构造 Bangumi_URL 列（不单独成列）"
                },
                {
                    "name": "播放结束",
                    "type": "string",
                    "sample": "2026年1月30日",
                    "localColumn": "完播日"
                },
                {
                    "name": "动画制作公司",
                    "type": "string",
                    "sample": "ONDA+.、サンライズ作画塾 (武良雪那、杉本智明)、バンダイナムコ研究所 (鈴木尚也)、日刻(上海)娱乐有限公司 (飯田貢平)、A-1 Pictures (金子敦史)、エイトビット (小菅秀徳、大竹聖)、STUDIO GRAPH77 (板井將悟)、スタジオM2 (丸山真太郎)、手塚プロダクション…",
                    "localColumn": "制作公司"
                },
                {
                    "name": "话数",
                    "type": "string",
                    "sample": "1",
                    "localColumn": "集数"
                },
                {
                    "name": "片长",
                    "type": "string",
                    "sample": "",
                    "localColumn": "时长"
                },
                {
                    "name": "制片国家",
                    "type": "string",
                    "sample": "",
                    "localColumn": "制片国家"
                },
                {
                    "name": "语言",
                    "type": "string",
                    "sample": "",
                    "localColumn": "语言"
                },
                {
                    "name": "类型",
                    "type": "string",
                    "sample": "",
                    "localColumn": "类型"
                },
                {
                    "name": "导演",
                    "type": "string",
                    "sample": "村瀬修功",
                    "localColumn": "导演"
                },
                {
                    "name": "音乐",
                    "type": "string",
                    "sample": "澤野弘之",
                    "localColumn": "音乐"
                },
                {
                    "name": "人物设定",
                    "type": "string",
                    "sample": "Pablo Uchida、恩田尚之、工原しげき",
                    "localColumn": "人物设定"
                },
                {
                    "name": "机械设定",
                    "type": "string",
                    "sample": "カトキハジメ、山根公利、中谷誠一、玄馬宣彦",
                    "localColumn": "机械设定"
                },
                {
                    "name": "原作",
                    "type": "string",
                    "sample": "富野由悠季・矢立肇『機動戦士ガンダム』より",
                    "localColumn": "原作"
                },
                {
                    "name": "脚本",
                    "type": "string",
                    "sample": "むとうやすゆき",
                    "localColumn": "脚本"
                },
                {
                    "name": "分镜",
                    "type": "string",
                    "sample": "村瀬修功、渡辺信一郎、沖浦啓之、出合小都美",
                    "localColumn": "分镜"
                },
                {
                    "name": "演出",
                    "type": "string",
                    "sample": "金子祥之、守泰祐、熊澤祐嗣、進藤陽平；CG演出：金子祥之",
                    "localColumn": "演出"
                },
                {
                    "name": "原案",
                    "type": "string",
                    "sample": "小说：『機動戦士ガンダム 閃光のハサウェイ』KADOKAWA",
                    "localColumn": "原案"
                },
                {
                    "name": "系列构成",
                    "type": "string",
                    "sample": "",
                    "localColumn": "系列构成"
                },
                {
                    "name": "在线播放平台",
                    "type": "string",
                    "sample": "",
                    "localColumn": "在线播放平台"
                },
                {
                    "name": "别名",
                    "type": "string",
                    "sample": "Mobile Suit Gundam: Hathaway | Kidou Senshi Gundam: Senkou no Hathaway | MOBILE SUIT GUNDAM HATHAWAY The Sorcery of Nymph Circe | 機動戰士高達 閃光之凱薩衛 瑟茜的魔女 …",
                    "localColumn": "别名"
                }
            ]
        },
        {
            "name": "relations",
            "fields": [
                {
                    "name": "sid",
                    "type": "string",
                    "sample": "243430",
                    "localColumn": null,
                    "note": "跨片连接键，并用于构造 Bangumi_URL 列（不单独成列）"
                },
                {
                    "name": "关联条目ID",
                    "type": "string",
                    "sample": "45340 | 243429 | 243431 | 333761 | 619106 | 619108 | 621782 | 624484 | 624513 | 632961 | 634031 | 636127 | 637713",
                    "localColumn": "关联条目ID"
                },
                {
                    "name": "关联的动漫ID",
                    "type": "string",
                    "sample": "243429 | 243431",
                    "localColumn": "关联的动漫ID"
                }
            ]
        },
        {
            "name": "stats",
            "fields": [
                {
                    "name": "sid",
                    "type": "string",
                    "sample": "243430",
                    "localColumn": null,
                    "note": "跨片连接键，并用于构造 Bangumi_URL 列（不单独成列）"
                },
                {
                    "name": "platform",
                    "type": "number",
                    "sample": "3",
                    "localColumn": null,
                    "note": "平台"
                },
                {
                    "name": "series",
                    "type": "boolean",
                    "sample": "false",
                    "localColumn": null,
                    "note": "是否系列作"
                },
                {
                    "name": "score",
                    "type": "number",
                    "sample": "7.4",
                    "localColumn": "评分"
                },
                {
                    "name": "rank",
                    "type": "number",
                    "sample": "1231",
                    "localColumn": "排名"
                },
                {
                    "name": "score_details",
                    "type": "数组",
                    "sample": "6 | 3 | 6 | 13 | 44 | 178 | 587 | 622 | 136 | 35",
                    "localColumn": null,
                    "note": "评分分布"
                },
                {
                    "name": "favorite",
                    "type": "数组",
                    "sample": "1502 | 2311 | 213 | 45 | 17",
                    "localColumn": null,
                    "note": "收藏统计"
                },
                {
                    "name": "tags",
                    "type": "string",
                    "sample": "剧场版:558|高达:395|SUNRISE:361|机战:276|科幻:268|小说改:266|2026:245|富野由悠季:215|闪光的哈萨维:151|日本:102|萝卜:90",
                    "localColumn": null,
                    "note": "用户标签（名称:计数）"
                }
            ]
        },
        {
            "name": "summary",
            "fields": [
                {
                    "name": "sid",
                    "type": "string",
                    "sample": "243430",
                    "localColumn": null,
                    "note": "跨片连接键，并用于构造 Bangumi_URL 列（不单独成列）"
                },
                {
                    "name": "summary",
                    "type": "string",
                    "sample": "U.C.0105，夏亚之乱12年后——。 面对实行高压政策的地球联邦政府，“马夫蒂”以暗杀政府阁僚的方式展开了抵抗。其领袖的真实身份，正是曾与阿姆罗·雷在一年战争中并肩作战的布莱德之子，哈萨维·诺亚。哈萨韦因神秘少女琪琪·安达露西亚展现出的奇异力量而回忆起过去的创伤。在她的言语影响下，他一边动摇，一…",
                    "localColumn": null,
                    "note": "简介原文，表里没有简介列时不写入"
                }
            ]
        },
        {
            "name": "infobox",
            "fields": [
                {
                    "name": "sid",
                    "type": "string",
                    "sample": "243430",
                    "localColumn": null,
                    "note": "跨片连接键，并用于构造 Bangumi_URL 列（不单独成列）"
                },
                {
                    "name": "infobox",
                    "type": "string",
                    "sample": "{{Infobox animanga/Movie |中文名= 机动战士高达 闪光的哈萨维 喀耳刻的魔女 |别名={ [Mobile Suit Gundam: Hathaway] [Kidou Senshi Gundam: Senkou no Hathaway] [MOBILE SUIT GUNDAM…",
                    "localColumn": null,
                    "note": "infobox 原文（未解析），仅作留档"
                }
            ]
        }
    ]
};
