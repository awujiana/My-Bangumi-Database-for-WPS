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
 *      IntersectionObserver 监听主区内 id 以 sec- 开头的区块，
 *      滚动到哪个区块就高亮侧栏对应导航项；点击导航项立即高亮（不等平滑滚动完成）。
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
 */
export function initScrollspy(): void {
  if (typeof document === 'undefined') return
  const sections = [...document.querySelectorAll<HTMLElement>('main [id^="sec-"]')]
  const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.nav a[href^="#"]')]
  if (sections.length === 0 || navLinks.length === 0) return

  /** 将指定区块对应的导航项设为唯一高亮 */
  const setActive = (sectionId: string): void => {
    for (const link of navLinks) {
      link.classList.toggle('active', link.getAttribute('href') === `#${sectionId}`)
    }
  }

  // 点击导航项：立即高亮（平滑滚动完成前先给反馈）
  for (const link of navLinks) {
    link.addEventListener('click', () => {
      const href = link.getAttribute('href') ?? ''
      if (href.startsWith('#')) setActive(href.slice(1))
    })
  }

  if (typeof IntersectionObserver === 'undefined') return
  // 高亮判定带：视口上部 20%~30% 区间内的区块视为「当前区块」
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActive(entry.target.id)
        }
      }
    },
    { rootMargin: '-20% 0 -70% 0%' },
  )
  for (const section of sections) {
    observer.observe(section)
  }
}

/**
 * 外壳导航统一初始化：吸顶偏移测量（含 load/resize 重跑）+ 滚动高亮。
 * 三个面板的启动入口（panel / settings / enrich bootstrap）都应调用一次。
 */
export function initShellNav(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  updateStickyOffsets()
  window.addEventListener('load', updateStickyOffsets)
  window.addEventListener('resize', updateStickyOffsets)
  initScrollspy()
}
