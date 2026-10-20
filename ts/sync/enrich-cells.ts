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

import { getCellValue, setCellValue } from '../tools/util/index.js'
import type { WpsWorksheet } from '../tools/wps.js'
import type { SheetCellCache } from '../tools/util/sheet.js'

/**
 * 目标表单元格读：有会话缓存走缓存，否则逐格读。
 *
 * 缓存是**写穿透**的（见 createSheetCellCache）——enrichIntroData 写「特点」列后
 * enrichOpEdPv 会再读同一格，走缓存拿到的是**写后新值**，与直接读 COM 一致；
 * 只读缓存在这里会拿到写前旧值，导致 appendFeatures 合并出错。
 */
export function readTargetCell(
  sheet: WpsWorksheet,
  cache: SheetCellCache | undefined,
  row: number,
  column: number,
): string {
  return cache ? cache.read(row, column) : getCellValue(sheet, row, column)
}

/** 目标表单元格写：有缓存走 cache.write（先写 COM 再穿透更新缓存），否则直接写 */
export function writeTargetCell(
  sheet: WpsWorksheet,
  cache: SheetCellCache | undefined,
  row: number,
  column: number,
  value: string,
): void {
  if (cache) {
    cache.write(row, column, value)
    return
  }
  setCellValue(sheet, row, column, value)
}

/**
 * 需要标注的字段映射白名单（只有这些映射会添加括号）
 * 格式: "源字段名→目标列名"
 */
const ANNOTATED_FIELD_MAPPINGS = new Set<string>(['编剧→脚本', '人设→人物设定', 'CG导演→演出'])

/**
 * 获取带字段名标注的值
 * 当源字段名与 Bangumi 列名不同时，只有在白名单中的映射才追加 (源字段名) 后缀
 * 空值不添加标注
 */
export function getAnnotatedValue(sourceKey: string, targetColName: string, value: string): string {
  if (!value) return value
  if (sourceKey === targetColName) return value
  const mappingKey = `${sourceKey}→${targetColName}`
  if (!ANNOTATED_FIELD_MAPPINGS.has(mappingKey)) return value
  return `${value}(${sourceKey})`
}
