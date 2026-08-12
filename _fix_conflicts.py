import os, re

files_to_fix = ['package.json', 'tsconfig.json', 'tsconfig.build.json']

base_dir = '.'

for fname in files_to_fix:
    fp = os.path.join(base_dir, fname)
    if not os.path.exists(fp):
        print(f'{fp}: not found, skipping')
        continue
    
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if '<<<<<<<' not in content:
        print(f'{fp}: no conflicts')
        continue
    
    print(f'{fp}: has conflicts, fixing...')
    
    # Pattern to match conflict blocks
    # <<<<<<< Updated upstream
    # ... upstream content ...
    # =======
    # ... current content ...
    # >>>>>>> origin/HEAD or similar
    
    lines = content.split('\n')
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        if line.startswith('<<<<<<< '):
            # Found a conflict marker
            upstream_lines = []
            current_lines = []
            separator_found = False
            
            j = i + 1
            while j < len(lines):
                lj = lines[j]
                
                if lj.startswith('=======') and not separator_found:
                    separator_found = True
                    j += 1
                    continue
                elif lj.startswith('>>>>>>> '):
                    # End of conflict
                    break
                
                if separator_found:
                    current_lines.append(lj)
                else:
                    upstream_lines.append(lj)
                
                j += 1
            
            # We'll take the upstream version (Updated upstream)
            result.extend(upstream_lines)
            i = j + 1
        else:
            result.append(line)
            i += 1
    
    fixed_content = '\n'.join(result)
    
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(fixed_content)
    
    print(f'{fp}: fixed ({len(result)} lines)')

print('\nDone.')