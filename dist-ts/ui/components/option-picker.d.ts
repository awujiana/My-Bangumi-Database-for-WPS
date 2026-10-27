/**
 * @fileoverview 通用选项选择器：少量选项用单选按钮、多量选项带搜索
 * @module ui/components/option-picker
 * @description
 *   项目里有几处「从一组选项里选一个」的场景（目标工作簿 / 目标工作表 / 其它枚举）。
 *   原生 `<select>` 在选项很少时多一次展开、在选项很多时只能盲滚。这里按数量自动选形态：
 *
 *   - `≤ radioThreshold`（默认 2）：**单选按钮**（radiogroup），一眼看全、一次点中；
 *   - `> searchThreshold`（默认 10）：**搜索框 + 过滤列表**（listbox），不盲滚；
 *   - 其余：原生 `<select>`（键盘 / 无障碍最稳，也不占太多高度）。
 *
 *   纯 DOM、零依赖；每次渲染重建内容，调用方只管把最新选项传进来。
 */
/** 一个可选项 */
export interface OptionPickerItem {
    /** 稳定值（写回配置 / 状态用） */
    value: string;
    /** 展示文本 */
    label: string;
}
/** 渲染配置 */
export interface OptionPickerOptions {
    /** 当前选中值 */
    value: string;
    /** 用户选择后回调（只在值真正变化时调用） */
    onChange: (value: string) => void;
    /** 无障碍名称（如「目标工作簿」） */
    ariaLabel: string;
    /** ≤ 这个数量用单选按钮（默认 2） */
    radioThreshold?: number;
    /** > 这个数量显示搜索框（默认 10） */
    searchThreshold?: number;
    /** 空列表提示 */
    emptyText?: string;
}
/**
 * 渲染选项选择器（重建容器内容）
 *
 * @param container 承载容器（会被清空）
 * @param items 选项列表
 * @param options 选中值 / 回调 / 阈值
 */
export declare function renderOptionPicker(container: HTMLElement, items: readonly OptionPickerItem[], options: OptionPickerOptions): void;
//# sourceMappingURL=option-picker.d.ts.map