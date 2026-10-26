/**
 * @fileoverview 富化引擎 · 跨模块共享类型
 * @module sync/enrichTypes
 * @description enrich-engine 拆分时被多个模块同时引用的接口集中到这里，避免
 *              「为两个接口反向 import 主模块」的尴尬：
 *
 *              - `EnrichConfig` / `MatchResult`：匹配组与编排组都要
 *              - `EnrichedField` / `ConflictInfo`：字段富化组、简介组、编排组都要
 *              - 统计与进度：编排组产出、UI 层消费
 *
 *              本模块**零运行时依赖**（只有 `import type`），是最底层。
 *
 * @author BGM Development Team
 */
export {};
