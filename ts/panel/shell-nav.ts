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
 *   2. initScrollspy —— 滚动高亮（scrollspy）：
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
export function initScrollspy(): void {
  if (typeof document === 'undefined') return
  const sections = [...document.querySelectorAll<HTMLElement>('main [id^="sec-"]')]
  const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.nav a[href^="#"]')]
  if (sections.length === 0 || navLinks.length === 0) return
  const nav = navLinks[0]?.parentElement
  if (!nav) return

  // 滑动胶囊：唯一实例，首次激活时创建并挂到导航容器
  let indicator: HTMLElement | null = null
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

  // 点击导航项：立即高亮（平滑滚动完成前先给反馈）
  for (const link of navLinks) {
    link.addEventListener('click', () => {
      const href = link.getAttribute('href') ?? ''
      if (href.startsWith('#')) setActive(href.slice(1))
    })
  }

  /**
   * 由当前滚动位置反推当前区块并高亮。
   *
   * 规则：
   *  1. 滚到底（视口底部贴文档底部）→ 高亮最后一个区块：末段区块顶部常因
   *     页面总高不足而永远进不了上部判定带，需在此兜底。
   *  2. 否则 → 取「起点已进入视口上部判定带」的区块中位置最靠下的那个：
   *     判定带取小值（顶部 ~96px / 1/4 视口高），使区块上划进入视口顶部附近即成为
   *     当前主导；若判定带为空（区块过矮/过长/首个被排除），退回最靠上的
   *     可见区块，保证任何滚动位置都有明确高亮。
   */
  const resolveActiveByScroll = (): void => {
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
    // 规则 2：起点已进入视口上部判定带的区块中取最靠下的。
    // 判定带用 min(96px, 1/4 视口高) 而非 1/3 视口：对连续矮区块可让每个区块
    // "上划进入视口顶部附近"即成为当前主导，避免下一个区块顶部刚进入视口就被
    // 抢先高亮（滚动错位/滞后——滚到目标区块却高亮其下方区块）。
    const detectTop = scrollY + Math.min(96, innerHeight * 0.25)
    let current: HTMLElement | null = null
    for (const section of sections) {
      const { top } = section.getBoundingClientRect()
      const sectionTop = top + scrollY
      if (sectionTop > detectTop) break
      // 判定带内最后一个（起点仍 ≤ detectTop）即当前区块
      current = section
    }
    // 规则 2 兜底：判定带为空时取当前视口内最靠上的可见区块
    if (!current) {
      const { scrollY: scrollYNow } = window
      for (const section of sections) {
        const { bottom, top } = section.getBoundingClientRect()
        const sectionTop = top + scrollYNow
        if (sectionTop <= viewportBottom && bottom > 0) {
          current = section
          break
        }
      }
    }
    if (current) setActive(current.id)
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
export function initShellNav(): void {
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
  initScrollspy()
  onResettled()
}
