/**
 * @fileoverview 「滚动到底部」的合帧工具
 * @module ui/domScroll
 * @description
 *   日志区跟随尾部是同步流程里最高频的 DOM 操作：一行日志一次
 *   `element.scrollTop = element.scrollHeight`。**读 `scrollHeight` 会强制同步
 *   布局（reflow）** —— 一行一读，4000 行就是 4000 次强制布局，同步日志刷起来时
 *   任务窗格直接卡成幻灯片。
 *
 *   关键区分：**写 style 不强制布局**（浏览器在一帧的绘制点统一算一次），**读布局
 *   才强制**。所以药方不是「别写」，而是把「读 scrollHeight + 写 scrollTop」合帧：
 *   同一帧里的多行日志只读一次，帧末统一滚动。
 *
 *   元素粒度去重（WeakMap，互不干扰；帧末自动清条目，无需调用方管理生命周期）。
 *   非浏览器环境（单测 node env）没有 rAF，退化为同步执行，行为不变。
 */

/** 每个元素排队中的帧号；无条目 = 当前没有待执行滚动 */
const pendingFrames = new WeakMap<HTMLElement, number>()

/**
 * 把元素滚到最底部（合帧：同一帧内多次调用只滚动一次）
 *
 * @param element 滚动容器（需自带 `overflow: auto` 与高度上限）
 * @remarks
 *   读 `scrollHeight` 的时机推迟到帧末：那时本帧所有日志行都已 append 完，
 *   一次布局服务全部行数。元素在帧前被移除也安全（写 detached 节点是无操作）。
 */
export function scrollToBottomCoalesced(element: HTMLElement): void {
  if (typeof requestAnimationFrame !== 'function') {
    element.scrollTop = element.scrollHeight
    return
  }
  // 已排队就直接返回：一帧只需要滚一次，后来者搭同一班车
  if (pendingFrames.has(element)) return
  pendingFrames.set(
    element,
    requestAnimationFrame(() => {
      pendingFrames.delete(element)
      element.scrollTop = element.scrollHeight
    }),
  )
}
