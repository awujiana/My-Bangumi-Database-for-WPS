# -*- coding: utf-8 -*-
"""BGM 加载项 · 配色审计：硬编码色 / 未定义 token / 对比度矩阵 / 大括号平衡。
   用法：python ux-audit.py   —— 不达标会逐条打印，全绿时四行输出。"""
import io, os, re

CSS = "css"

def files():
    for root, _, fs in os.walk(CSS):
        for f in sorted(fs):
            if f.endswith(".css"):
                yield os.path.join(root, f)

# ---- 1) 大括号平衡 ----
bad = [p for p in files()
       if (lambda s: s.count("{") != s.count("}"))(re.sub(r"/\*.*?\*/", "", io.open(p, encoding="utf-8").read(), flags=re.S))]
print("1) 大括号不平衡:", bad or "无")

# ---- 2) var() 引用了没定义过的 token ----
defined = set()
for p in files():
    for line in io.open(p, encoding="utf-8"):
        m = re.match(r"\s*(--[a-z0-9-]+)\s*:", line)
        if m:
            defined.add(m.group(1))
RUNTIME = {  # 由 JS 在运行时 setProperty 注入，不该出现在 CSS 定义里
    "--topbar-h", "--nav-h", "--detachable-collapsed-h", "--table-row-h",
    "--ripple-x", "--ripple-y", "--ripple-radius", "--sun-diameter", "--sun-offset",
    "--toggle-width", "--toggle-height", "--theme-toggle-scale", "--base-scale",
    "--halo-color", "--shadow-highlight", "--shadow-primary",
    "--bg-toggle-dark", "--bg-toggle-light", "--color-sun", "--color-moon",
    "--color-star", "--color-crater", "--color-cloud-front", "--color-cloud-back",
}
und = set()
for p in files():
    for m in re.finditer(r"var\((--[a-z0-9-]+)", io.open(p, encoding="utf-8").read()):
        v = m.group(1)
        if v not in defined and v not in RUNTIME and not v.startswith("--table-col-"):
            und.add(v)
print("2) 未定义 token:", sorted(und) or "无")

# ---- 3) 硬编码色（只查会显示颜色的属性）----
PAT = re.compile(r"(?:^|[;{\s])(color|background|background-color|border-color|"
                 r"border-left-color|border-top-color|border-left|border-top|border-bottom)"
                 r"\s*:\s*([^;{}]*#[0-9a-fA-F]{3,8}[^;{}]*)")
hits = []
for p in files():
    for i, line in enumerate(io.open(p, encoding="utf-8"), 1):
        t = line.strip()
        if t.startswith(("/*", "*")):
            continue
        if PAT.search(" " + t):
            hits.append("%s:%d %s" % (p, i, t))
print("3) 硬编码色:", len(hits))
for h in hits:
    print("   ", h)

# ---- 4) 两套主题的「文字色 × 背景色」对比度矩阵 ----
def parse(path):
    src = re.sub(r"/\*.*?\*/", "", io.open(path, encoding="utf-8").read(), flags=re.S)
    out = {}
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", src):
        sel, body = m.group(1).strip(), m.group(2)
        d = dict(re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", body))
        if not d:
            continue
        key = ":root" if sel == ":root" else ("light" if 'data-theme="light"' in sel else None)
        if key:
            out.setdefault(key, {}).update(d)
    return out

root, light = {}, {}
for f in ("css/tokens.css", "css/styles.css"):   # 后者覆盖前者，与真实层叠一致
    b = parse(f)
    root.update(b.get(":root", {}))
    light.update(b.get("light", {}))
eff = {":root": root, "light": {**root, **light}}

def resolve(name, theme, seen=()):
    v = eff[theme].get(name)
    if v is None or name in seen:
        return v
    m = re.fullmatch(r"var\((--[a-z0-9-]+)\)", v)
    return resolve(m.group(1), theme, seen + (name,)) if m else v

def rgb(s):
    s = s.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4)) if len(s) == 6 else None

def lum(c):
    def f(x):
        x /= 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    r, g, b = (f(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)

TEXT = ["--text-1", "--text-2", "--text-3", "--text-link", "--text-danger", "--text-success",
        "--text-warn", "--success", "--warning", "--danger", "--info", "--teal", "--amber",
        "--warn", "--red", "--green", "--yellow", "--purple", "--accent-blue", "--accent-amber",
        "--text", "--subtext0", "--overlay1", "--blue", "--peach", "--lavender"] + \
       ["--chip-" + c for c in ("red", "orange", "yellow", "lime", "green", "teal",
                                "sky", "blue", "violet", "purple", "pink", "rose")]
BG = ["--bg-app", "--bg-base", "--bg-surface", "--bg-surface-2", "--bg-mantle"]

fails, n = [], 0
for theme in (":root", "light"):
    for k in TEXT:
        v = resolve(k, theme)
        c = rgb(v) if v else None
        if not c:
            continue
        for b in BG:
            bv = resolve(b, theme)
            bc = rgb(bv) if bv else None
            if not bc:
                continue
            n += 1
            r = ratio(c, bc)
            if r < 4.5:
                fails.append("[%s] %s %s on %s %s = %.2f:1" % (theme, k, v, b, bv, r))
print("4) 对比度矩阵 %d 组，不达标 %d 项" % (n, len(fails)))
for f in fails:
    print("   ", f)

# ---- 5) TS / HTML 里内联 style 的硬编码色（优先级最高，CSS 覆盖不住）----
INLINE = re.compile(r'style="[^"]*#[0-9a-fA-F]{3,8}')
inline = []
for root, _, fs in os.walk("."):
    if any(x in root for x in ("node_modules", "dist", ".git", "wps-addon")):
        continue
    for f in fs:
        if not f.endswith((".ts", ".html")):
            continue
        p = os.path.join(root, f)
        if p.endswith("ts/entry/debug-panel.ts"):   # 调试台样式表，刻意不跟随主题
            continue
        for i, line in enumerate(io.open(p, encoding="utf-8", errors="ignore"), 1):
            if INLINE.search(line):
                inline.append("%s:%d" % (p, i))
print("5) 内联 style 硬编码色:", len(inline))
for h in inline:
    print("   ", h)
