import os, re

def find_genuine_duplicates(content, filepath):
    lines = content.split('\n')
    decls = {}
    dups = []
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        match = re.match(r'^export\s+(async\s+)?(function|const|type|interface|class|enum)\s+(\w+)', stripped)
        if match:
            kind = match.group(2)
            name = match.group(3)
            key = f'{kind}:{name}'
            if key in decls:
                dups.append((i+1, key, decls[key]))
            else:
                decls[key] = i+1
    
    return dups

base_dir = '.'
total_dups = 0
for root, dirs, files in os.walk(base_dir):
    dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist-ts')]
    for fn in files:
        if fn.endswith('.ts'):
            fp = os.path.join(root, fn)
            try:
                with open(fp, 'r', encoding='utf-8') as f:
                    content = f.read()
                dups = find_genuine_duplicates(content, fp)
                if dups:
                    print(f'{fp}:')
                    for line_no, key, first_line in dups:
                        print(f'  Line {line_no}: export {key} (first at line {first_line})')
                    total_dups += len(dups)
            except Exception as e:
                pass
print(f'Total genuine export duplicates: {total_dups}')