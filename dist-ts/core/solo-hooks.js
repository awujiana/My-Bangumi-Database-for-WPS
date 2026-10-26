/**
 * @fileoverview 「进入专注模式前」回调钩子（core 层协调点）
 * @module core/soloHooks
 * @description 依赖倒置用：tools 层的 module-state 进入专注前调 runBeforeEnterSolo，
 *   UI 层的 detachable-panel 通过 onBeforeEnterSolo 注册「收回所有浮动窗」。
 *
 *   为什么放 core 层：让 tools（module-state）与 UI/components（detachable-panel）互相
 *   不 import —— 否则 tools→UI/components 触发「分层反向依赖」门禁；且通用组件
 *   detachable-panel 直接依赖业务模块 module-state 会把它全家（nav-order/config/util）
 *   拖进组件单测、污染测试。core 是两者都能依赖的底层，且本模块纯函数零依赖，import 无副作用。
 */
/** 已注册的「进入专注前」回调 */
const beforeEnterSoloHooks = [];
/** 注册「进入专注前」回调（幂等：同一函数只记一次） */
export function onBeforeEnterSolo(hook) {
    if (!beforeEnterSoloHooks.includes(hook))
        beforeEnterSoloHooks.push(hook);
}
/** 触发所有「进入专注前」回调（由 module-state.enterSoloMode 调用） */
export function runBeforeEnterSolo() {
    for (const hook of beforeEnterSoloHooks)
        hook();
}
