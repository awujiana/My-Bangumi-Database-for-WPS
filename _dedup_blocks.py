import os, re

def deduplicate_file(filepath):
    """Remove duplicated consecutive blocks in a TypeScript file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    result = []
    i = 0
    changes = 0
    
    while i < len(lines):
        # Look for import/export block patterns that might be duplicated
        stripped = lines[i].strip()
        
        # Pattern: import/export blocks that span multiple lines
        if stripped.startswith('import ') or stripped.startswith('export {') or stripped.startswith('} from ') or (stripped.startswith('}') and 'from ' in stripped):
            # Collect the full block
            block_start = i
            block_lines = []
            j = i
            brace_depth = 0
            started = False
            
            while j < len(lines):
                bl = lines[j]
                block_lines.append(bl)
                brace_depth += bl.count('{') - bl.count('}')
                if '{' in bl:
                    started = True
                if started and brace_depth <= 0 and j > i:
                    if not (bl.strip().endswith(',') or bl.strip().endswith(';')):
                        break
                j += 1
            
            block_text = '\n'.join(block_lines)
            
            # Check if this exact block appears again in the remaining lines
            remaining_text = '\n'.join(lines[j:j+50])
            if block_text in remaining_text and len(block_lines) > 2:
                # Found duplicate - skip this block and the duplicate
                print(f'  Found duplicate block at line {i+1} ({len(block_lines)} lines)')
                changes += 1
                
                # Skip forward to past both blocks
                # First skip the original block
                i = j
                # Then skip the duplicate
                remaining = '\n'.join(lines[i:])
                if block_text in remaining:
                    # Find and skip past the duplicate
                    dup_idx = remaining.find(block_text)
                    lines_remaining = remaining[:dup_idx].split('\n')
                    lines_after = remaining[dup_idx+len(block_text):].lstrip('\n').split('\n')
                    
                    # Add lines before duplicate to result
                    result.extend(lines_remaining)
                    # Continue with lines after duplicate
                    # Write back modified lines list
                    new_lines = result + lines_after
                    lines = new_lines
                    i = len(result)
                    result = []
                    continue
                else:
                    continue
            else:
                result.extend(block_lines)
                i = j
                continue
        elif stripped.startswith('// ==========') and i > 0:
            # Section header - check if this section was already processed
            # Look back through result for same section header
            section_name = stripped
            prev_sections = [l for l in result if l.strip().startswith('// ==========')]
            if section_name in prev_sections:
                # This section was already seen - skip until next section or EOF
                j = i + 1
                while j < len(lines):
                    if lines[j].strip().startswith('// =========='):
                        break
                    j += 1
                print(f'  Skipping duplicate section "{section_name}" at line {i+1}')
                changes += 1
                i = j
                continue
        
        result.append(lines[i])
        i += 1
    
    if changes > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('\n'.join(result))
    
    return changes


base_dir = '.'
total = 0
files_fixed = 0

for root, dirs, files in os.walk(base_dir):
    dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist-ts')]
    for fn in files:
        if fn.endswith('.ts'):
            fp = os.path.join(root, fn)
            try:
                changes = deduplicate_file(fp)
                if changes > 0:
                    total += changes
                    files_fixed += 1
                    print(f'{fp}: {changes} duplicate blocks removed')
            except Exception as e:
                print(f'Error {fp}: {e}')

print(f'\nTotal: {total} duplicate blocks removed from {files_fixed} files')