import { describe, it, expect } from 'vitest'
import {
  BgmUserSchema,
  BgmCollectionSchema,
  GithubEntrySchema,
  SyncStrategySchema,
  GithubConfigSchema,
  FullConfigSchema,
} from '../ts/schemas/index.js'

describe('BgmUserSchema', () => {
  it('合法用户对象通过', () => {
    const valid = {
      id: 12345,
      username: 'sai',
      nickname: 'Sai',
      avatar: {
        large: 'https://example.com/large.png',
        medium: 'https://example.com/medium.png',
        small: 'https://example.com/small.png',
      },
    }
    const parsed = BgmUserSchema.parse(valid)
    expect(parsed.id).toBe(12345)
    expect(parsed.username).toBe('sai')
    expect(parsed.nickname).toBe('Sai')
    expect(parsed.avatar?.large).toBe('https://example.com/large.png')
  })

  it('缺少 id 抛错', () => {
    const invalid = {
      username: 'sai',
    }
    expect(() => BgmUserSchema.parse(invalid)).toThrow()
  })

  it('id 为负数抛错', () => {
    const invalid = {
      id: -1,
      username: 'sai',
    }
    expect(() => BgmUserSchema.parse(invalid)).toThrow()
  })

  it('nickname 缺省时默认为空字符串', () => {
    const parsed = BgmUserSchema.parse({ id: 1, username: 'sai' })
    expect(parsed.nickname).toBe('')
  })
})

describe('BgmCollectionSchema', () => {
  const validSubject = {
    id: 265,
    name: 'Chobits',
    name_cn: '人形电脑天使心',
    url: 'https://bgm.tv/subject/265',
  }

  it('合法收藏通过', () => {
    const valid = {
      date: '2024-01-01',
      type: 2,
      rate: 8,
      subject: validSubject,
      subject_id: 265,
      private: false,
      tags: ['sci-fi'],
      comment: 'good',
      ep_status: 0,
    }
    const parsed = BgmCollectionSchema.parse(valid)
    expect(parsed.type).toBe(2)
    expect(parsed.subject.id).toBe(265)
    expect(parsed.tags).toEqual(['sci-fi'])
  })

  it('type 超出 1-5 抛错', () => {
    const invalid = {
      type: 6,
      subject: validSubject,
      subject_id: 265,
    }
    expect(() => BgmCollectionSchema.parse(invalid)).toThrow()
  })

  it('type 为 0 抛错', () => {
    const invalid = {
      type: 0,
      subject: validSubject,
      subject_id: 265,
    }
    expect(() => BgmCollectionSchema.parse(invalid)).toThrow()
  })

  it('rate 超出 0-10 抛错', () => {
    const invalid = {
      type: 2,
      rate: 11,
      subject: validSubject,
      subject_id: 265,
    }
    expect(() => BgmCollectionSchema.parse(invalid)).toThrow()
  })

  it('rate 为负数抛错', () => {
    const invalid = {
      type: 2,
      rate: -1,
      subject: validSubject,
      subject_id: 265,
    }
    expect(() => BgmCollectionSchema.parse(invalid)).toThrow()
  })
})

describe('GithubEntrySchema', () => {
  it('合法条目通过', () => {
    const valid = {
      sid: '265',
      url: 'https://bgm.tv/subject/265',
      name: 'Chobits',
      type: 2,
      tags: ['sci-fi'],
      episode: 26,
      updatedAt: '2024-01-01T00:00:00Z',
    }
    const parsed = GithubEntrySchema.parse(valid)
    expect(parsed.sid).toBe('265')
    expect(parsed.type).toBe(2)
    expect(parsed.tags).toEqual(['sci-fi'])
  })

  it('sid 为空字符串抛错', () => {
    const invalid = {
      sid: '',
    }
    expect(() => GithubEntrySchema.parse(invalid)).toThrow()
  })

  it('缺少 sid 抛错', () => {
    const invalid = {
      name: 'Chobits',
    }
    expect(() => GithubEntrySchema.parse(invalid)).toThrow()
  })

  it('type=6 合法通过（Bangumi 三次元类别）', () => {
    const valid = {
      sid: '265',
      type: 6,
    }
    const parsed = GithubEntrySchema.parse(valid)
    expect(parsed.type).toBe(6)
  })

  it('type=0 抛错（不在 1-6 范围）', () => {
    const invalid = {
      sid: '265',
      type: 0,
    }
    expect(() => GithubEntrySchema.parse(invalid)).toThrow()
  })

  it('type=7 抛错（超出 1-6 范围）', () => {
    const invalid = {
      sid: '265',
      type: 7,
    }
    expect(() => GithubEntrySchema.parse(invalid)).toThrow()
  })

  it('扩展字段通过 passthrough 保留', () => {
    const valid = {
      sid: '265',
      url: 'https://bgm.tv/subject/265',
      name: 'Chobits',
      type: 2,
      tags: ['sci-fi'],
      episode: 26,
      updatedAt: '2024-01-01T00:00:00Z',
      // 扩展字段
      date: '2002-04-08',
      platform: 2,
      meta_tags: ['科幻'],
      nsfw: false,
      播放结束: '2002-09-30',
      动画制作公司: 'Madhouse',
      话数: '26',
      片长: '24分钟',
      制片国家: '日本',
      语言: '日语',
      类型: 'TV',
      导演: '浅香守生',
      音乐: '田中秀和',
      人物设定: 'CLAMP',
      机械设定: '无',
      原作: 'CLAMP',
      脚本: '大桥志吉',
      分镜: '浅香守生',
      演出: '浅香守生',
      原案: 'CLAMP',
      系列构成: '大桥志吉',
      在线播放平台: 'Bilibili',
      关联的动漫ID: '265 | 266',
    }
    const parsed = GithubEntrySchema.parse(valid) as Record<string, unknown>
    expect(parsed.sid).toBe('265')
    expect(parsed.date).toBe('2002-04-08')
    expect(parsed.动画制作公司).toBe('Madhouse')
    expect(parsed.关联的动漫ID).toBe('265 | 266')
  })
})

describe('SyncStrategySchema', () => {
  it('5 个合法值通过', () => {
    const validValues = [
      'add-update',
      'add-only',
      'update-only',
      'mirror',
      'force-overwrite',
    ] as const
    for (const v of validValues) {
      expect(SyncStrategySchema.parse(v)).toBe(v)
    }
  })

  it('非法值抛错', () => {
    expect(() => SyncStrategySchema.parse('unknown')).toThrow()
    expect(() => SyncStrategySchema.parse('')).toThrow()
    expect(() => SyncStrategySchema.parse('ADD-UPDATE')).toThrow()
  })
})

describe('GithubConfigSchema', () => {
  it('完整配置通过', () => {
    const valid = {
      owner: 'myname',
      repo: 'bgm-sync',
      branch: 'main',
      path: 'data/collection.json',
      strategy: 'mirror',
      sourceType: 'gitee',
    }
    const parsed = GithubConfigSchema.parse(valid)
    expect(parsed.owner).toBe('myname')
    expect(parsed.strategy).toBe('mirror')
    expect(parsed.sourceType).toBe('gitee')
  })

  it('缺少 owner 抛错', () => {
    const invalid = {
      repo: 'bgm-sync',
      branch: 'main',
      path: 'data/collection.json',
    }
    expect(() => GithubConfigSchema.parse(invalid)).toThrow()
  })

  it('owner 为空字符串抛错', () => {
    const invalid = {
      owner: '',
      repo: 'bgm-sync',
      branch: 'main',
      path: 'data/collection.json',
    }
    expect(() => GithubConfigSchema.parse(invalid)).toThrow()
  })

  it('缺少必填项 repo 抛错', () => {
    const invalid = {
      owner: 'myname',
      branch: 'main',
      path: 'data/collection.json',
    }
    expect(() => GithubConfigSchema.parse(invalid)).toThrow()
  })

  it('strategy 缺省时默认为 add-update', () => {
    const parsed = GithubConfigSchema.parse({
      owner: 'myname',
      repo: 'bgm-sync',
      branch: 'main',
      path: 'data/collection.json',
    })
    expect(parsed.strategy).toBe('add-update')
    expect(parsed.sourceType).toBe('github')
  })

  it('非法 strategy 抛错', () => {
    const invalid = {
      owner: 'myname',
      repo: 'bgm-sync',
      branch: 'main',
      path: 'data/collection.json',
      strategy: 'invalid-strategy',
    }
    expect(() => GithubConfigSchema.parse(invalid)).toThrow()
  })
})

describe('FullConfigSchema', () => {
  it('合法 JSON 通过', () => {
    const valid = {
      version: 1,
      exportedAt: '2024-01-01T00:00:00Z',
      token: 'ghp_xxx',
      userId: '12345',
      githubConfig: {
        owner: 'myname',
        repo: 'bgm-sync',
        branch: 'main',
        path: 'data/collection.json',
        strategy: 'mirror',
        sourceType: 'github',
      },
    }
    const parsed = FullConfigSchema.parse(valid)
    expect(parsed.version).toBe(1)
    expect(parsed.githubConfig?.owner).toBe('myname')
  })

  it('version 错误抛错', () => {
    const invalid = {
      version: 2,
      exportedAt: '2024-01-01T00:00:00Z',
    }
    expect(() => FullConfigSchema.parse(invalid)).toThrow()
  })

  it('version 为字符串抛错', () => {
    const invalid = {
      version: '1',
      exportedAt: '2024-01-01T00:00:00Z',
    }
    expect(() => FullConfigSchema.parse(invalid)).toThrow()
  })

  it('缺少 exportedAt 抛错', () => {
    const invalid = {
      version: 1,
    }
    expect(() => FullConfigSchema.parse(invalid)).toThrow()
  })

  it('可选字段缺失通过', () => {
    const valid = {
      version: 1,
      exportedAt: '2024-01-01T00:00:00Z',
    }
    const parsed = FullConfigSchema.parse(valid)
    expect(parsed.version).toBe(1)
    expect(parsed.token).toBeUndefined()
    expect(parsed.githubConfig).toBeUndefined()
  })
})
