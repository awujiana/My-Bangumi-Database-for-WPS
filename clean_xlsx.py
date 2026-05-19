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

    for r in range(start_row, end_row + 1):
        name = col_val(ws, r, name_col)
        if not name:
            empty_count += 1
            continue
        name_rows[name].append(r)

    total_data = end_row - start_row + 1
    print(f'\n[数据] 总行: {total_data} | 有效名称: {len(name_rows)} | 空名称: {empty_count}')

    # ── 处理重复 ──
    to_delete = []
    merged_groups = 0
    duplicate_count = 0
    duplicate_details = []
    skipped_no_url = []
    merged_tag_log = []

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

        new_tags = []
        if tags_col and without_url:
            existing = parse_tags(col_val(ws, keep_row, tags_col))
            for dr in without_url:
                for t in parse_tags(col_val(ws, dr, tags_col)):
                    if t not in existing:
                        new_tags.append(t)
                        existing.add(t)
            if new_tags:
                set_col_val(ws, keep_row, tags_col, ' | '.join(sorted(existing)))
                merged_groups += 1
                merged_tag_log.append(f'  "{name}": +{new_tags}')

        to_delete.extend(without_url)

    print(f'[清洗] 重复名称: {duplicate_count} | 待删除行: {len(to_delete)} | 标签合并: {merged_groups} 组')

    if duplicate_details:
        print('\n重复名称详情:')
        for name, wu, wou in duplicate_details:
            print(f'  "{name}": {len(wu)}条含URL(行{wu}) | {len(wou)}条无URL(行{wou})')

    if skipped_no_url:
        print(f'\n跳过(全无URL): {", ".join(f'"{n}"' for n in skipped_no_url)}')

    if not to_delete:
        print('\n无需清洗')
        wb.close()
        return

    # ── 从后往前删除行（避免行号偏移） ──
    print(f'\n[删除] 处理 {len(to_delete)} 行...')
    to_delete.sort(reverse=True)
    del_count = 0
    for row in to_delete:
        ws.delete_rows(row, 1)
        del_count += 1
        if del_count % 500 == 0:
            print(f'  ...已删除 {del_count} 行')

    print(f'[删除] 完成: 删除 {del_count} 行')

    if merged_tag_log:
        print('\n合并的标签:')
        for line in merged_tag_log:
            print(line)

    # ── 保存 ──
    elapsed = time.time() - start_total
    print(f'\n[保存] 写入 {filepath} ...')
    wb.save(filepath)
    wb.close()

    print(f'\n{"="*50}')
    print(f'✅ 清洗完成 (耗时 {elapsed:.1f}s)')
    print(f'   删除:    {del_count} 行')
    print(f'   标签合并: {merged_groups} 个名称组')
    print(f'   文件:    {filepath}')
    print(f'   备份:    {backup_path}')
    print(f'{"="*50}')


if __name__ == '__main__':
    main()