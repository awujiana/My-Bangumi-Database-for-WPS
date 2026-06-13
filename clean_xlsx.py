"""
外部数据清洗脚本 - 独立于 WPS 运行
====================================
功能:
  1. 按"名称"列分组,对重复名称的行进行清洗(去重,合并标签)
  2. 清除 Bangumi_URL 列中的超链接,转为纯文本 URL
  3. (新模式 --new-from) 指定行号之后的数据视为新数据,与旧数据对齐
     后增量合并或覆盖,删除已处理的新数据行

逻辑:
  - URL 填充(自动): 扫描所有数据,同名的条目间自动补全缺失的 URL
    (也会通过别名匹配,例如条目A的别名"路人"=条目B的名称"路人",则A补全B的URL)
  - 默认模式: 同一名称有多条时:
    - 无 URL 的行 -> 删除,标签合并到保留行
    - 均有 URL 的行 -> 数据最多的为保留行,删除其他行; 用最新行的URL覆盖保留行(纠错)
    - 同名不同 URL 的行也会被合并删除(视为同一条目的重复录入)
  - 日期/集数保护(自动): 同名条目中,如果有不同的开播日期,视为不同作品不合并;
    无开播日期时检查集数,集数不同也视为不同作品不合并
  - --keep-url 模式(可单独使用或与 --new-from 合用):
     - 同一名称组内先按 URL 分组,不同 URL 视为独立条目各自保留
     - 再以 URL 为唯一键跨名称去重: 不同名称但相同 URL 的行也会去重
     - 仅在同一 URL 内去重,防止清除重名但不重 URL 的不同数据
  - 增量合并模式 (--new-from 行号):
    - 指定行号之前为旧数据,之后为新数据
    - 按名称对齐: 同名的新行数据合并/覆盖到旧行,新行被删除
    - 不同名的新行保留不动
    - 与 --keep-url 合用时: 合并仍按名称匹配,URL 保护仅在去重阶段生效

用法:
  python clean_xlsx.py <文件路径> [工作表名称] [选项]
  选项:
    --new-from N   指定 Excel 行号 N 及之后为新数据(增量合并)
    --keep-url     同名不同 URL 视为独立条目,去重时保护不合并
示例:
  python clean_xlsx.py "数据.xlsx" "动画"
  python clean_xlsx.py "数据.xlsx" --keep-url
  python clean_xlsx.py "数据.xlsx" --new-from 450 --keep-url
"""

import sys
import os
import shutil
import time
import re
import pandas as pd
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter


def find_header_row(wb, sheet_name, max_search=50):
    """搜索前 max_search 行,找到同时包含"名称"和"Bangumi_URL"的表头行"""
    ws = wb[sheet_name]
    url_keywords = {'Bangumi_URL', 'Bangumi URL', 'URL', 'BGM_URL', 'bgm_url', 'bgm.tv'}
    for row in ws.iter_rows(min_row=1, max_row=max_search, max_col=ws.max_column):
        values = [str(c.value or '').strip() for c in row]
        has_name = any('名称' in v for v in values)
        has_url = False
        for v in values:
            for kw in url_keywords:
                if kw.lower() in v.lower():
                    has_url = True
                    break
            if has_url:
                break
        if has_name and has_url:
            return row[0].row
    return None


def pick_column(col_map, keywords, exclude_keywords=None):
    """从列名映射中选出匹配关键词的列（按关键词顺序逐词优先精确匹配，其次子串匹配）"""
    for kw in keywords:
        for col_name, col_idx in col_map.items():
            if col_name == kw:
                return col_name, col_idx
    for kw in keywords:
        for col_name, col_idx in col_map.items():
            if kw in col_name:
                if exclude_keywords and any(ek in col_name for ek in exclude_keywords):
                    continue
                return col_name, col_idx
    return None, None


def parse_tags(tag_str):
    """解析 '|' 分隔的标签为 set（统一无空格分隔）"""
    return set(t.strip() for t in str(tag_str).split('|') if t.strip())


def extract_season_numbers(text):
    """从文本中提取季数关键词，返回季数集合（文本回退策略）。
    匹配模式：
      - "Season X" / "season X"
      - "S X" / "SX" (S1, s2 等)
      - "第X季" / "第X期" / "第X部"
      - "Xnd Season" / "Xth Season" / "2nd season" 等
    返回 frozenset 以便作为字典键。"""
    if not text:
        return frozenset()
    seasons = set()
    # 英文: Season X / SX / S X / Xnd Season / Xth Season
    season_pats = [
        (r'(?:season|Season)\s*(\d+)', 1),
        (r'(?:^|\s)([sS])\s*(\d+)(?:\s|$|,|\.)', 2),
        (r'(\d+)\s*(?:st|nd|rd|th)?\s*(?:season|Season)', 1),
    ]
    for pat, group_num in season_pats:
        for m in re.finditer(pat, text):
            try:
                seasons.add(int(m.group(group_num)))
            except ValueError:
                pass
    # 中文: 第X季 / 第X期 / 第X部
    for m in re.finditer(r'第\s*(\d+)\s*[季期部]', text):
        try:
            seasons.add(int(m.group(1)))
        except ValueError:
            pass
    return frozenset(seasons)


# ── 语言分类(别名排序用) ──
_TRADITIONAL_CHARS = set(
    '爲著畫會體國時書東樂關蘭萬愛學門開飛雲電號廣義靈驚號龍龜鳳歸發'
    '當聲聽頭邊處從來將幾盡夢對應親轉辭謝醫護難顯鐵鑑爭舉繩隨塵陰陽'
    '際雙離關霧隊隱雖靜響驚願廳鄉歸歡眾帶準幹壞壯態層壓豐遺龐臉色認'
    '觸變斷數術贍覽豐富實踐際隊隱雖然響驚廳鄉歸歡眾帶準幹壞壯態層壓'
    '豐遺龐臉色認觸變斷'
)


def _classify_alias(text):
    """分类别名为 zh-CN(简体) | zh-TW(繁体) | ja(日语) | en(英语) | other"""
    if not text:
        return 'other'
    has_hiragana = bool(re.search(r'[\u3040-\u309F]', text))
    has_katakana = bool(re.search(r'[\u30A0-\u30FF]', text))
    has_cjk = bool(re.search(r'[\u4E00-\u9FFF]', text))
    if has_hiragana or has_katakana:
        return 'ja'
    if has_cjk:
        trad_count = sum(1 for ch in text if ch in _TRADITIONAL_CHARS)
        return 'zh-TW' if trad_count >= 2 else 'zh-CN'
    if all(ord(c) < 128 for c in text):
        return 'en'
    return 'other'


_LANG_ORDER = {'zh-CN': 0, 'zh-TW': 1, 'ja': 2, 'en': 3, 'other': 4}


def _sort_aliases(values_set):
    """按语言分组排序别名: 简中 → 繁中 → 日语 → 英语 → 其他"""
    return sorted(values_set, key=lambda a: (_LANG_ORDER.get(_classify_alias(a), 4), a))


def _join_values(values_set, col_name=None, alias_col=None):
    """用 | 连接值集合，别名列按语言分组排序，其他列按字母排序"""
    if not values_set:
        return ''
    if col_name and alias_col and col_name == alias_col:
        return '|'.join(_sort_aliases(values_set))
    return '|'.join(sorted(values_set))


def _clean_val(raw):
    """统一清洗单个单元格值：NaN/None/nan → 空字符串"""
    if pd.isna(raw) or str(raw).strip() in ('', 'nan'):
        return ''
    return str(raw).strip()


def clean_hyperlinks_in_column(ws, col_idx, start_row, end_row):
    """清除指定列从 start_row 到 end_row 的超链接,保留 URL 文本,进度每5%打印一次"""
    url_pattern = re.compile(r'=HYPERLINK\("([^"]*)"[^)]*\)')
    cleaned = 0
    total = end_row - start_row + 1
    last_pct = -1
    for idx, row in enumerate(range(start_row, end_row + 1), 1):
        pct = int(idx / total * 100)
        if pct - last_pct >= 5 or idx == 1 or idx == total:
            bar = '█' * (pct // 5) + '─' * (20 - pct // 5)
            print(f'\r  🔗 清除超链接 [{bar}] {idx}/{total} {pct:3d}%', end='', flush=True)
            last_pct = pct
        cell = ws.cell(row=row, column=col_idx)
        if cell.hyperlink:
            target = cell.hyperlink.target
            cell.value = target
            cell.hyperlink = None
            cleaned += 1
        if isinstance(cell.value, str) and cell.value.startswith('=HYPERLINK'):
            match = url_pattern.match(cell.value.strip())
            if match:
                cell.value = match.group(1)
                cleaned += 1
    if cleaned > 0:
        print(f'\r  🔗 清除超链接 [{"█"*20}] {total}/{total} 100% — 已清除 {cleaned} 个')
    else:
        print(f'\r  🔗 清除超链接 [{"█"*20}] {total}/{total} 100% — 无超链接')


def main():
    # ── 参数解析 ──
    if len(sys.argv) < 2:
        print('用法: python clean_xlsx.py <文件路径> [工作表名称] [选项]')
        print('示例:')
        print('      python clean_xlsx.py "C:\\数据.xlsx" "动画"')
        print('      python clean_xlsx.py "C:\\数据.xlsx" --keep-url')
        print('      python clean_xlsx.py "C:\\数据.xlsx" --new-from 450 --keep-url')
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.exists(filepath):
        print(f'[错误] 文件不存在: {filepath}')
        sys.exit(1)

    # ── 检查文件是否被占用 ──
    try:
        with open(filepath, 'a'):
            pass
    except PermissionError:
        print(f'[错误] 文件被其他程序占用,请先关闭 Excel/WPS 再重试')
        print(f'       文件: {filepath}')
        sys.exit(1)

    backup_path = filepath + '.bak'
    if os.path.exists(backup_path):
        print(f'  📦  {backup_path}')
    else:
        print(f'  📦  {backup_path}')
        shutil.copy2(filepath, backup_path)
        print(f'      备份创建')

    is_xlsm = filepath.lower().endswith('.xlsm')
    wb = load_workbook(filepath, keep_vba=is_xlsm)
    start_total = time.time()

    sheet_name = ''
    new_from = None
    keep_url = False
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--new-from':
            i += 1
            if i < len(sys.argv):
                new_from = int(sys.argv[i])
            else:
                print('[错误] --new-from 需要指定行号')
                wb.close()
                sys.exit(1)
        elif sys.argv[i] == '--keep-url':
            keep_url = True
        else:
            sheet_name = sys.argv[i]
        i += 1

    if sheet_name:
        if sheet_name not in wb.sheetnames:
            print(f'  ❌ 找不到工作表 "{sheet_name}",可选: {wb.sheetnames}')
            wb.close()
            sys.exit(1)
    else:
        sheet_name = next((n for n in wb.sheetnames if wb[n].max_row > 1), None)
        if not sheet_name:
            print('  ❌ 所有工作表均为空')
            wb.close()
            sys.exit(1)

    ws = wb[sheet_name]

    header_row = find_header_row(wb, sheet_name)
    if not header_row:
        print('  ❌ 未找到表头行(需要"名称"和"Bangumi_URL"列)')
        for r in range(1, min(6, ws.max_row + 1)):
            vals = [str(c.value or '').strip() for c in ws[r]]
            non_empty = [v for v in vals if v]
            if non_empty:
                print(f'     行{r}: {vals}')
        wb.close()
        sys.exit(1)

    header_names = [str(c.value or '').strip() for c in ws[header_row]]
    col_map = {n: i + 1 for i, n in enumerate(header_names) if n}

    name_col_name, name_col_idx = pick_column(col_map, ['名称'])
    url_col_name, url_col_idx = pick_column(col_map, ['Bangumi_URL', 'Bangumi URL', 'URL', 'BGM_URL'])
    tags_col_name, tags_col_idx = pick_column(col_map, ['标签/分级', '标签', '分级'], exclude_keywords=['原作'])
    alias_col_name, alias_col_idx = pick_column(col_map, ['别名', '其他名称', '又名', 'OtherName', 'Other name'])
    category_col_name, category_col_idx = pick_column(col_map, ['类别', '分类'])
    company_col_name, company_col_idx = pick_column(col_map, ['制作公司', '公司', '制作', 'Studio', 'studio'])
    original_tag_col_name, original_tag_col_idx = pick_column(col_map, ['原作标签', '原作Tag', 'Original Tag'])
    feature_col_name, feature_col_idx = pick_column(col_map, ['特点/印象', '特点', '印象', 'Features'])
    spoiler_col_name, spoiler_col_idx = pick_column(col_map, ['剧透/感言', '剧透', '感言', 'Spoilers'])
    type_col_name, type_col_idx = pick_column(col_map, ['类型', 'Genre'])
    related_id_col_name, related_id_col_idx = pick_column(col_map, ['关联的动漫ID', '关联ID', '关联动漫', 'Related ID', 'RelatedAnimeID'])
    watched_col_name, watched_col_idx = pick_column(col_map, ['是否看完', '看完', 'Watched'])
    watch_end_col_name, watch_end_col_idx = pick_column(col_map, ['看完时间', '看完日', 'Watch End'])
    season_col_name, season_col_idx = pick_column(col_map, ['开播季度', '播出季度', '季度', 'Season'])
    start_date_col_name, start_date_col_idx = pick_column(col_map, ['开播日期', '开播', '首播', 'Start Date', 'StartDate'])
    end_date_col_name, end_date_col_idx = pick_column(col_map, ['完播日', '完播日期', '完结', 'End Date', 'EndDate'])
    score_col_name, score_col_idx = pick_column(col_map, ['打分', '评分', 'Score'])
    episode_num_col_name, episode_num_col_idx = pick_column(col_map, ['集号', '集编号', '话号', 'Episode#'])
    episodes_col_name, episodes_col_idx = pick_column(col_map, ['集数', '话数', '总集数', '集'])
    series_col_name, series_col_idx = pick_column(col_map, ['系列', '系列名', 'Series'])
    season_num_col_name, season_num_col_idx = pick_column(col_map, ['季数', 'Season#'])
    series_ep_col_name, series_ep_col_idx = pick_column(col_map, ['系列集数', 'Series Episodes'])
    duration_col_name, duration_col_idx = pick_column(col_map, ['时长/分钟', '时长', '分钟', '长度'])
    cinema_col_name, cinema_col_idx = pick_column(col_map, ['电影院', '影院', 'Cinema'])
    hall_col_name, hall_col_idx = pick_column(col_map, ['影厅', '厅', 'Hall', 'Screen'])
    ticket_col_name, ticket_col_idx = pick_column(col_map, ['电影票存根', '票根', 'Ticket', 'Stub'])
    country_col_name, country_col_idx = pick_column(col_map, ['制片国家', '国家', '地区', 'Country'])
    lang_col_name, lang_col_idx = pick_column(col_map, ['语言', 'Language'])
    director_col_name, director_col_idx = pick_column(col_map, ['导演', '监督', 'Director'])
    music_col_name, music_col_idx = pick_column(col_map, ['音乐', '作曲', 'Music'])
    chara_design_col_name, chara_design_col_idx = pick_column(col_map, ['人物设定', '人设', '角色设计', 'Character Design'])
    mecha_design_col_name, mecha_design_col_idx = pick_column(col_map, ['机械设定', '机设', 'Mecha Design'])
    original_col_name, original_col_idx = pick_column(col_map, ['原作', 'Original'])
    original_plan_col_name, original_plan_col_idx = pick_column(col_map, ['原案', 'Original Plan'])
    script_col_name, script_col_idx = pick_column(col_map, ['脚本', '编剧', '剧本', 'Screenplay'])
    series_composition_col_name, series_composition_col_idx = pick_column(col_map, ['系列构成', 'Series Composition'])
    storyboard_col_name, storyboard_col_idx = pick_column(col_map, ['分镜', 'Storyboard'])
    performance_col_name, performance_col_idx = pick_column(col_map, ['演出', 'Episode Director'])

    if not name_col_name:
        print('  ❌ 未找到"名称"列')
        wb.close()
        sys.exit(1)
    if not url_col_name:
        print('  ❌ 未找到"Bangumi_URL"列')
        wb.close()
        sys.exit(1)

    # 列字母仅用于打印,不再用于写入逻辑
    print(f'  📋 {sheet_name} ({ws.max_row}行) | 名称={get_column_letter(name_col_idx)} URL={get_column_letter(url_col_idx)} '
          f'标签={get_column_letter(tags_col_idx) if tags_col_idx else "-"}')

    engine = None
    if is_xlsm:
        print('[Pandas] xlsm 文件,使用 openpyxl 引擎(保留 VBA)')
    else:
        try:
            import python_calamine
            engine = 'calamine'
            print('[Pandas] 使用 calamine 引擎读取')
        except ImportError:
            print('[Pandas] calamine 未安装,使用默认引擎(较慢),可运行 pip install python-calamine 加速')

    df = pd.read_excel(
        filepath,
        sheet_name=sheet_name,
        header=header_row - 1,
        dtype=str,
        engine=engine
    )

    total_rows_before = len(df)
    print(f'\n[Pandas] 读取完成: {total_rows_before} 行 × {len(df.columns)} 列')

    # ── 过滤空名称行 ──
    name_series = df[name_col_name].astype(str).str.strip()
    empty_mask = (df[name_col_name].isna()) | (name_series == '')
    empty_count = empty_mask.sum()
    df_valid = df[~empty_mask].copy()
    valid_count = len(df_valid)

    # ── 名称分布统计 ──
    name_counts = df_valid[name_col_name].value_counts()
    single_count = (name_counts == 1).sum()
    multi_count = (name_counts >= 2).sum()

    print(f'\n{"─"*60}')
    print(f'  📊 扫描报告')
    print(f'{"─"*60}')
    print(f'  数据区间:    第 {header_row+1}~{header_row+total_rows_before} 行 ({total_rows_before} 行)')
    print(f'  有效名称:    {valid_count} 个')
    print(f'  重复名称:    {multi_count} 个')
    print(f'  空名称行:    {empty_count} 行')
    print(f'{"─"*60}')

    # ════════════════════════════════════════════════════════
    #  pandas 聚合处理重复(仅处理有重复的名称)
    # ════════════════════════════════════════════════════════
    url_series = df_valid[url_col_name].astype(str).str.strip()
    has_url_mask = url_series.notna() & (url_series != '') & (url_series != 'nan')
    df_valid['_has_url'] = has_url_mask

    # ── 列配置统一规范: (列名, 列索引, 模式) ──
    #   模式: 'merge' = 增量合并(|分隔,去重); 'overwrite' = 新值覆盖旧值
    _ALL_COL_SPECS = [
        (tags_col_name, tags_col_idx, 'merge'),
        (alias_col_name, alias_col_idx, 'merge'),
        (category_col_name, category_col_idx, 'merge'),
        (company_col_name, company_col_idx, 'merge'),
        (original_tag_col_name, original_tag_col_idx, 'merge'),
        (feature_col_name, feature_col_idx, 'merge'),
        (spoiler_col_name, spoiler_col_idx, 'merge'),
        (type_col_name, type_col_idx, 'merge'),
        (related_id_col_name, related_id_col_idx, 'merge'),
        (watched_col_name, watched_col_idx, 'overwrite'),
        (watch_end_col_name, watch_end_col_idx, 'overwrite'),
        (season_col_name, season_col_idx, 'overwrite'),
        (start_date_col_name, start_date_col_idx, 'overwrite'),
        (end_date_col_name, end_date_col_idx, 'overwrite'),
        (score_col_name, score_col_idx, 'overwrite'),
        (episode_num_col_name, episode_num_col_idx, 'overwrite'),
        (episodes_col_name, episodes_col_idx, 'overwrite'),
        (series_col_name, series_col_idx, 'overwrite'),
        (season_num_col_name, season_num_col_idx, 'overwrite'),
        (series_ep_col_name, series_ep_col_idx, 'overwrite'),
        (duration_col_name, duration_col_idx, 'overwrite'),
        (cinema_col_name, cinema_col_idx, 'overwrite'),
        (hall_col_name, hall_col_idx, 'overwrite'),
        (ticket_col_name, ticket_col_idx, 'overwrite'),
        (country_col_name, country_col_idx, 'overwrite'),
        (lang_col_name, lang_col_idx, 'overwrite'),
        (director_col_name, director_col_idx, 'overwrite'),
        (music_col_name, music_col_idx, 'overwrite'),
        (chara_design_col_name, chara_design_col_idx, 'overwrite'),
        (mecha_design_col_name, mecha_design_col_idx, 'overwrite'),
        (original_col_name, original_col_idx, 'overwrite'),
        (script_col_name, script_col_idx, 'overwrite'),
        (storyboard_col_name, storyboard_col_idx, 'overwrite'),
        (performance_col_name, performance_col_idx, 'overwrite'),
        (original_plan_col_name, original_plan_col_idx, 'overwrite'),
        (series_composition_col_name, series_composition_col_idx, 'overwrite'),
    ]

    # ── 从统一配置派生循环变量 ──
    _all_cols = [(n, i) for n, i, m in _ALL_COL_SPECS if n and i]
    _merge_col_names = {n for n, i, m in _ALL_COL_SPECS if m == 'merge' and n and i}
    _data_cols = [c for c in df_valid.columns if c not in (name_col_name, url_col_name, '_has_url')]

    # ── 构建单元格值缓存(向量化加速)──
    _cache_cols = set()
    for col_name, _, _ in _ALL_COL_SPECS:
        if col_name:
            _cache_cols.add(col_name)
    _cache_cols.add(url_col_name)
    _cache_cols.add(name_col_name)

    cache_cols_list = list(_cache_cols)
    df_cache = df_valid[cache_cols_list].fillna('').astype(str)
    _cell_cache = df_cache.to_dict(orient='records')
    for d in _cell_cache:
        for k in cache_cols_list:
            d[k] = _clean_val(d[k])

    # ── 批量写入暂存 ──
    df_updates = {}          # (df_valid_idx, col_name) -> new_value
    to_delete = set()        # 存储 df_valid 的行索引(非 Excel 行)

    # ── URL 填充：同名的条目间补全缺失的 URL ──
    name_url_map = {}
    for pos, idx in enumerate(df_valid.index):
        url_val = _cell_cache[pos].get(url_col_name, '').strip()
        if not url_val:
            continue
        name_val = _cell_cache[pos].get(name_col_name, '').strip()
        if name_val and name_val not in name_url_map:
            name_url_map[name_val] = url_val
        if alias_col_name:
            alias_val = _cell_cache[pos].get(alias_col_name, '').strip()
            if alias_val:
                for a in re.split(r'[/／|｜]', alias_val):
                    a = a.strip()
                    if a and a not in name_url_map:
                        name_url_map[a] = url_val

    url_filled_count = 0
    for pos, idx in enumerate(df_valid.index):
        current_url = _cell_cache[pos].get(url_col_name, '').strip()
        if current_url:
            continue
        name_val = _cell_cache[pos].get(name_col_name, '').strip()
        if name_val and name_val in name_url_map:
            url_to_fill = name_url_map[name_val]
            df_updates[(idx, url_col_name)] = url_to_fill
            _cell_cache[pos][url_col_name] = url_to_fill
            df_valid.loc[idx, '_has_url'] = True
            url_filled_count += 1

    if url_filled_count > 0:
        print(f'  ✅ 补全了 {url_filled_count} 行的缺失 URL')

    # ════════════════════════════════════════════════════════
    #  增量合并模式 (--new-from)
    # ════════════════════════════════════════════════════════
    if new_from is not None:
        # 计算 df_valid 中的切分位置
        split_pos = 0
        for orig_idx in df_valid.index:
            if orig_idx + header_row + 1 >= new_from:
                break
            split_pos += 1

        old_count = split_pos
        new_count = len(df_valid) - split_pos
        print(f'\n{"─"*60}')
        print(f'  🔄 增量合并模式: 旧数据 {old_count} 行 | 新数据 {new_count} 行')
        print(f'  📌 新数据从 Excel 第 {new_from} 行开始')
        print(f'{"─"*60}')

        if new_count <= 0:
            print('  ⚠️  没有新数据可合并')
        else:
            # 建立名称 → 旧数据位置的映射
            old_name_positions = {}
            for pos in range(split_pos):
                name = _cell_cache[pos].get(name_col_name, '')
                if name:
                    old_name_positions.setdefault(name, []).append(pos)

            inc_merged = 0
            inc_new_entries = 0
            inc_matched = 0
            _last_pct = -1

            for offset, pos in enumerate(range(split_pos, len(_cell_cache))):
                pct = offset / new_count if new_count > 0 else 1
                pct_int = int(pct * 100)
                if pct_int != _last_pct or offset % 20 == 0:
                    _last_pct = pct_int
                    filled = int(30 * pct)
                    bar = '█' * filled + '─' * (30 - filled)
                    print(f'\r  🔄 增量合并 [{bar}] {offset+1}/{new_count} {pct*100:5.1f}%', end='', flush=True)

                cache = _cell_cache[pos]
                name = cache.get(name_col_name, '')
                if not name:
                    continue

                old_positions = old_name_positions.get(name, [])

                # 有 URL 时只匹配同 URL 的旧行,防止合并不同条目
                if old_positions:
                    new_url = cache.get(url_col_name, '')
                    if new_url:
                        old_positions = [p for p in old_positions
                                         if _cell_cache[p].get(url_col_name, '') == new_url]

                if not old_positions:
                    inc_new_entries += 1
                    continue

                inc_matched += 1

                # 多行旧数据时只合并到数据最全的行,其余标记删除
                if len(old_positions) > 1:
                    counts = [(sum(1 for c in _data_cols if _cell_cache[p].get(c, '')), p) for p in old_positions]
                    counts.sort(reverse=True)
                    best_pos = counts[0][1]
                    for _, extra_pos in counts[1:]:
                        to_delete.add(df_valid.index[extra_pos])
                    old_positions = [best_pos]

                for old_pos in old_positions:
                    old_cache = _cell_cache[old_pos]
                    for col_name, col_idx in _all_cols:
                        col_is_merge = col_name in _merge_col_names
                        old_val = old_cache.get(col_name, '')
                        new_val = cache.get(col_name, '')
                        if not new_val or new_val == old_val:
                            continue
                        pandas_idx = df_valid.index[old_pos]
                        if col_is_merge:
                            existing = parse_tags(old_val)
                            add_vals = [v for v in parse_tags(new_val) if v not in existing]
                            if add_vals:
                                after = _join_values(existing | set(add_vals), col_name, alias_col_name)
                                df_updates[(pandas_idx, col_name)] = after
                                old_cache[col_name] = after
                                inc_merged += 1
                        else:
                            df_updates[(pandas_idx, col_name)] = new_val
                            old_cache[col_name] = new_val
                            inc_merged += 1

                to_delete.add(df_valid.index[pos])

            print()
            print(f'  匹配: {inc_matched} 个 | 合并字段: {inc_merged} 个')
            if inc_new_entries:
                print(f'  新增条目: {inc_new_entries} 个 (名称不在旧数据中)')
            if to_delete:
                print(f'  删除新数据行: {len(to_delete)} 行')
            print(f'{"─"*60}')

    dup_names = set(name_counts[name_counts >= 2].index)
    grouped = df_valid.groupby(name_col_name, sort=False)
    grouped_list = [(n, g) for n, g in grouped if n in dup_names]
    total_groups = len(grouped_list)

    duplicate_count = 0
    merged_groups = 0
    skipped_no_url = []
    url_corrections = []

    _last_pct = -1
    for gi, (name, group) in enumerate(grouped_list, 1):
        pct = gi / total_groups
        pct_int = int(pct * 100)
        if pct_int != _last_pct or gi % 20 == 0:
            _last_pct = pct_int
            filled = int(30 * pct)
            bar = '█' * filled + '─' * (30 - filled)
            print(f'\r  🔄 处理重复名称 [{bar}] {gi}/{total_groups} {pct*100:5.1f}%', end='', flush=True)

        # 跳过已被增量合并标记删除的行
        group = group[~group.index.isin(to_delete)]
        if len(group) < 2:
            continue

        with_url = group[group['_has_url']]
        without_url = group[~group['_has_url']]

        if len(with_url) == 0:
            skipped_no_url.append(name)
            continue

        # ── 同名但开播日期/集数不同 → 视为不同作品,不合并 ──
        if len(with_url) >= 2:
            date_vals = set()
            if start_date_col_name:
                for idx in with_url.index:
                    pos = df_valid.index.get_loc(idx)
                    v = _cell_cache[pos].get(start_date_col_name, '').strip()
                    if v:
                        date_vals.add(v)
            if len(date_vals) >= 2:
                continue
            if not date_vals and episodes_col_name:
                ep_vals = set()
                for idx in with_url.index:
                    pos = df_valid.index.get_loc(idx)
                    v = _cell_cache[pos].get(episodes_col_name, '').strip()
                    if v:
                        ep_vals.add(v)
                if len(ep_vals) >= 2:
                    continue
            # ── 文本季数回退: 名称/别名中提取 Season 关键词 ──
            rows_season = {}
            for idx in with_url.index:
                pos = df_valid.index.get_loc(idx)
                texts = [_cell_cache[pos].get(name_col_name, '').strip()]
                if alias_col_name:
                    texts.append(_cell_cache[pos].get(alias_col_name, '').strip())
                seasons = extract_season_numbers(' '.join(texts))
                if seasons:
                    rows_season[idx] = seasons
            season_tuples = {tuple(sorted(s)) for s in rows_season.values()}
            if len(season_tuples) >= 2:
                continue

        duplicate_count += 1

        if keep_url:
            # ── 按 URL 分组,保护不同 URL 的独立条目 ──
            url_groups = {}
            for idx in with_url.index:
                url_val = _cell_cache[idx].get(url_col_name, '')
                url_groups.setdefault(url_val, []).append(idx)

            has_distinct_urls = len(url_groups) >= 2

            if has_distinct_urls:
                for url_val, indices in url_groups.items():
                    if len(indices) <= 1:
                        continue

                    non_empty = with_url.loc[indices, _data_cols].notna().astype(int).sum(axis=1)
                    sorted_idx = non_empty.sort_values(ascending=False).index
                    keep_idx = sorted_idx[0]

                    newest_idx = max(indices)
                    if newest_idx != keep_idx:
                        newest_url = _cell_cache[newest_idx].get(url_col_name, '')
                        old_url = _cell_cache[keep_idx].get(url_col_name, '')
                        if newest_url and newest_url != old_url:
                            df_updates[(keep_idx, url_col_name)] = newest_url
                            _cell_cache[keep_idx][url_col_name] = newest_url
                            url_corrections.append(
                                f'  ✅ "{name}" 行{header_row + 1 + keep_idx}: {newest_url[:70]}'
                            )

                    del_indices = set(indices) - {keep_idx}
                    to_delete.update(del_indices)

                    keep_cache = _cell_cache[keep_idx]
                    for del_idx in del_indices:
                        del_cache = _cell_cache[del_idx]
                        for col_name, col_idx in _all_cols:
                            col_is_merge = col_name in _merge_col_names
                            old_val = keep_cache.get(col_name, '')
                            new_val = del_cache.get(col_name, '')
                            if not new_val or new_val == old_val:
                                continue
                            if col_is_merge:
                                existing = parse_tags(old_val)
                                add_vals = [v for v in parse_tags(new_val) if v not in existing]
                                if add_vals:
                                    after = _join_values(existing | set(add_vals), col_name, alias_col_name)
                                    df_updates[(keep_idx, col_name)] = after
                                    keep_cache[col_name] = after
                                    merged_groups += 1
                            else:
                                df_updates[(keep_idx, col_name)] = new_val
                                keep_cache[col_name] = new_val
                                merged_groups += 1

                if len(without_url) > 0:
                    skipped_no_url.append(f'{name} [无URL]')
            else:
                # 单一 URL → 原逻辑
                if len(with_url) >= 2:
                    non_empty = with_url[_data_cols].notna().astype(int).sum(axis=1)
                    sorted_idx = non_empty.sort_values(ascending=False).index
                    keep_idx = sorted_idx[0]

                    newest_idx = max(with_url.index)
                    if newest_idx != keep_idx:
                        newest_url = _cell_cache[newest_idx].get(url_col_name, '')
                        old_url = _cell_cache[keep_idx].get(url_col_name, '')
                        if newest_url and newest_url != old_url:
                            df_updates[(keep_idx, url_col_name)] = newest_url
                            _cell_cache[keep_idx][url_col_name] = newest_url
                            url_corrections.append(
                                f'  ✅ "{name}" 行{header_row + 1 + keep_idx}: {newest_url[:70]}'
                            )

                    del_indices = set(with_url.index) - {keep_idx}
                else:
                    keep_idx = with_url.index[0]
                    del_indices = set()

                del_indices.update(without_url.index)
                to_delete.update(del_indices)

                if not del_indices:
                    continue

                keep_cache = _cell_cache[keep_idx]
                for del_idx in del_indices:
                    del_cache = _cell_cache[del_idx]
                    for col_name, col_idx in _all_cols:
                        col_is_merge = col_name in _merge_col_names
                        old_val = keep_cache.get(col_name, '')
                        new_val = del_cache.get(col_name, '')
                        if not new_val or new_val == old_val:
                            continue
                        if col_is_merge:
                            existing = parse_tags(old_val)
                            add_vals = [v for v in parse_tags(new_val) if v not in existing]
                            if add_vals:
                                after = _join_values(existing | set(add_vals), col_name, alias_col_name)
                                df_updates[(keep_idx, col_name)] = after
                                keep_cache[col_name] = after
                                merged_groups += 1
                        else:
                            df_updates[(keep_idx, col_name)] = new_val
                            keep_cache[col_name] = new_val
                            merged_groups += 1
        else:
            # ── 原逻辑:不按 URL 区分,同名行统一去重 ──
            if len(with_url) >= 2:
                non_empty = with_url[_data_cols].notna().astype(int).sum(axis=1)
                sorted_idx = non_empty.sort_values(ascending=False).index
                keep_idx = sorted_idx[0]

                newest_idx = max(with_url.index)
                if newest_idx != keep_idx:
                    newest_url = _cell_cache[newest_idx].get(url_col_name, '')
                    old_url = _cell_cache[keep_idx].get(url_col_name, '')
                    if newest_url and newest_url != old_url:
                        df_updates[(keep_idx, url_col_name)] = newest_url
                        _cell_cache[keep_idx][url_col_name] = newest_url
                        url_corrections.append(
                            f'  ✅ "{name}" 行{header_row + 1 + keep_idx}: {newest_url[:70]}'
                        )

                del_indices = set(with_url.index) - {keep_idx}
            else:
                keep_idx = with_url.index[0]
                del_indices = set()

            del_indices.update(without_url.index)
            to_delete.update(del_indices)

            if not del_indices:
                continue

            keep_cache = _cell_cache[keep_idx]
            for del_idx in del_indices:
                del_cache = _cell_cache[del_idx]
                for col_name, col_idx in _all_cols:
                    col_is_merge = col_name in _merge_col_names
                    old_val = keep_cache.get(col_name, '')
                    new_val = del_cache.get(col_name, '')
                    if not new_val or new_val == old_val:
                        continue
                    if col_is_merge:
                        existing = parse_tags(old_val)
                        add_vals = [v for v in parse_tags(new_val) if v not in existing]
                        if add_vals:
                            after = _join_values(existing | set(add_vals), col_name, alias_col_name)
                            df_updates[(keep_idx, col_name)] = after
                            keep_cache[col_name] = after
                            merged_groups += 1
                    else:
                        df_updates[(keep_idx, col_name)] = new_val
                        keep_cache[col_name] = new_val
                        merged_groups += 1

    print()  # 结束进度条

    # ════════════════════════════════════════════════════════
    #  URL 去重 (--keep-url 时以 URL 为唯一键跨名称去重)
    # ════════════════════════════════════════════════════════
    if keep_url:
        url_groups = {}
        for pos, idx in enumerate(df_valid.index):
            if idx in to_delete:
                continue
            url_val = _cell_cache[pos].get(url_col_name, '')
            if url_val:
                url_groups.setdefault(url_val, []).append((pos, idx))

        url_dedup_groups = 0
        for url_val, group in url_groups.items():
            if len(group) <= 1:
                continue

            url_dedup_groups += 1
            duplicate_count += 1

            group.sort(key=lambda x: x[1], reverse=True)
            keep_pos, keep_idx = group[0]
            del_items = group[1:]

            for del_pos, del_idx in del_items:
                to_delete.add(del_idx)
                del_cache = _cell_cache[del_pos]
                keep_cache = _cell_cache[keep_pos]

                for col_name, col_idx in _all_cols:
                    col_is_merge = col_name in _merge_col_names
                    old_val = keep_cache.get(col_name, '')
                    new_val = del_cache.get(col_name, '')
                    if not new_val or new_val == old_val:
                        continue
                    if col_is_merge:
                        existing = parse_tags(old_val)
                        add_vals = [v for v in parse_tags(new_val) if v not in existing]
                        if add_vals:
                            after = _join_values(existing | set(add_vals), col_name, alias_col_name)
                            df_updates[(keep_idx, col_name)] = after
                            keep_cache[col_name] = after
                            merged_groups += 1
                    else:
                        df_updates[(keep_idx, col_name)] = new_val
                        keep_cache[col_name] = new_val
                        merged_groups += 1

        if url_dedup_groups > 0:
            print(f'  🔗 URL 去重(跨名称): {url_dedup_groups} 组')

    # ── 输出处理报告 ──
    if duplicate_count > 0 or url_corrections:
        print(f'\n{"━"*60}')
        print(f'  🔄 处理报告')
        print(f'{"━"*60}')
        print(f'  发现重复:    {duplicate_count} 个名称')
        print(f'  待删除行:    {len(to_delete)} 行')
        print(f'  标签合并:    {merged_groups} 个')

    if url_corrections:
        print(f'  URL 纠错:    {len(url_corrections)} 个')
        for line in url_corrections[:3]:
            print(f'  {line}')
        if len(url_corrections) > 3:
            print(f'  ... 共 {len(url_corrections)} 个,仅显示前 3 个')

    if skipped_no_url:
        names_str = ', '.join(skipped_no_url[:5])
        if len(skipped_no_url) > 5:
            names_str += f', ...共{len(skipped_no_url)}个'
        print(f'\n  ⚠️  跳过(全无URL): {names_str}')

    # ── 无修改时快速退出 ──
    if not to_delete and not df_updates and not url_corrections:
        wb.close()
        print(f'\n  ✅ 无需清洗')
        print(f'  ⏱️  {time.time() - start_total:.2f}s')
        return

    # ════════════════════════════════════════════════════════
    #  应用更新 & 保存
    # ════════════════════════════════════════════════════════
    print(f'\n  ⚙️  正在应用修改...')

    # 1. 批量应用 df_updates 到 df_valid
    update_groups = {}
    for (idx, col_name), val in df_updates.items():
        update_groups.setdefault(idx, {})[col_name] = val
    for idx, col_vals in update_groups.items():
        for col_name, val in col_vals.items():
            df_valid.loc[idx, col_name] = val

    # 2. 构建最终 DataFrame
    keep_mask = [pos for pos, idx in enumerate(df_valid.index) if idx not in to_delete]
    df_final = df_valid.iloc[keep_mask].drop(columns=['_has_url']).reset_index(drop=True)

    # 3. 保存
    if is_xlsm:
        # xlsm: openpyxl 写回(保留 VBA)
        print(f'  ⚙️  xlsm 模式,使用 openpyxl 写回...')

        # 写入修改后的值
        for idx, row_data in df_final.iterrows():
            orig_idx = keep_mask[idx]
            excel_row = header_row + 1 + orig_idx
            for col_name in df_final.columns:
                try:
                    val = row_data[col_name]
                    if pd.notna(val) and str(val).strip():
                        ws.cell(row=excel_row, column=col_map[col_name]).value = val
                except (KeyError, ValueError):
                    pass

        # 删除行
        if to_delete:
            to_delete_excel = sorted([header_row + 1 + x for x in to_delete], reverse=True)
            del_ranges = []
            i = 0
            while i < len(to_delete_excel):
                j = i
                while j + 1 < len(to_delete_excel) and to_delete_excel[j] - to_delete_excel[j + 1] == 1:
                    j += 1
                del_ranges.append((to_delete_excel[j], j - i + 1))
                i = j + 1
            for start_row, count in del_ranges:
                ws.delete_rows(start_row, count)
            print(f'  🗑️  删除 {len(to_delete_excel)} 行')

        # 清除超链接
        print(f'  🔗 正在清除 URL 列超链接...')
        clean_hyperlinks_in_column(ws, url_col_idx, header_row + 1, ws.max_row)

        wb.save(filepath)
        wb.close()
        print(f'  ✅ 保存: {filepath}')
    else:
        # xlsx: pandas to_excel(10-50倍快于 openpyxl)
        wb.close()

        # 向量化清除 =HYPERLINK 公式
        if url_col_name in df_final.columns:
            url_vals = df_final[url_col_name].astype(str)
            hyperlink_mask = url_vals.str.startswith('=HYPERLINK', na=False)
            if hyperlink_mask.any():
                url_pattern = re.compile(r'=HYPERLINK\("([^"]*)"[^)]*\)')
                df_final.loc[hyperlink_mask, url_col_name] = url_vals[hyperlink_mask].apply(
                    lambda v: (m := url_pattern.match(str(v).strip())) and m.group(1) or v
                )
                print(f'  🔗 已清除 {hyperlink_mask.sum()} 个 HYPERLINK 公式')

        df_final.to_excel(filepath, sheet_name=sheet_name, index=False, engine='openpyxl')
        print(f'  ✅ 保存: {filepath}')

    elapsed = time.time() - start_total
    print(f'  ⏱️  {elapsed:.2f}s')

    # ── 最终汇总 ──
    after_name_counts = df_final[name_col_name].value_counts()
    after_multi = (after_name_counts >= 2).sum()
    print(f'\n{"═"*60}')
    print(f'  ✅ 清洗完成!')
    print(f'{"═"*60}')
    print(f'  删除行:    {len(to_delete)} 行')
    print(f'  合并标签:  {merged_groups} 个')
    print(f'  URL 纠错:  {len(url_corrections)} 个')
    print(f'  耗时:      {elapsed:.2f}s')
    print(f'{"═"*60}')
    print(f'  备份: {backup_path}')
    print(f'  写入后: {len(df_final)} 行, {len(after_name_counts)} 个名称', end='')
    print(f', 剩余重复 {after_multi} 个' if after_multi > 0 else f', 无重复 ✅')
    print(f'{"═"*60}')


if __name__ == '__main__':
    main()