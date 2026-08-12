import os, re

def remove_duplicate_exports(content, filepath):
    lines = content.split('\n')
    seen = {}
    result = []
    skip_until = -1
    changes = 0
    
    i = 0
    while i < len(lines):
        if i < skip_until:
            i += 1
            continue
        
        line = lines[i]
        stripped = line.strip()
        
        match = re.match(r'^export\s+(async\s+)?(function|const|type|interface|class|enum)\s+(\w+)', stripped)
        if match:
            kind = match.group(2)
            name = match.group(3)
            key = f'{kind}:{name}'
            
            if key in seen:
                # Skip the entire block - find where it ends
                changes += 1
                # Find block end by looking for next top-level export/import
                j = i + 1
                brace_depth = 0
                found_open = False
                while j < len(lines):
                    lj = lines[j]
                    stripped_j = lj.strip()
                    
                    # Track braces
                    brace_depth += lj.count('{') - lj.count('}')
                    if '{' in lj:
                        found_open = True
                    
                    # Stop when we find the next top-level declaration or closing
                    if j > i and brace_depth <= 0:
                        if stripped_j == '' or stripped_j == '}' or re.match(r'^(export\s+|import\s+|/\*\*|//\s*=|const\s+\w+\s*=|function\s+\w+|interface\s+\w+|class\s+\w+|type\s+\w+|enum\s+\w+)', stripped_j):
                            break
                    j += 1
                
                skip_until = j
                i += 1
                continue
            else:
                seen[key] = i + 1
        
        result.append(line)
        i += 1
    
    return '\n'.join(result), changes


files_to_fix = [
    'ts/schemas/bgmCollection.ts',
    'ts/schemas/bgmUser.ts',
    'ts/schemas/githubEntry.ts',
    'ts/schemas/pluginStorage.ts',
    'ts/services/ribbonService.ts',
    'ts/sync/githubConfig.ts',
    'ts/sync/githubSync.ts',
]

total = 0
for fp in files_to_fix:
    try:
        with open(fp, 'r', encoding='utf-8') as f:
            content = f.read()
        new_content, changes = remove_duplicate_exports(content, fp)
        if changes > 0:
            with open(fp, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f'{fp}: removed {changes} duplicates')
            total += changes
    except Exception as e:
        print(f'Error {fp}: {e}')

print(f'Total duplicates removed: {total}')