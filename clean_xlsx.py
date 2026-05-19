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

依赖：pip install openpyxl
"""

import sys
import os
import shutil
import time
from collections import defaultdict
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter


def find_header_row(ws, max_search=20):
    """查找同时包含"名称"和"Bangumi_URL"的表头行"""
    for row in ws.iter_rows(min_row=1, max_row=max_search, max_col=ws.max_column):
        values = [str(c.value or '').strip() for c in row]
        has_name = any('名称' in v for v in values)
        has_url = any('Bangumi_URL' in v for v in values)
        if has_name and has_url:
            return row[0].row
    return None


def get_column_map(ws, header_row):
    """建立 列名 → 列号 映射"""
    return {
        str(c.value).strip(): c.column
        for c in ws[header_row] if c.value
    }


def col_val(ws, row, col):
    """安全获取单元格字符串值"""
    cell = ws.cell(row=row, column=col)
    return str(cell.value or '').strip()


def set_col_val(ws, row, col, value):
    """写入单元格值"""
    ws.cell(row=row, column=col).value = value


def parse_tags(tag_str):
    """解析 ' | ' 分隔的标签为 set"""
    return set(t.strip() for t in tag_str.split('|') if t.strip())


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

    # ── 打开工作簿 ──
    print(f'[加载] {filepath}')

    # .xlsm 文件需保留 VBA 宏
    is_xlsm = filepath.lower().endswith('.xlsm')
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
        sheet_name = next(
            (n for n in wb.sheetnames if wb[n].max_row > 1),
            None
        )
        if not sheet_name:
            print('[错误] 所有工作表均为空')
            wb.close()
            sys.exit(1)
        print(f'[自动] 选择工作表: "{sheet_name}"')

    ws = wb[sheet_name]
    print(f'[信息] "{sheet_name}" → {ws.max_row}行 × {ws.max_column}列')

    # ── 查找表头行 ──
    header_row = find_header_row(ws)
    if not header_row:
        print('[错误] 未找到表头行（需要包含"名称"和"Bangumi_URL"列）')
        wb.close()
        sys.exit(1)
    print(f'[信息] 表头行: 第{header_row}行')

    # ── 列映射 ──
    col_map = get_column_map(ws, header_row)
    print(f'[信息] 列名: {list(col_map.keys())}')

    name_col = next((c for n, c in col_map.items() if '名称' in n), None)
    url_col = next((c for n, c in col_map.items() if 'Bangumi_URL' in n), None)
    tags_col = next((c for n, c in col_map.items() if '标签' in n or '分级' in n), None)

    if not name_col:
        print('[错误] 未找到"名称"列')
        wb.close()
        sys.exit(1)
    if not url_col:
        print('[错误] 未找到"Bangumi_URL"列')
        wb.close()
        sys.exit(1)

    print(f'[信息] 名称列 → {get_column_letter(name_col)} (列{name_col})')
    print(f'[信息] URL列  → {get_column_letter(url_col)} (列{url_col})')
    print(f'[信息] 标签列 → {get_column_letter(tags_col) if tags_col else "未找到"} (列{tags_col})')

    # ── 按名称分组 ──
    start_row = header_row + 1
    end_row = ws.max_row
    name_rows = defaultdict(list)
    empty_count = 0
    empty_rows_info = []

    for r in range(start_row, end_row + 1):
        name = col_val(ws, r, name_col)
        if not name:
            empty_count += 1
            empty_rows_info.append(r)
            continue
        name_rows[name].append(r)

    total_data = end_row - start_row + 1
    single_count = sum(1 for v in name_rows.values() if len(v) == 1)
    multi_count = sum(1 for v in name_rows.values() if len(v) >= 2)
    row_distribution = {}
    for rows in name_rows.values():
        k = len(rows)
        row_distribution[k] = row_distribution.get(k, 0) + 1

    print(f'\n{"─"*60}')
    print(f'  📊 数据扫描报告')
    print(f'{"─"*60}')
    print(f'  数据区间:    第 {start_row}~{end_row} 行 ({total_data} 行)')
    print(f'  有效名称:    {len(name_rows)} 个')
    print(f'  单行名称:    {single_count} 个（无需处理）')
    print(f'  重复名称:    {multi_count} 个（待清洗）')
    print(f'  空名称行:    {empty_count} 行（行{empty_rows_info}）' if empty_count <= 5 else
          f'  空名称行:    {empty_count} 行')
    print(f'')
    print(f'  名称分布:')
    for k in sorted(row_distribution):
        label = '行' if k == 1 else '行'
        bar = '█' * min(row_distribution[k], 40)
        print(f'    {k:>2}条/名称 → {row_distribution[k]:>4} 个 {bar}')
    print(f'{"─"*60}')

    # ── 处理重复 ──
    to_delete = []
    merged_groups = 0
    duplicate_count = 0
    duplicate_details = []
    skipped_no_url = []
    merged_tag_log = []
    delete_tag_log = []
    processing_log = []

    for name, rows in name_rows.items():
        if len(rows) <= 1:
            continue

        with_url = [r for r in rows if col_val(ws, r, url_col)]
        without_url = [r for r in rows if not col_val(ws, r, url_col)]

        if not with_url:
            skipped_no_url.append(name)
            continue

        duplicate_count += 1
        keep_row = with_url[0]
        duplicate_details.append((name, with_url, without_url))

        name_entry = {
            'name': name,
            'total': len(rows),
            'with_url_count': len(with_url),
            'without_url_count': len(without_url),
            'keep_row': keep_row,
            'other_url_rows': with_url[1:] if len(with_url) > 1 else [],
            'delete_rows': without_url,
            'merged_tags': [],
            'existing_tags_before': '',
            'existing_tags_after': '',
        }

        new_tags = []
        if tags_col and without_url:
            before = col_val(ws, keep_row, tags_col)
            existing = parse_tags(before)
            name_entry['existing_tags_before'] = before or '（空）'

            for dr in without_url:
                dt = col_val(ws, dr, tags_col)
                if dt:
                    delete_tag_log.append(f'    行{dr} 标签 → "{dt}"')
                for t in parse_tags(dt):
                    if t not in existing:
                        new_tags.append(t)
                        existing.add(t)
            if new_tags:
                after = ' | '.join(sorted(existing))
                set_col_val(ws, keep_row, tags_col, after)
                name_entry['merged_tags'] = new_tags
                name_entry['existing_tags_after'] = after
                merged_groups += 1
                merged_tag_log.append(f'  "{name}" (保留行{keep_row})')
                merged_tag_log.append(f'    原始标签: {name_entry["existing_tags_before"]}')
                merged_tag_log.append(f'    新增标签: {new_tags}')
                merged_tag_log.append(f'    合并结果: {after}')

        for del_row in without_url:
            to_delete.append(del_row)

        processing_log.append(name_entry)

    # ── 输出聚合处理报告 ──
    print(f'\n{"━"*60}')
    print(f'  🔄 重复名称处理报告')
    print(f'{"━"*60}')
    print(f'  发现重复:    {duplicate_count} 个名称')
    print(f'  待删除行:    {len(to_delete)} 行')
    print(f'  标签合并:    {merged_groups} 个名称组')

    if duplicate_details:
        print(f'')
        for idx, (name, wu, wou) in enumerate(duplicate_details, 1):
            keep_row = wu[0]
            other_url = wu[1:] if len(wu) > 1 else []
            print(f'  [{idx}] "{name}"')
            print(f'       总 {len(wu)+len(wou)} 行 │ 保留行{keep_row} (含URL)')
            if other_url:
                print(f'       另含URL行: {other_url}（保留）')
            print(f'       待删除 {len(wou)} 行(无URL): 行{wou}')

    if skipped_no_url:
        print(f'\n  ⚠️  跳过(全无URL):')
        for n in skipped_no_url:
            total = len(name_rows[n])
            print(f'      "{n}" ({total} 行，均无 Bangumi_URL)')

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
        td = time.time() - start_total
        print(f'\n  ⏱️  耗时: {td:.2f}s')
        return

    # ── 从后往前删除行（避免行号偏移） ──
    print(f'\n{"━"*60}')
    print(f'  🗑️  删除执行')
    print(f'{"━"*60}')
    to_delete.sort(reverse=True)
    print(f'  删除顺序（从后往前）:')
    # 合并连续行显示
    ranges = []
    i = 0
    while i < len(to_delete):
        j = i
        while j + 1 < len(to_delete) and to_delete[j] - to_delete[j + 1] == 1:
            j += 1
        if i == j:
            ranges.append(str(to_delete[i]))
        else:
            ranges.append(f'{to_delete[j]}~{to_delete[i]}')
        i = j + 1
    print(f'    {", ".join(ranges)}')
    print(f'  共 {len(ranges)} 个范围 / {len(to_delete)} 行')

    del_count = 0
    for row in to_delete:
        ws.delete_rows(row, 1)
        del_count += 1
        if del_count % 500 == 0:
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

    # ── 最终汇总 ──
    print(f'\n{"═"*60}')
    print(f'  ✅ 清洗完成！')
    print(f'{"═"*60}')
    print(f'  删除无URL重复行:  {del_count} 行')
    print(f'  合并标签:         {merged_groups} 个名称组')
    print(f'  耗时:             {elapsed:.2f}s')
    print(f'{"═"*60}')


if __name__ == '__main__':
    main()