// @vitest-environment node
/**
 * @fileoverview 分片清单浮窗示例数据（ts/ui/handlers/shard-samples.ts）单测
 *
 * 守住三件事：
 * 1. **映射不漂移**：samples 里每个字段的 localColumn 必须与
 *    `github-sync-diff.ts` 的 CORE_FIELD_COLUMNS / EXTENDED_FIELD_MAP 一致——
 *    脚本 scripts/build-shard-samples.mjs 里有一份手抄映射，改了 TS 常量忘了
 *    重跑脚本，浮窗就会告诉用户错误的列名（比没有说明更糟）。
 * 2. **结构完整**：6 片齐全、字段数与 manifest 对齐、每条样本有类型与示例值。
 * 3. **生成文件卫生**：头部带「自动生成」标记（提示勿手改）。
 */

import { describe, expect, it } from 'vitest'

import { SHARD_SAMPLES } from '../ts/ui/handlers/shard-samples.js'
import {
  CORE_FIELD_COLUMNS,
  EXTENDED_FIELD_MAP,
} from '../ts/sync/github-sync-diff.js'

/** 从 TS 常量派生「字段 → 本地列」权威表 */
const authoritativeColumns = new Map<string, string | null>(
  [...CORE_FIELD_COLUMNS, ...EXTENDED_FIELD_MAP].map(([field, column]) => [field, column]),
)

describe('SHARD_SAMPLES · 结构与卫生', () => {
  it('六片齐全（base/meta/relations/stats/summary/infobox）', () => {
    expect(SHARD_SAMPLES.shards.map((shard) => shard.name)).toEqual([
      'base',
      'meta',
      'relations',
      'stats',
      'summary',
      'infobox',
    ])
  })

  it('每条样本带数据日期与样本条目（示例值有出处）', () => {
    expect(SHARD_SAMPLES.dataUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(SHARD_SAMPLES.sampleSid).not.toBe('')
    expect(SHARD_SAMPLES.sampleName).not.toBe('')
  })

  it('每个字段都有类型与示例文本（空值样本为「此条为空」兜底）', () => {
    for (const shard of SHARD_SAMPLES.shards) {
      for (const field of shard.fields) {
        expect(field.type, `${shard.name}.${field.name}`).not.toBe('')
        expect(typeof field.sample, `${shard.name}.${field.name}`).toBe('string')
        expect(field.name, `${shard.name} 字段名`).not.toBe('')
      }
    }
  })

  it('base 片必含连接键 sid 与筛选依据 date', () => {
    const base = SHARD_SAMPLES.shards.find((shard) => shard.name === 'base')
    expect(base?.fields.map((field) => field.name)).toContain('sid')
    expect(base?.fields.map((field) => field.name)).toContain('date')
  })

  it('relations 片两个关联 ID 都在（浮窗说明区分的对象）', () => {
    const relations = SHARD_SAMPLES.shards.find((shard) => shard.name === 'relations')
    const names = relations?.fields.map((field) => field.name) ?? []
    expect(names).toContain('关联条目ID')
    expect(names).toContain('关联的动漫ID')
  })
})

describe('SHARD_SAMPLES · localColumn 与同步映射一致（防漂移）', () => {
  it('有本地列的字段，列名与 CORE/EXTENDED 映射表完全一致', () => {
    // filter 先算再 for：no-continue 禁 continue、unicorn 又禁 if 包全循环体，
    // 两条规则在「跳过某些项」时互斥，filter 是同时满足两者的写法
    const covered = SHARD_SAMPLES.shards
      .flatMap((shard) => shard.fields.map((field) => ({ shardName: shard.name, field })))
      .filter(({ field }) => authoritativeColumns.has(field.name))
    for (const { shardName, field } of covered) {
      expect(field.localColumn, `${shardName}.${field.name}`).toBe(
        authoritativeColumns.get(field.name),
      )
    }
  })

  it('映射表里的每个字段都在 samples 里有对应行（不漏字段）', () => {
    const sampled = new Set(
      SHARD_SAMPLES.shards.flatMap((shard) => shard.fields.map((field) => field.name)),
    )
    for (const field of authoritativeColumns.keys()) {
      expect(sampled.has(field), `映射表字段 ${field} 未出现在示例数据里`).toBe(true)
    }
  })

  it('无本地列的字段必须给一句说明（不能光秃秃 null）', () => {
    for (const shard of SHARD_SAMPLES.shards) {
      for (const field of shard.fields) {
        if (field.localColumn === null) {
          expect(field.note, `${shard.name}.${field.name} 无列但无说明`).toBeTruthy()
        }
      }
    }
  })
})
