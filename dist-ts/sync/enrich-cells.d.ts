/**
 * @fileoverview 富化引擎 · 目标表单元格读写与字段标注（叶子模块）
 * @module sync/enrichCells
 * @description 从 enrich-engine.ts 拆出的「共享基础设施」，被两处同时使用：
 *              - 字段富化组（enrichTags / enrichPlatform / enrichDate / …，留在
 *                enrich-engine.ts）
 *              - 简介富化组（enrich-intro.js）
 *
 *              因此必须独立成模块，否则两组之间会形成反向依赖。
 *
 *              承载内容：
 *              - 目标表单元格读写（readTargetCell / writeTargetCell，带会话缓存穿透）
 *              - 字段名差异标注（getAnnotatedValue + ANNOTATED_FIELD_MAPPINGS）
 *
 * @author BGM Development Team
 */
import type { WpsWorksheet } from '../tools/wps.js';
import type { SheetCellCache } from '../tools/util/sheet.js';
/**
 * 目标表单元格读：有会话缓存走缓存，否则逐格读。
 *
 * 缓存是**写穿透**的（见 createSheetCellCache）——enrichIntroData 写「特点」列后
 * enrichOpEdPv 会再读同一格，走缓存拿到的是**写后新值**，与直接读 COM 一致；
 * 只读缓存在这里会拿到写前旧值，导致 appendFeatures 合并出错。
 */
export declare function readTargetCell(sheet: WpsWorksheet, cache: SheetCellCache | undefined, row: number, column: number): string;
/** 目标表单元格写：有缓存走 cache.write（先写 COM 再穿透更新缓存），否则直接写 */
export declare function writeTargetCell(sheet: WpsWorksheet, cache: SheetCellCache | undefined, row: number, column: number, value: string): void;
/**
 * 获取带字段名标注的值
 * 当源字段名与 Bangumi 列名不同时，只有在白名单中的映射才追加 (源字段名) 后缀
 * 空值不添加标注
 */
export declare function getAnnotatedValue(sourceKey: string, targetColumnName: string, value: string): string;
//# sourceMappingURL=enrich-cells.d.ts.map