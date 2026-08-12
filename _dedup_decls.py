import os, re

base_dir = '.'
total_dupes = 0
files_fixed = []

def find_duplicate_declarations(filepath):
    """Find duplicate declarations in a TypeScript file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    changes = 0
    seen_names = set()
    
    i = 0
    result = []
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Skip comments and empty lines
        if not stripped or stripped.startswith('//') or stripped.startswith('*'):
            result.append(line)
            i += 1
            continue
        
        # Check if this line declares something we've already seen
        # Match patterns like: const name, function name, class name, etc.
        m = re.match(r'^(?:export\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)', stripped)
        
        is_duplicate = False
        if m:
            decl_name = m.group(1)
            if decl_name in seen_names:
                print(f'  Duplicate declaration "{decl_name}" at line {i+1}')
                changes += 1
                is_duplicate = True
            else:
                seen_names.add(decl_name)
        
        if not is_duplicate:
            result.append(line)
        
        i += 1
    
    if changes > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('\n'.join(result))
    
    return changes


# Find TypeScript source files that might have duplicates
ts_files = []
for root, dirs, files in os.walk(base_dir):
    dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist-ts', 'wps-addon-build')]
    for fname in files:
        if fname.endswith('.ts'):
            fp = os.path.join(root, fname)
            ts_files.append(fp)

# Process each file
for fp in ts_files:
    try:
        changes = find_duplicate_declarations(fp)
        if changes > 0:
            total_dupes += changes
            files_fixed.append(f'{fp}: {changes}')
    except Exception as e:
        print(f'Error {fp}: {e}')

print(f'\nTotal: {total_dupes} duplicate declarations removed from {len(files_fixed)} files')
for f in files_fixed:
    print(f'  {f}')