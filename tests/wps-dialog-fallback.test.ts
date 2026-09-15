/**
 * @fileoverview `wpsPrompt` / `wpsMessageBox` 的宿主降级链测试
 *
 * 为什么单独一个文件（而不是并进 `tests/wps.test.ts`）：
 *   这两个函数的降级链第一层就是 `typeof window === 'undefined'` 判断，分叉的两侧各有
 *   一半分支。`tests/wps.test.ts` 跑在 node 环境（window 未定义），本文件跑在 jsdom
 *   （window 存在），两者合起来才能把两侧都覆盖到 —— vitest 的 environment 是**按文件**
 *   生效的，同一个文件里切不了。
 *
 * 覆盖范围：
 *   - wpsPrompt：WPS InputBox 抛错 → `window.BGMInput` → `getNotifyApi().input`
 *     （含取消回调、以及回调传 undefined 时的 null 归一化）
 *   - wpsMessageBox：MessageBox 抛错 → `window.BGMConfirm` / `window.BGMAlert`
 *     → `getNotifyApi().confirm` / `.alert`
 *   - buttons / icon 省略时的 `(buttons ?? 0) + (icon ?? 64)` 默认值
 *
 * 级别断言用 `hasLogMessage`（`LOG_LEVELS` 是数字枚举，不能写 `expect.any(String)`）。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vi.mock 工厂的注册早于本文件顶层求值，共享 spy 必须走 vi.hoisted
const notifyApi = vi.hoisted(() => ({
  input: vi.fn(),
  confirm: vi.fn(),
  alert: vi.fn(),
}))

vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: vi.fn(() => notifyApi),
}))

vi.mock('../ts/tools/util/index.js', async () => {
  const helpers = await import('./helpers/utility-mock.js')
  return helpers.utilityMock
})

import { wpsPrompt, wpsMessageBox } from '../ts/tools/wps.js'
import { utilityMock, resetUtilityMock, hasLogMessage } from './helpers/utility-mock.js'

/** jsdom 环境下 globalThis 即 window，宿主回调挂在 globalThis 上等价于挂在 window 上 */
function installHostCallback(
  name: 'BGMInput' | 'BGMConfirm' | 'BGMAlert',
  value: unknown,
): void {
  Reflect.set(globalThis, name, value)
}

beforeEach(() => {
  resetUtilityMock()
  notifyApi.input.mockReset()
  notifyApi.confirm.mockReset()
  notifyApi.alert.mockReset()
})

afterEach(() => {
  for (const name of ['BGMInput', 'BGMConfirm', 'BGMAlert']) {
    Reflect.deleteProperty(globalThis, name)
  }
})

describe('wpsPrompt 降级链', () => {
  it('WPS InputBox 抛错时记警告并降级到 window.BGMInput', async () => {
    utilityMock.getApp.mockReturnValue({
      InputBox: () => {
        throw new Error('COM 桥接失效')
      },
    })
    installHostCallback(
      'BGMInput',
      (_title: string, _message: string, _defaultValue: string, onOk: (value: string) => void) => {
        onOk('来自宿主输入框')
      },
    )

    await expect(wpsPrompt('请输入', '默认值')).resolves.toBe('来自宿主输入框')
    expect(hasLogMessage('WPS InputBox 不可用')).toBe(true)
  })

  it('window.BGMInput 取消回调解析为 null，省略 defaultValue 时传空串', async () => {
    utilityMock.getApp.mockReturnValue(null)
    let capturedDefault: unknown = '未捕获'
    installHostCallback(
      'BGMInput',
      (
        _title: string,
        _message: string,
        defaultValue: string,
        _onOk: unknown,
        onCancel: () => void,
      ) => {
        capturedDefault = defaultValue
        onCancel()
      },
    )

    await expect(wpsPrompt('请输入')).resolves.toBeNull()
    expect(capturedDefault).toBe('')
  })

  it('无 InputBox 也无 window.BGMInput 时走自定义输入对话框', async () => {
    utilityMock.getApp.mockReturnValue(undefined)
    notifyApi.input.mockImplementation(
      (
        _title: string,
        _message: string,
        _defaultValue: string | undefined,
        onOk: (value: string) => void,
      ) => {
        onOk('自定义对话框值')
      },
    )

    await expect(wpsPrompt('请输入', '默认')).resolves.toBe('自定义对话框值')
    expect(notifyApi.input).toHaveBeenCalledWith(
      '输入',
      '请输入',
      '默认',
      expect.any(Function),
      expect.any(Function),
    )
  })

  it('自定义输入对话框回调 undefined 时归一化为 null', async () => {
    utilityMock.getApp.mockReturnValue(null)
    notifyApi.input.mockImplementation(
      (
        _title: string,
        _message: string,
        _defaultValue: string | undefined,
        onOk: (value?: string) => void,
      ) => {
        onOk()
      },
    )

    await expect(wpsPrompt('请输入')).resolves.toBeNull()
  })

  it('自定义输入对话框取消回调解析为 null', async () => {
    utilityMock.getApp.mockReturnValue(null)
    notifyApi.input.mockImplementation(
      (
        _title: string,
        _message: string,
        _defaultValue: string | undefined,
        _onOk: unknown,
        onCancel: () => void,
      ) => {
        onCancel()
      },
    )

    await expect(wpsPrompt('请输入')).resolves.toBeNull()
  })
})

describe('wpsMessageBox 降级链', () => {
  it('省略 buttons / icon 时默认使用 (0 + 64)', async () => {
    const messageBox = vi.fn(() => 2)
    utilityMock.getApp.mockReturnValue({ MessageBox: messageBox })

    await expect(wpsMessageBox('提示')).resolves.toBe(2)
    expect(messageBox).toHaveBeenCalledWith('提示', 64)
  })

  it('WPS MessageBox 抛错时记警告并降级到 window.BGMConfirm（确认 6 / 取消 7）', async () => {
    utilityMock.getApp.mockReturnValue({
      MessageBox: () => {
        throw new Error('COM 桥接失效')
      },
    })
    installHostCallback(
      'BGMConfirm',
      (_message: string, _title: string, onOk: () => void) => {
        onOk()
      },
    )

    await expect(wpsMessageBox('要保存吗？', 4, 64)).resolves.toBe(6)
    expect(hasLogMessage('WPS MessageBox 不可用')).toBe(true)

    installHostCallback(
      'BGMConfirm',
      (_message: string, _title: string, _onOk: () => void, onCancel: () => void) => {
        onCancel()
      },
    )
    await expect(wpsMessageBox('要保存吗？', 4, 64)).resolves.toBe(7)
  })

  it('无 window.BGMConfirm 时走自定义确认对话框（确认 6 / 取消 7）', async () => {
    utilityMock.getApp.mockReturnValue(null)
    notifyApi.confirm.mockImplementation(
      (_message: string, onResult: (isConfirmed: boolean) => void) => {
        onResult(true)
      },
    )
    await expect(wpsMessageBox('要保存吗？', 4)).resolves.toBe(6)

    notifyApi.confirm.mockImplementation(
      (_message: string, onResult: (isConfirmed: boolean) => void) => {
        onResult(false)
      },
    )
    await expect(wpsMessageBox('要保存吗？', 4)).resolves.toBe(7)
    expect(notifyApi.confirm).toHaveBeenCalledWith('要保存吗？', expect.any(Function), '确认')
  })

  it('buttons 非 4 且存在 window.BGMAlert 时返回 1', async () => {
    utilityMock.getApp.mockReturnValue(null)
    installHostCallback(
      'BGMAlert',
      (_message: string, _title: string, onOk: () => void) => {
        onOk()
      },
    )

    await expect(wpsMessageBox('提示')).resolves.toBe(1)
  })

  it('buttons 非 4 且无 window.BGMAlert 时走自定义警告对话框返回 1', async () => {
    utilityMock.getApp.mockReturnValue(null)
    notifyApi.alert.mockImplementation(
      (_message: string, _title: string, onOk: () => void) => {
        onOk()
      },
    )

    await expect(wpsMessageBox('提示')).resolves.toBe(1)
    expect(notifyApi.alert).toHaveBeenCalledWith('提示', '提示', expect.any(Function))
  })
})
