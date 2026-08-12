import os, re

base_dir = '.'
fixed_count = 0
total_fixes = 0
files_fixed = []

for root, dirs, files in os.walk(base_dir):
    # Skip node_modules, .git, dist-ts (generated), wps-addon-build (generated)
    dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'wps-addon-build')]
    
    for fname in files:
        fp = os.path.join(root, fname)
        
        # Skip binary files and certain extensions
        if any(fp.endswith(ext) for ext in ('.png', '.jpg', '.gif', '.ico', '.svg', '.exe', '.dll', '.so', '.obj', '.zip', '.gz', '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.exe')):
            continue
        
        try:
            with open(fp, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception:
            continue
        
        if '<<<<<<<' not in content:
            continue
        
        # Skip package-lock.json and other auto-generated files
        if fname in ('package-lock.json',):
            continue
        
        lines = content.split('\n')
        result = []
        i = 0
        file_fixes = 0
        
        while i < len(lines):
            line = lines[i]
            
            if line.startswith('<<<<<<< '):
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
                        break
                    
                    if separator_found:
                        current_lines.append(lj)
                    else:
                        upstream_lines.append(lj)
                    
                    j += 1
                
                # Take upstream version
                result.extend(upstream_lines)
                file_fixes += 1
                i = j + 1
            else:
                result.append(line)
                i += 1
        
        if file_fixes > 0:
            fixed_content = '\n'.join(result)
            with open(fp, 'w', encoding='utf-8') as f:
                f.write(fixed_content)
            total_fixes += file_fixes
            files_fixed.append(f'{fp} ({file_fixes} blocks)')

print(f'Total: {total_fixes} conflict blocks fixed across {len(files_fixed)} files')
for f in files_fixed:
    print(f'  {f}')