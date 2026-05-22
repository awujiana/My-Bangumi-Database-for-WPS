"""
外部数据清洗脚本 — 独立于 WPS 运行
====================================
功能：
  1. 按"名称"列分组，对重复名称的行进行清洗（去重、合并标签）
  2. **URL 纠错**：同名多行均有 URL 时，用数据最少行的 URL 覆盖数据最多行的 URL（用户新增的正确URL替换旧行错误URL）
  3. 清除 Bangumi_URL 列中的超链接，转为纯文本 URL

逻辑：
  - 同一名称有多条时：
    - 无 URL 的行 → 删除，标签合并到保留行（原有逻辑）
    - **均有 URL 的行 → 数据最多的为保留行，用其他行的 URL 覆盖保留行的 URL（纠错），删除其他行**

优化特性：
  - 优先使用 python-calamine 引擎加速 pandas 读取
  - 避免文件二次读取，最终统计基于内存数据计算
  - 删除行操作合并连续区域，减少 openpyxl 调用次数

用法：
  python clean_xlsx.py <文件路径> [工作表名称]

示例：
  python clean_xlsx.py "C:\\数据.xlsx" "动画"
  python clean_xlsx.py "C:\\数据.xlsm" "动画"    # 支持 xlsm，自动保留 VBA
  python clean_xlsx.py "C:\\数据.xlsx"           # 自动选择第一个非空表

依赖：pip install pandas openpyxl python-calamine （calamine 可选）
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
    """搜索前 max_search 行，找到同时包含"名称"和"Bangumi_URL"的表头行"""
    ws = wb[sheet_name]
    for row in ws.iter_rows(min_row=1, max_row=max_search, max_col=ws.max_column):
        values = [str(c.value or '').strip() for c in row]
        has_name = any('名称' in v for v in values)
        has_url = any('Bangumi_URL' in v or 'Bangumi URL' in v or v == 'URL' or v == 'BGM_URL' for v in values)
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
    """解析 ' | ' 分隔的标签为 set"""
    return set(t.strip() for t in str(tag_str).split('|') if t.strip())


def clean_hyperlinks_in_column(ws, col_idx, start_row, end_row):
    """清除指定列从 start_row 到 end_row 的超链接，保留 URL 文本"""
    col_letter = get_column_letter(col_idx)
    # 匹配 =HYPERLINK("url") 格式
    url_pattern = re.compile(r'=HYPERLINK\("([^"]*)"[^)]*\)')
    cleaned = 0
    for row in range(start_row, end_row + 1):
        cell = ws.cell(row=row, column=col_idx)
        # 1. 如果存在超链接对象，提取目标并清除
        if cell.hyperlink:
            target = cell.hyperlink.target
            cell.value = target
            cell.hyperlink = None
            cleaned += 1
        # 2. 如果值是 HYPERLINK 公式字符串
        if isinstance(cell.value, str) and cell.value.startswith('=HYPERLINK'):
            match = url_pattern.match(cell.value.strip())
            if match:
                cell.value = match.group(1)
                cleaned += 1
    if cleaned > 0:
        print(f'[超链接] 已清除 {cleaned} 个单元格的超链接')


def main():
    # ── 参数解析 ──
    if len(sys.argv) < 2:
        print('用法: python clean_xlsx.py <文件路径> [工作表名称]')
        print('示例: python clean_xlsx.py "C:\\数据.xlsx" "动画"')
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
        print(f'[错误] 文件被其他程序占用，请先关闭 Excel/WPS 再重试')
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

    if len(sys.argv) >= 3:
        sheet_name = sys.argv[2]
        if sheet_name not in wb.sheetnames:
            print(f'  ❌ 找不到工作表 "{sheet_name}"，可选: {wb.sheetnames}')
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
        print('  ❌ 未找到表头行（需要"名称"和"Bangumi_URL"列）')
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
    category_col_name, category_col_idx = pick_column(col_map, ['类别', '分类', '类型'])
    company_col_name, company_col_idx = pick_column(col_map, ['制作公司', '公司', '制作', 'Studio', 'studio'])
    episodes_col_name, episodes_col_idx = pick_column(col_map, ['集数', '话数', '总集数', '集'])
    duration_col_name, duration_col_idx = pick_column(col_map, ['时长/分钟', '时长', '分钟', '长度'])
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
    related_id_col_name, related_id_col_idx = pick_column(col_map, ['关联的动漫ID', '关联ID', '关联动漫', 'Related ID', 'RelatedAnimeID'])
    start_date_col_name, start_date_col_idx = pick_column(col_map, ['开播日期', '开播', '首播', 'Start Date', 'StartDate'])
    end_date_col_name, end_date_col_idx = pick_column(col_map, ['完播日', '完播日期', '完结', 'End Date', 'EndDate'])

    if not name_col_name:
        print('  ❌ 未找到"名称"列')
        wb.close()
        sys.exit(1)
    if not url_col_name:
        print('  ❌ 未找到"Bangumi_URL"列')
        wb.close()
        sys.exit(1)

    name_col_l = get_column_letter(name_col_idx)
    url_col_l = get_column_letter(url_col_idx)
    tags_col_l = get_column_letter(tags_col_idx) if tags_col_idx else '-'
    alias_col_l = get_column_letter(alias_col_idx) if alias_col_idx else '-'
    category_col_l = get_column_letter(category_col_idx) if category_col_idx else '-'
    company_col_l = get_column_letter(company_col_idx) if company_col_idx else '-'
    episodes_col_l = get_column_letter(episodes_col_idx) if episodes_col_idx else '-'
    duration_col_l = get_column_letter(duration_col_idx) if duration_col_idx else '-'
    director_col_l = get_column_letter(director_col_idx) if director_col_idx else '-'
    music_col_l = get_column_letter(music_col_idx) if music_col_idx else '-'
    chara_design_col_l = get_column_letter(chara_design_col_idx) if chara_design_col_idx else '-'
    mecha_design_col_l = get_column_letter(mecha_design_col_idx) if mecha_design_col_idx else '-'
    original_col_l = get_column_letter(original_col_idx) if original_col_idx else '-'
    original_plan_col_l = get_column_letter(original_plan_col_idx) if original_plan_col_idx else '-'
    script_col_l = get_column_letter(script_col_idx) if script_col_idx else '-'
    series_composition_col_l = get_column_letter(series_composition_col_idx) if series_composition_col_idx else '-'
    storyboard_col_l = get_column_letter(storyboard_col_idx) if storyboard_col_idx else '-'
    performance_col_l = get_column_letter(performance_col_idx) if performance_col_idx else '-'
    related_id_col_l = get_column_letter(related_id_col_idx) if related_id_col_idx else '-'
    start_date_col_l = get_column_letter(start_date_col_idx) if start_date_col_idx else '-'
    end_date_col_l = get_column_letter(end_date_col_idx) if end_date_col_idx else '-'
    print(f'  📋 {sheet_name} ({ws.max_row}行) | 名称={name_col_l} URL={url_col_l} 标签={tags_col_l} 别名={alias_col_l}')
    print(f'      类别={category_col_l} 制作={company_col_l} 集数={episodes_col_l} 时长={duration_col_l} 导演={director_col_l} 音乐={music_col_l}')
    print(f'      人设={chara_design_col_l} 机设={mecha_design_col_l} 原作={original_col_l} 原案={original_plan_col_l} 脚本={script_col_l} 系列构成={series_composition_col_l}')
    print(f'      分镜={storyboard_col_l} 演出={performance_col_l} 关联ID={related_id_col_l} 开播={start_date_col_l} 完播={end_date_col_l}')

    engine = None
    if is_xlsm:
        print('[Pandas] xlsm 文件，使用 openpyxl 引擎（保留 VBA）')
    else:
        try:
            import python_calamine  # noqa: F401
            engine = 'calamine'
            print('[Pandas] 使用 calamine 引擎读取')
        except ImportError:
            print('[Pandas] calamine 未安装，使用默认引擎（较慢），可运行 pip install python-calamine 加速')

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
    dist_series = name_counts.value_counts().sort_index()

    print(f'\n{"─"*60}')
    print(f'  📊 扫描报告')
    print(f'{"─"*60}')
    print(f'  数据区间:    第 {header_row+1}~{header_row+total_rows_before} 行 ({total_rows_before} 行)')
    print(f'  有效名称:    {valid_count} 个')
    print(f'  重复名称:    {multi_count} 个')
    print(f'  空名称行:    {empty_count} 行')
    print(f'{"─"*60}')

    # ════════════════════════════════════════════════════════
    #  pandas 聚合处理重复
    # ════════════════════════════════════════════════════════
    url_series = df_valid[url_col_name].astype(str).str.strip()
    has_url_mask = url_series.notna() & (url_series != '') & (url_series != 'nan')
    df_valid.loc[:, '_has_url'] = has_url_mask

    grouped = df_valid.groupby(name_col_name, sort=False)
    duplicate_count = 0
    to_delete = []
    merged_groups = 0
    skipped_no_url = []
    url_corrections = []

    for name, group in grouped:
        if len(group) <= 1:
            continue

        with_url = group[group['_has_url']]
        without_url = group[~group['_has_url']]

        if len(with_url) == 0:
            skipped_no_url.append(name)
            continue

        duplicate_count += 1
        url_corrected = False

        # ── 决定保留行 ──
        if len(with_url) >= 2:
            # 多行均有 URL → 选择数据最多的行作为保留行，用其他行的 URL 纠错
            data_cols = [c for c in df_valid.columns if c not in [name_col_name, url_col_name, '_has_url']]
            non_empty = with_url[data_cols].notna().astype(int).sum(axis=1)
            sorted_idx = non_empty.sort_values(ascending=False).index
            keep_idx = sorted_idx[0]

            # URL 纠错：用数据最少行的 URL 覆盖保留行的 URL（用户新增的正确URL替换旧行错误URL）
            for ci in sorted_idx[1:]:
                cu = str(with_url.loc[ci, url_col_name]).strip()
                ku = str(with_url.loc[keep_idx, url_col_name]).strip()
                if cu and cu != 'nan' and cu != ku:
                    krn = header_row + 1 + keep_idx
                    ws.cell(row=krn, column=url_col_idx).value = cu
                    url_corrected = True
                    url_corrections.append(
                        f'  ✅ "{name}" 行{krn}: {cu[:70]}{"..." if len(cu)>70 else ""}'
                    )
                    break

            del_row_nums = [header_row + 1 + i for i in with_url.index if i != keep_idx]
        else:
            keep_idx = with_url.index[0]
            del_row_nums = []

        # 无 URL 的行也加入删除列表
        del_row_nums.extend([header_row + 1 + i for i in without_url.index])
        keep_row_num = header_row + 1 + keep_idx
        keep_df_row = df_valid.loc[keep_idx]

        # ── 增量合并列（| 分隔，去重追加） ──
        merge_cols = [
            (tags_col_name, tags_col_idx),
            (alias_col_name, alias_col_idx),
            (category_col_name, category_col_idx),
            (company_col_name, company_col_idx),
            (related_id_col_name, related_id_col_idx),
            (start_date_col_name, start_date_col_idx),
            (end_date_col_name, end_date_col_idx),
        ]
        for col_name, col_idx in merge_cols:
            if not col_name or len(del_row_nums) == 0:
                continue
            raw_before = keep_df_row.get(col_name, '')
            before = '' if pd.isna(raw_before) or str(raw_before).strip() in ('', 'nan') else str(raw_before).strip()
            existing = parse_tags(before)
            new_vals = []
            for del_row_num in del_row_nums:
                del_df_idx = del_row_num - header_row - 1
                if del_df_idx < 0 or del_df_idx >= len(df_valid):
                    continue
                raw_del = df_valid.iloc[del_df_idx].get(col_name, '')
                del_vals = '' if pd.isna(raw_del) or str(raw_del).strip() in ('', 'nan') else str(raw_del).strip()
                for v in parse_tags(del_vals):
                    if v not in existing:
                        new_vals.append(v)
                        existing.add(v)
            if new_vals:
                after = ' | '.join(sorted(existing))
                ws.cell(row=keep_row_num, column=col_idx).value = after
                merged_groups += 1

        # ── 覆盖列（用新行的值替换旧行的值） ──
        overwrite_cols = [
            (episodes_col_name, episodes_col_idx),
            (duration_col_name, duration_col_idx),
            (director_col_name, director_col_idx),
            (music_col_name, music_col_idx),
            (chara_design_col_name, chara_design_col_idx),
            (mecha_design_col_name, mecha_design_col_idx),
            (original_col_name, original_col_idx),
            (original_plan_col_name, original_plan_col_idx),
            (script_col_name, script_col_idx),
            (series_composition_col_name, series_composition_col_idx),
            (storyboard_col_name, storyboard_col_idx),
            (performance_col_name, performance_col_idx),
        ]
        for col_name, col_idx in overwrite_cols:
            if not col_name or len(del_row_nums) == 0:
                continue
            raw_old = keep_df_row.get(col_name, '')
            old_val = '' if pd.isna(raw_old) or str(raw_old).strip() in ('', 'nan') else str(raw_old).strip()
            for del_row_num in del_row_nums:
                del_df_idx = del_row_num - header_row - 1
                if del_df_idx < 0 or del_df_idx >= len(df_valid):
                    continue
                raw_new = df_valid.iloc[del_df_idx].get(col_name, '')
                new_val = '' if pd.isna(raw_new) or str(raw_new).strip() in ('', 'nan') else str(raw_new).strip()
                if new_val and new_val != old_val:
                    ws.cell(row=keep_row_num, column=col_idx).value = new_val
                    merged_groups += 1
                    break

        to_delete.extend(del_row_nums)

    # ── 输出处理报告 ──
    if duplicate_count > 0 or len(url_corrections) > 0:
        print(f'\n{"━"*60}')
        print(f'  🔄 处理报告')
        print(f'{"━"*60}')
        print(f'  发现重复:    {duplicate_count} 个名称')
        print(f'  待删除行:    {len(to_delete)} 行')
        print(f'  标签合并:    {merged_groups} 个')

    if url_corrections:
        print(f'  URL 纠错:    {len(url_corrections)} 个')
        for line in url_corrections:
            print(f'  {line}')

    if skipped_no_url:
        names_str = ', '.join(skipped_no_url[:5])
        if len(skipped_no_url) > 5:
            names_str += f', ...共{len(skipped_no_url)}个'
        print(f'\n  ⚠️  跳过(全无URL): {names_str}')

    if not to_delete:
        if len(url_corrections) > 0:
            print(f'\n[超链接] 正在检查 URL 列的超链接...')
            clean_hyperlinks_in_column(ws, url_col_idx, header_row + 1, ws.max_row)
            wb.save(filepath)
        else:
            print(f'\n  ✅ 无需清洗')
        wb.close()
        print(f'  ⏱️  {time.time() - start_total:.2f}s')
        return

    # ── 从后往前删除行（合并连续区域） ──
    to_delete.sort(reverse=True)
    del_ranges = []
    i = 0
    while i < len(to_delete):
        j = i
        while j + 1 < len(to_delete) and to_delete[j] - to_delete[j + 1] == 1:
            j += 1
        start_row = to_delete[j]
        count = j - i + 1
        del_ranges.append((start_row, count))
        i = j + 1

    del_count = 0
    for start_row, count in del_ranges:
        ws.delete_rows(start_row, count)
        del_count += count

    print(f'  🗑️  删除 {del_count} 行')

    # ── 清除超链接 ──
    print(f'  🔗 正在清除 URL 列超链接...')
    clean_hyperlinks_in_column(ws, url_col_idx, header_row + 1, ws.max_row)

    # ── 保存 ──
    elapsed = time.time() - start_total
    wb.save(filepath)
    wb.close()
    print(f'  ✅ 保存: {filepath}')

    # ── 最终汇总 ──
    print(f'\n{"═"*60}')
    print(f'  ✅ 清洗完成！')
    print(f'{"═"*60}')
    print(f'  删除行:    {del_count} 行')
    print(f'  合并标签:  {merged_groups} 个')
    print(f'  URL 纠错:  {len(url_corrections)} 个')
    print(f'  耗时:      {elapsed:.2f}s')
    print(f'{"═"*60}')
    print(f'  备份: {backup_path}')

    # ── 最终快照 ──
    original_indices = set(range(len(df_valid)))
    delete_indices = set(r - (header_row + 1) for r in to_delete)
    keep_mask = [i in original_indices and i not in delete_indices for i in range(len(df_valid))]
    df_keep = df_valid[keep_mask]
    after_name_counts = df_keep[name_col_name].value_counts()
    after_multi = (after_name_counts >= 2).sum()
    print(f'  写入后: {len(df_keep)} 行, {len(after_name_counts)} 个名称', end='')
    print(f', 剩余重复 {after_multi} 个' if after_multi > 0 else f', 无重复 ✅')
    print(f'{"═"*60}')


if __name__ == '__main__':
    main()