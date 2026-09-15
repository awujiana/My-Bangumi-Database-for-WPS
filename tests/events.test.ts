import { describe, it, expect, beforeEach } from 'vitest'
import { EventBus, BGM_EVENTS, eventBus } from '../ts/tools/events.js'

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  describe('on / emit', () => {
    it('应调用订阅的处理器', () => {
      let isCalled = false
      bus.on('test', () => {
        isCalled = true
      })
      bus.emit('test')
      expect(isCalled).toBe(true)
    })

    it('应传递数据给处理器', () => {
      let received: unknown
      bus.on('data', (data: unknown) => {
        received = data
      })
      bus.emit('data', { key: 'value' })
      expect(received).toEqual({ key: 'value' })
    })

    it('应支持多个处理器', () => {
      let count = 0
      bus.on('multi', () => {
        count += 1
      })
      bus.on('multi', () => {
        count += 1
      })
      bus.emit('multi')
      expect(count).toBe(2)
    })

    it('不同事件应互不影响', () => {
      let a = 0
      let b = 0
      bus.on('a', () => {
        a += 1
      })
      bus.on('b', () => {
        b += 1
      })
      bus.emit('a')
      expect(a).toBe(1)
      expect(b).toBe(0)
    })
  })

  describe('once', () => {
    it('应只触发一次', () => {
      let count = 0
      bus.once('once', () => {
        count += 1
      })
      bus.emit('once')
      bus.emit('once')
      expect(count).toBe(1)
    })
  })

  describe('off', () => {
    it('应移除指定处理器', () => {
      let count = 0
      const handler = () => {
        count += 1
      }
      bus.on('test', handler)
      bus.emit('test')
      expect(count).toBe(1)
      bus.off('test', handler)
      bus.emit('test')
      expect(count).toBe(1)
    })

    it('不传处理器时应移除所有处理器', () => {
      let a = 0
      let b = 0
      bus.on('test', () => {
        a += 1
      })
      bus.on('test', () => {
        b += 1
      })
      bus.off('test')
      bus.emit('test')
      expect(a).toBe(0)
      expect(b).toBe(0)
    })

    it('对不存在的事件调用 off 不应报错', () => {
      expect(() => bus.off('nonexistent')).not.toThrow()
    })
  })

  describe('has / listenerCount', () => {
    it('has 应返回是否有订阅者', () => {
      expect(bus.has('test')).toBe(false)
      bus.on('test', () => {})
      expect(bus.has('test')).toBe(true)
    })

    it('listenerCount 应返回订阅数量', () => {
      expect(bus.listenerCount('test')).toBe(0)
      bus.on('test', () => {})
      expect(bus.listenerCount('test')).toBe(1)
      bus.on('test', () => {})
      expect(bus.listenerCount('test')).toBe(2)
    })
  })

  describe('clear', () => {
    it('应清空所有事件', () => {
      bus.on('a', () => {})
      bus.on('b', () => {})
      bus.clear()
      expect(bus.has('a')).toBe(false)
      expect(bus.has('b')).toBe(false)
      expect(bus.listenerCount('a')).toBe(0)
    })
  })

  describe('错误处理', () => {
    it('处理器异常不应中断其他处理器', () => {
      let isSecondCalled = false
      bus.on('err', () => {
        throw new Error('boom')
      })
      bus.on('err', () => {
        isSecondCalled = true
      })
      bus.emit('err')
      expect(isSecondCalled).toBe(true)
    })
  })

  describe('便捷方法 emitStateChanged / emitConfigChanged', () => {
    it('emitStateChanged 以 state:changed 事件派发 { key, value }', () => {
      const received: unknown[] = []
      bus.on(BGM_EVENTS.STATE_CHANGED, (data: unknown) => {
        received.push(data)
      })
      bus.emitStateChanged('theme', 'dark')
      expect(received).toEqual([{ key: 'theme', value: 'dark' }])
    })

    it('emitConfigChanged 以 config:changed 事件派发 { key, value }', () => {
      const received: unknown[] = []
      bus.on(BGM_EVENTS.CONFIG_CHANGED, (data: unknown) => {
        received.push(data)
      })
      bus.emitConfigChanged('navIconsOnly', true)
      expect(received).toEqual([{ key: 'navIconsOnly', value: true }])
    })

    it('两个便捷方法互不串台（各自只触发对应事件）', () => {
      const stateEvents: unknown[] = []
      const configEvents: unknown[] = []
      bus.on(BGM_EVENTS.STATE_CHANGED, (data: unknown) => {
        stateEvents.push(data)
      })
      bus.on(BGM_EVENTS.CONFIG_CHANGED, (data: unknown) => {
        configEvents.push(data)
      })
      bus.emitStateChanged('a', 1)
      bus.emitConfigChanged('b', 2)
      expect(stateEvents).toEqual([{ key: 'a', value: 1 }])
      expect(configEvents).toEqual([{ key: 'b', value: 2 }])
    })
  })
})

describe('BGM_EVENTS 常量', () => {
  it('应包含所有预期事件', () => {
    expect(BGM_EVENTS.TOKEN_UPDATED).toBe('state:tokenUpdated')
    expect(BGM_EVENTS.USER_ID_UPDATED).toBe('state:userIdUpdated')
    expect(BGM_EVENTS.SYNC_PROGRESS).toBe('sync:progress')
    expect(BGM_EVENTS.SYNC_COMPLETED).toBe('sync:completed')
    expect(BGM_EVENTS.SYNC_ERROR).toBe('sync:error')
    expect(BGM_EVENTS.CONFIG_UPDATED).toBe('config:updated')
    expect(BGM_EVENTS.REQUEST_GITHUB_SYNC).toBe('request:githubSync')
  })
})

describe('全局 eventBus 实例', () => {
  it('应是 EventBus 实例', () => {
    expect(eventBus).toBeInstanceOf(EventBus)
  })
})
