/**
 * @fileoverview 三页面（panel / settings / enrich）共享的外壳导航逻辑
 * @module panel/shellNav
 * @description 统一处理「顶栏 + 侧栏导航」外壳的两个运行时行为：
 *
 *   1. updateStickyOffsets —— 吸顶偏移测量：
 *      将顶栏实际高度写入 --topbar-h、窄态（≤880px）横向导航块高度写入 --nav-h，
 *      供 CSS 控制 sidebar 吸顶位置与锚点 scroll-padding 偏移补偿。
 *      此前只有 panel-bootstrap 调用，settings / enrich 页未设置导致：
 *      - 侧栏吸顶位置落在顶栏之下被遮挡（导航按钮显示不全）
 *      - 锚点跳转时目标区块标题被顶栏盖住（视觉错位）
 *
 *   2. initializeScrollspy —— 滚动高亮（scrollspy）：
 *      依当前滚动位置反推主导区块并高亮侧栏对应导航项；
 *      点击导航项立即高亮（不等平滑滚动完成），滚动 / 缩放 / 加载后重算。
 */

/** 测量吸顶元素高度并写入 CSS 变量（load / resize 时需重跑） */
export function updateStickyOffsets(): void {
  const root = document.documentElement
  const topbar = document.querySelector('.topbar')
  const topbarH = topbar instanceof HTMLElement ? topbar.offsetHeight : 0
  root.style.setProperty('--topbar-h', `${String(topbarH)}px`)
  const isNarrow =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 880px)').matches
  let navH = 0
  if (isNarrow) {
    const sidebar = document.querySelector('.sidebar')
    navH = sidebar instanceof HTMLElement ? sidebar.offsetHeight : 0
  }
  root.style.setProperty('--nav-h', `${String(navH)}px`)
}

/**
 * 初始化滚动高亮：主区内 id 以 sec- 开头的区块 ↔ 侧栏导航项
 * 无导航或无区块时静默跳过（如测试环境 / 无侧栏页面）。
 *
 * 高亮反馈：导航容器内注入绝对定位的滑动胶囊（.nav-indicator），
 * 当前区块变化时胶囊平滑滑动到对应导航项，竖排（桌面）与
 * 横排换行（窄态）均通过 offsetLeft/offsetTop 相对定位统一计算。
 */
export function initializeScrollspy(): void {
  if (typeof document === 'undefined') return
  // 模块顺序可由用户在设置页调整（tools/nav-order 会就地重排 DOM），
  // 因此每次判定都按「最新 DOM 顺序」重新取一遍区块，避免数组顺序陈旧导致高亮回跳。
  const getSections = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>('main [id^="sec-"]'),
  ]
  const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.nav a[href^="#"]')]
  if (getSections().length === 0 || navLinks.length === 0) return
  const nav = navLinks[0]?.parentElement
  if (!nav) return

  // 滑动胶囊：唯一实例，首次激活时创建并挂到导航容器
  let indicator: HTMLElement | null = null
  // 导航点击后的过渡锁：防止平滑滚动尚未结束时，旧区块的可见面积把高亮抢回去
  let navigationTarget: HTMLElement | null = null
  let navigationLockTimer = 0
  let navigationReleaseTimer = 0
  const getIndicator = (): HTMLElement | null => {
    indicator ??= nav.querySelector<HTMLElement>('.nav-indicator')
    if (!indicator) {
      indicator = document.createElement('span')
      indicator.className = 'nav-indicator'
      indicator.setAttribute('aria-hidden', 'true')
      nav.prepend(indicator)
    }
    return indicator
  }

  /** 将胶囊滑到指定导航项；link 为 null 时隐藏胶囊 */
  const moveIndicatorTo = (link: HTMLAnchorElement | null): void => {
    const indicatorElement = getIndicator()
    if (!indicatorElement) return
    if (!link) {
      indicatorElement.classList.remove('on')
      return
    }
    // offsetLeft/Top 相对 position:relative 的 .nav，竖排与窄态横排（含换行）通用
    indicatorElement.style.width = `${String(link.offsetWidth)}px`
    indicatorElement.style.height = `${String(link.offsetHeight)}px`
    indicatorElement.style.transform = `translate(${String(link.offsetLeft)}px, ${String(link.offsetTop)}px)`
    indicatorElement.classList.add('on')
  }

  /** 将指定区块对应的导航项设为唯一高亮，并滑动胶囊 */
  const setActive = (sectionId: string): void => {
    let activeLink: HTMLAnchorElement | null = null
    for (const link of navLinks) {
      const isActive = link.getAttribute('href') === `#${sectionId}`
      link.classList.toggle('active', isActive)
      if (isActive) activeLink = link
    }
    moveIndicatorTo(activeLink)
  }

  /** 清除导航点击过渡锁（正常滚动 scrollspy 不受影响） */
  const clearNavigationLock = (): void => {
    navigationTarget = null
    if (navigationLockTimer) {
      window.clearTimeout(navigationLockTimer)
      navigationLockTimer = 0
    }
    if (navigationReleaseTimer) {
      window.clearTimeout(navigationReleaseTimer)
      navigationReleaseTimer = 0
    }
  }

  // 点击导航项：立即高亮，并锁定到锚点滚动完成，防止高亮在过渡中回跳
  const onNavLinkClick = (link: HTMLAnchorElement): void => {
    const href = link.getAttribute('href') ?? ''
    if (!href.startsWith('#')) return
    const sectionId = href.slice(1)
    const target = getSections().find((section) => section.id === sectionId)
    if (!target) return
    navigationTarget = target
    setActive(sectionId)
    if (navigationLockTimer) window.clearTimeout(navigationLockTimer)
    if (navigationReleaseTimer) window.clearTimeout(navigationReleaseTimer)
    navigationReleaseTimer = 0
    // 锚点滚动异常中断时也必须自动释放，不影响后续手动滚动；
    // 底部区块无法真正滚到顶栏位置，给平滑滚动更充足的完成时间。
    navigationLockTimer = window.setTimeout(clearNavigationLock, 5000)
  }
  for (const link of navLinks) {
    link.addEventListener('click', () => {
      onNavLinkClick(link)
    })
  }

  /**
   * 由当前滚动位置反推当前区块并高亮。
   *
   * 规则：
   *  1. 页面可滚动且已滚到底（视口底部贴文档底部）→ 高亮最后一个区块：
   *     最后一个模块的标题可能已经离开视口，需在此兜底。
   *  2. 页面不可滚动（内容不足一屏）→ 高亮首个区块（页面入口模块）。
   *  3. 否则 → 从上到下查找第一个「完整显示模块标题」的区块：
   *     标题顶部不被吸顶顶栏遮挡、标题底部仍在视口内；不再按 section 整体
   *     可见面积判断，避免上一个「可清理项」内容很多时抢走当前模块高亮。
   *  4. 如果当前滚动位置没有任何完整标题，取第一个标题与有效视口相交的区块，
   *     作为滚动过渡阶段的稳定兜底。
   */
  const resolveActiveByScroll = (): void => {
    // 用户刚点击导航时，优先保持目标项高亮，直到目标区块进入吸顶定位带。
    // 这是点击反馈的过渡锁，不改变正常手动滚动时的 scrollspy 规则。
    if (navigationTarget) {
      const topbar = document.querySelector('.topbar')
      const bandTop = topbar instanceof HTMLElement ? topbar.offsetHeight : 0
      const targetTop = navigationTarget.getBoundingClientRect().top
      if (Math.abs(targetTop - bandTop) <= 12) {
        // 目标已到位，但滚动动画最后几帧仍可能把第二个 section 判为可见面积最大。
        // 保持目标高亮 600ms，等锚点滚动完全稳定后再恢复正常 scrollspy。
        if (!navigationReleaseTimer) {
          navigationReleaseTimer = window.setTimeout(clearNavigationLock, 600)
        }
        setActive(navigationTarget.id)
        return
      }
      if (navigationReleaseTimer) {
        window.clearTimeout(navigationReleaseTimer)
        navigationReleaseTimer = 0
      }
      setActive(navigationTarget.id)
      return
    }

    // 每帧按最新 DOM 顺序取区块（模块顺序可由用户在设置页调整）
    const sections = getSections()
    const { innerHeight, scrollY } = window
    const { documentElement } = document
    const viewportBottom = scrollY + innerHeight
    // 规则 1：滚到底（含首次加载即处于恢复的底部）选中末区块
    if (
      documentElement.scrollHeight > innerHeight &&
      viewportBottom >= documentElement.scrollHeight - 2
    ) {
      const last = sections.at(-1)
      if (last) setActive(last.id)
      return
    }
    // 规则 2：不可滚动页面 → 首个区块
    if (documentElement.scrollHeight <= innerHeight) {
      const first = sections[0]
      if (first) setActive(first.id)
      return
    }
    // 规则 3/4：按「第一个完整显示的模块标题」判定，而不是按 section 可见面积判定。
    // 这样上一个内容很多的模块即使仍占据大面积，也不会抢走当前模块的高亮。
    const topbar = document.querySelector('.topbar')
    const sidebar = document.querySelector('.sidebar')
    const isNarrow =
      typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 880px)').matches
    // 窄屏时 sidebar 会变成顶栏下方的横向 sticky 导航，标题在它下面才算完整可见。
    const bandTop =
      (topbar instanceof HTMLElement ? topbar.offsetHeight : 0) +
      (isNarrow && sidebar instanceof HTMLElement ? sidebar.offsetHeight : 0)
    let firstIntersecting: HTMLElement | null = null
    for (const section of sections) {
      const heading = section.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6')
      if (heading) {
        const rect = heading.getBoundingClientRect()
        const isIntersecting = rect.bottom > bandTop && rect.top < innerHeight
        if (!firstIntersecting && isIntersecting) firstIntersecting = section
        const isFullyVisible = rect.top >= bandTop && rect.bottom <= innerHeight
        if (isFullyVisible) {
          setActive(section.id)
          return
        }
      }
    }
    // 过渡阶段没有完整标题时，取从上到下第一个可见标题。
    if (firstIntersecting) {
      setActive(firstIntersecting.id)
      return
    }
    // 极端布局：视口内没有标题时取首个区块。
    const first = sections[0]
    if (first) setActive(first.id)
  }

  // 布局变化（窗口缩放 / 字体加载）后重测胶囊位置，并重算当前区块
  const recompute = (): void => {
    const activeLink = navLinks.find((link) => link.classList.contains('active')) ?? null
    moveIndicatorTo(activeLink)
    resolveActiveByScroll()
  }
  window.addEventListener('resize', recompute)
  window.addEventListener('load', recompute)

  let scrollRaf = 0
  const onScroll = (): void => {
    if (scrollRaf) return
    // 节流到下一帧：resize 与滚动交错触发时也能取到最新布局
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = 0
      resolveActiveByScroll()
    })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
}

/**
 * 外壳导航统一初始化：吸顶偏移测量（含 load/resize 重跑）+ 滚动高亮。
 * 三个面板的启动入口（panel / settings / enrich bootstrap）都应调用一次。
 */
export function initializeShellNav(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  updateStickyOffsets()
  const onResettled = (): void => {
    // 布局/字体就绪后重测吸顶偏移与滚动高亮：浏览器恢复滚动位置不触发 scroll，
    // 必须在此主动推一次当前区块，避免高亮停留在陈旧状态
    updateStickyOffsets()
    window.dispatchEvent(new Event('scroll'))
  }
  window.addEventListener('load', onResettled)
  window.addEventListener('resize', onResettled)
  // 初始化立即推一次（首屏即可能处于已滚动/恢复位置）
  initializeScrollspy()
  onResettled()
}

/**
 * 主动触发一次「当前可见区块 + 导航高亮」重算。
 * 供各面板在动态加载/重布局（识别表头、渲染预览、切换工作簿等）后调用，
 * 避免高亮停留在陈旧状态。
 */
export function recomputeScrollspy(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('scroll'))
}
