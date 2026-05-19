"""
外部数据清洗脚本 — 独立于 WPS 运行
====================================
功能：对 Excel 文件中重复名称的行进行清洗（去重、合并标签）
逻辑与 WPS 加载项内的 cleanLockedDataSheet 一致：
  1. 按"名称"列分组
  2. 同一名称有多条时：保留有 URL 的行，删除无 URL 的行
  3. 被删除行的标签合并到保留行上（去重）

用法：
  python clean_xlsx.py <文件路径> [工作表名称]

示例：
  python clean_xlsx.py "C:\数据.xlsx" "动画"
  python clean_xlsx.py "C:\数据.xlsm" "动画"    # 也支持 xlsm，自动保留宏
  python clean_xlsx.py "C:\数据.xlsx"             # 自动选择第一个非空表

依赖：pip install pandas openpyxl
"""

import sys
import os
import shutil
import time
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


def pick_column(col_map, keywords):
    """从列名映射中选出匹配关键词的第一列"""
    for col_name, col_idx in col_map.items():
        for kw in keywords:
            if kw in col_name:
                return col_name, col_idx
    return None, None


def parse_tags(tag_str):
    """解析 ' | ' 分隔的标签为 set"""
    return set(t.strip() for t in str(tag_str).split('|') if t.strip())


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

    # ── 备份 ──
    backup_path = filepath + '.bak'
    if not os.path.exists(backup_path):
        print(f'[备份] 创建: {backup_path}')
        shutil.copy2(filepath, backup_path)
    else:
        print(f'[备份] 已存在: {backup_path}')

    # ── 打开工作簿（仅用于元信息读取 + 后续写回） ──
    is_xlsm = filepath.lower().endswith('.xlsm')
    print(f'[加载] {filepath}')
    wb = load_workbook(filepath, keep_vba=is_xlsm)
    start_total = time.time()

    # ── 选择工作表 ──
    if len(sys.argv) >= 3:
        sheet_name = sys.argv[2]
        if sheet_name not in wb.sheetnames:
            print(f'[错误] 找不到工作表 "{sheet_name}"，可选: {wb.sheetnames}')
            wb.close()
            sys.exit(1)
    else:
        sheet_name = next((n for n in wb.sheetnames if wb[n].max_row > 1), None)
        if not sheet_name:
            print('[错误] 所有工作表均为空')
            wb.close()
            sys.exit(1)
        print(f'[自动] 选择工作表: "{sheet_name}"')

    ws = wb[sheet_name]
    print(f'[信息] "{sheet_name}" → {ws.max_row}行 × {ws.max_column}列')

    # ── 查找表头行 ──
    header_row = find_header_row(wb, sheet_name)
    if not header_row:
        print('[错误] 在前50行中未找到表头行')
        print('       需要包含"名称"和"Bangumi_URL"列')
        print('')
        # 输出前5行列名帮助调试
        for r in range(1, min(6, ws.max_row + 1)):
            vals = [str(c.value or '').strip() for c in ws[r]]
            non_empty = [v for v in vals if v]
            if non_empty:
                print(f'       行{r}: {vals}')
        wb.close()
        sys.exit(1)

    header_names = [str(c.value or '').strip() for c in ws[header_row]]
    col_map = {n: i + 1 for i, n in enumerate(header_names) if n}
    print(f'[信息] 表头行: 第{header_row}行 | 列名: {header_names}')

    name_col_name, name_col_idx = pick_column(col_map, ['名称'])
    url_col_name, url_col_idx = pick_column(col_map, ['Bangumi_URL', 'Bangumi URL', 'URL', 'BGM_URL'])
    tags_col_name, tags_col_idx = pick_column(col_map, ['标签', '分级'])

    if not name_col_name:
        print('[错误] 未找到"名称"列')
        wb.close()
        sys.exit(1)
    if not url_col_name:
        print('[错误] 未找到"Bangumi_URL"列')
        wb.close()
        sys.exit(1)

    name_col_l = get_column_letter(name_col_idx)
    url_col_l = get_column_letter(url_col_idx)
    tags_col_l = get_column_letter(tags_col_idx) if tags_col_idx else '-'
    print(f'[信息] 名称列 → {name_col_l} (列{name_col_idx})')
    print(f'[信息] URL列  → {url_col_l} (列{url_col_idx})')
    print(f'[信息] 标签列 → {tags_col_l} (列{tags_col_idx})' if tags_col_idx else '[信息] 标签列 → 未找到')

    # ════════════════════════════════════════════════════════
    #  用 pandas 读取数据
    # ════════════════════════════════════════════════════════
    df = pd.read_excel(
        filepath,
        sheet_name=sheet_name,
        header=header_row - 1,
        dtype=str
    )

    total_rows_before = len(df)
    print(f'\n[Pandas] 读取完成: {total_rows_before} 行 × {len(df.columns)} 列')

    # ── 过滤空名称行 ──
    name_series = df[name_col_name].astype(str).str.strip()
    empty_mask = (df[name_col_name].isna()) | (name_series == '')
    empty_count = empty_mask.sum()
    df_valid = df[~empty_mask].copy()
    valid_count = len(df_valid)

    # ── 名称分布统计（pandas 聚合） ──
    name_counts = df_valid[name_col_name].value_counts()
    single_count = (name_counts == 1).sum()
    multi_count = (name_counts >= 2).sum()
    dist_series = name_counts.value_counts().sort_index()

    print(f'\n{"─"*60}')
    print(f'  📊 数据扫描报告')
    print(f'{"─"*60}')
    print(f'  数据区间:    第 {header_row+1}~{header_row+total_rows_before} 行 ({total_rows_before} 行)')
    print(f'  读取列数:    {len(df.columns)} 列')
    print(f'  有效名称:    {valid_count} 个')
    print(f'  单行名称:    {single_count} 个（无需处理）')
    print(f'  重复名称:    {multi_count} 个（待清洗）')
    print(f'  空名称行:    {empty_count} 行')
    print(f'')
    print(f'  名称分布:')
    for k in dist_series.index:
        bar = '█' * min(dist_series[k], 40)
        print(f'    {int(k):>2}条/名称 → {int(dist_series[k]):>4} 个 {bar}')
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
    duplicate_details = []
    merged_tag_log = []
    delete_tag_log = []

    for name, group in grouped:
        if len(group) <= 1:
            continue

        with_url = group[group['_has_url']]
        without_url = group[~group['_has_url']]

        if len(with_url) == 0:
            skipped_no_url.append(name)
            continue

        duplicate_count += 1
        keep_idx = with_url.index[0]
        keep_row_num = header_row + 1 + keep_idx
        del_row_nums = [header_row + 1 + i for i in without_url.index]

        duplicate_details.append({
            'name': name,
            'total': len(group),
            'with_url_count': len(with_url),
            'without_url_count': len(without_url),
            'keep_row': keep_row_num,
            'other_url_rows': [header_row + 1 + i for i in with_url.index[1:]],
            'delete_rows': del_row_nums,
        })

        # ── 标签合并（pandas 聚合） ──
        if tags_col_name and len(without_url) > 0:
            raw_before = with_url.iloc[0].get(tags_col_name, '')
            before_tags = '' if pd.isna(raw_before) or str(raw_before).strip() in ('', 'nan') else str(raw_before).strip()
            existing = parse_tags(before_tags)
            new_tags = []

            for _, del_row in without_url.iterrows():
                raw_del = del_row.get(tags_col_name, '')
                del_tags = '' if pd.isna(raw_del) or str(raw_del).strip() in ('', 'nan') else str(raw_del).strip()
                if del_tags:
                    delete_tag_log.append(f'    行{header_row + 1 + del_row.name} 标签 → "{del_tags}"')
                for t in parse_tags(del_tags):
                    if t not in existing:
                        new_tags.append(t)
                        existing.add(t)

            if new_tags:
                after = ' | '.join(sorted(existing))
                set_cell = ws.cell(row=keep_row_num, column=tags_col_idx)
                set_cell.value = after
                merged_groups += 1
                merged_tag_log.append(f'  "{name}" (保留行{keep_row_num})')
                merged_tag_log.append(f'    原始标签: {before_tags or "（空）"}')
                merged_tag_log.append(f'    新增标签: {new_tags}')
                merged_tag_log.append(f'    合并结果: {after}')

        to_delete.extend(del_row_nums)

    # ── 输出聚合处理报告 ──
    print(f'\n{"━"*60}')
    print(f'  🔄 重复名称处理报告')
    print(f'{"━"*60}')
    print(f'  发现重复:    {duplicate_count} 个名称')
    print(f'  待删除行:    {len(to_delete)} 行')
    print(f'  标签合并:    {merged_groups} 个名称组')

    if duplicate_details:
        print('')
        for idx, d in enumerate(duplicate_details, 1):
            print(f'  [{idx}] "{d["name"]}"')
            print(f'       总 {d["total"]} 行 │ 保留行{d["keep_row"]} (含URL)')
            if d['other_url_rows']:
                print(f'       另含URL行: {d["other_url_rows"]}（保留）')
            print(f'       待删除 {d["without_url_count"]} 行(无URL): 行{d["delete_rows"]}')

    if skipped_no_url:
        print(f'\n  ⚠️  跳过(全无URL):')
        for n in skipped_no_url:
            print(f'      "{n}" ({name_counts[n]} 行，均无 Bangumi_URL)')

    if delete_tag_log:
        print(f'\n  🏷️  被删除行的标签内容:')
        for line in delete_tag_log:
            print(f'  {line}')

    if merged_tag_log:
        print(f'\n  🔗 标签合并详情:')
        for line in merged_tag_log:
            print(f'  {line}')

    if not to_delete:
        print(f'\n{"─"*60}')
        print(f'  ✅ 无需清洗')
        print(f'{"─"*60}')
        wb.close()
        print(f'\n  ⏱️  耗时: {time.time() - start_total:.2f}s')
        return

    # ── 从后往前删除行（合并连续范围） ──
    print(f'\n{"━"*60}')
    print(f'  🗑️  删除执行')
    print(f'{"━"*60}')
    to_delete.sort(reverse=True)
    print('  删除顺序（从后往前）:')
    ranges_label = []
    del_ranges = []
    i = 0
    while i < len(to_delete):
        j = i
        while j + 1 < len(to_delete) and to_delete[j] - to_delete[j + 1] == 1:
            j += 1
        start_row = to_delete[j]
        count = j - i + 1
        ranges_label.append(str(to_delete[i]) if i == j else f'{to_delete[j]}~{to_delete[i]}')
        del_ranges.append((start_row, count))
        i = j + 1
    print(f'    {", ".join(ranges_label)}')
    print(f'  共 {len(del_ranges)} 个范围 / {len(to_delete)} 行')

    del_count = 0
    for start_row, count in del_ranges:
        ws.delete_rows(start_row, count)
        del_count += count
        print(f'  ...进度: 已删除 {del_count}/{len(to_delete)} 行')
    print(f'  ✅ 删除完成: 共删除 {del_count} 行')

    # ── 保存 ──
    elapsed = time.time() - start_total
    print(f'\n{"━"*60}')
    print(f'  💾 保存')
    print(f'{"━"*60}')
    print(f'  写入: {filepath}')
    wb.save(filepath)
    wb.close()
    print(f'  备份: {backup_path}')

    # ── 最终汇总（pandas 聚合统计） ──
    print(f'\n{"═"*60}')
    print(f'  ✅ 清洗完成！')
    print(f'{"═"*60}')
    print(f'  删除无URL重复行:  {del_count} 行')
    print(f'  合并标签:         {merged_groups} 个名称组')
    print(f'  耗时:             {elapsed:.2f}s')
    print(f'{"═"*60}')

    # ── 最终数据快照（pandas 再读确认） ──
    df_after = pd.read_excel(filepath, sheet_name=sheet_name, header=header_row - 1, dtype=str)
    print(f'\n  📋 最终快照:')
    print(f'  写入后总行数:  {len(df_after)} 行')
    after_names = df_after[name_col_name].astype(str).str.strip()
    after_valid = after_names[after_names.notna() & (after_names != '') & (after_names != 'nan')]
    after_name_counts = after_valid.value_counts()
    after_multi = (after_name_counts >= 2).sum()
    print(f'  有效名称数:    {len(after_name_counts)} 个')
    print(f'  剩余重复名称:  {after_multi} 个')
    if after_multi == 0:
        print(f'  ✅ 已无重复名称')
    elif after_multi > 0:
        print(f'  ⚠️  仍有 {after_multi} 个名称含多条（可能均有 URL，无需删除）')
    print(f'{"═"*60}')


if __name__ == '__main__':
    main()