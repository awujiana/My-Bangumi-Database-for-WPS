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
  value: string
  /** 展示文本 */
  label: string
}

/** 渲染配置 */
export interface OptionPickerOptions {
  /** 当前选中值 */
  value: string
  /** 用户选择后回调（只在值真正变化时调用） */
  onChange: (value: string) => void
  /** 无障碍名称（如「目标工作簿」） */
  ariaLabel: string
  /** ≤ 这个数量用单选按钮（默认 2） */
  radioThreshold?: number
  /** > 这个数量显示搜索框（默认 10） */
  searchThreshold?: number
  /** 空列表提示 */
  emptyText?: string
}

/** 单选组 name 的唯一后缀（同页多个 picker 不互相串组） */
let pickerSeed = 0

/**
 * 渲染选项选择器（重建容器内容）
 *
 * @param container 承载容器（会被清空）
 * @param items 选项列表
 * @param options 选中值 / 回调 / 阈值
 */
export function renderOptionPicker(
  container: HTMLElement,
  items: readonly OptionPickerItem[],
  options: OptionPickerOptions,
): void {
  container.replaceChildren()
  container.dataset.optionPicker = 'true'

  if (items.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'bgm-option-picker-empty'
    empty.textContent = options.emptyText ?? '（没有可选项）'
    container.append(empty)
    return
  }

  const radioThreshold = options.radioThreshold ?? 2
  const searchThreshold = options.searchThreshold ?? 10

  if (items.length <= radioThreshold) {
    renderRadioGroup(container, items, options)
  } else if (items.length > searchThreshold) {
    renderSearchableList(container, items, options)
  } else {
    renderSelect(container, items, options)
  }
}

/** ≤2 个选项：单选按钮（不展开下拉） */
function renderRadioGroup(
  container: HTMLElement,
  items: readonly OptionPickerItem[],
  options: OptionPickerOptions,
): void {
  const group = document.createElement('div')
  group.className = 'bgm-option-picker-radio'
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', options.ariaLabel)

  pickerSeed += 1
  const name = `bgm-option-picker-${String(pickerSeed)}`
  for (const item of items) {
    const label = document.createElement('label')
    label.className = 'bgm-option-picker-radio-item'

    const input = document.createElement('input')
    input.type = 'radio'
    input.name = name
    input.value = item.value
    input.checked = item.value === options.value
    input.addEventListener('change', () => {
      if (input.checked) options.onChange(item.value)
    })

    const text = document.createElement('span')
    text.textContent = item.label

    label.append(input, text)
    group.append(label)
  }
  container.append(group)
}

/** 3–10 个选项：原生 select（键盘 / 无障碍最稳） */
function renderSelect(
  container: HTMLElement,
  items: readonly OptionPickerItem[],
  options: OptionPickerOptions,
): void {
  const select = document.createElement('select')
  select.className = 'bgm-option-picker-select'
  select.setAttribute('aria-label', options.ariaLabel)
  for (const item of items) {
    const option = document.createElement('option')
    option.value = item.value
    option.textContent = item.label
    option.selected = item.value === options.value
    select.append(option)
  }
  select.addEventListener('change', () => {
    options.onChange(select.value)
  })
  container.append(select)
}

/** >10 个选项：搜索框 + 过滤列表 */
function renderSearchableList(
  container: HTMLElement,
  items: readonly OptionPickerItem[],
  options: OptionPickerOptions,
): void {
  const search = document.createElement('input')
  search.type = 'search'
  search.className = 'bgm-option-picker-search'
  search.placeholder = `搜索${options.ariaLabel}…`
  search.setAttribute('aria-label', `搜索${options.ariaLabel}`)

  const list = document.createElement('div')
  list.className = 'bgm-option-picker-list'
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', options.ariaLabel)

  const renderList = (query: string): void => {
    list.replaceChildren()
    const keyword = query.trim().toLowerCase()
    const filtered =
      keyword === ''
        ? items
        : items.filter((item) => item.label.toLowerCase().includes(keyword))
    if (filtered.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'bgm-option-picker-empty'
      empty.textContent = '没有匹配项'
      list.append(empty)
      return
    }
    for (const item of filtered) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'bgm-option-picker-item'
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', String(item.value === options.value))
      if (item.value === options.value) button.classList.add('is-selected')
      button.textContent = item.label
      button.addEventListener('click', () => {
        options.onChange(item.value)
      })
      list.append(button)
    }
  }

  search.addEventListener('input', () => {
    renderList(search.value)
  })
  renderList('')
  container.append(search, list)
}
