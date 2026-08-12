import os, re, json

def resolve_conflicts_smart(content):
    if "<<<<<<<" not in content:
        return content, 0
    
    lines = content.split("\n")
    result = []
    i = 0
    resolved_count = 0
    
    while i < len(lines):
        line = lines[i]
        
        if line.startswith("<<<<<<< "):
            our_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith("======="):
                our_lines.append(lines[i])
                i += 1
            
            if i < len(lines):
                i += 1
            
            their_lines = []
            while i < len(lines) and not lines[i].startswith(">>>>>>> "):
                their_lines.append(lines[i])
                i += 1
            
            if i < len(lines):
                i += 1
            
            if our_lines and their_lines:
                first_our = our_lines[0].strip() if our_lines else ""
                first_their = their_lines[0].strip() if their_lines else ""
                
                our_sig = re.sub(r"\s+", " ", first_our)[:60]
                their_sig = re.sub(r"\s+", " ", first_their)[:60]
                
                if our_sig[:20] == their_sig[:20]:
                    result.extend(our_lines)
                else:
                    for ol in our_lines:
                        result.append(ol)
                    for tl in their_lines:
                        if tl not in our_lines:
                            result.append(tl)
            elif our_lines:
                result.extend(our_lines)
            elif their_lines:
                result.extend(their_lines)
            
            resolved_count += 1
        else:
            result.append(line)
            i += 1
    
    return "\n".join(result), resolved_count


def fix_json_duplicate_keys(content):
    try:
        data = json.loads(content)
        return json.dumps(data, indent=2, ensure_ascii=False), True
    except:
        return content, False


base_dir = "."
total_resolved = 0
json_fixed = 0

for root, dirs, files in os.walk(base_dir):
    dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "dist-ts")]
    for fn in files:
        if fn.endswith((".ts", ".json", ".js")):
            fp = os.path.join(root, fn)
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    content = f.read()
                if "<<<<<<<" in content:
                    new_content, count = resolve_conflicts_smart(content)
                    if fp.endswith(".json") and fn != "package-lock.json":
                        fixed, was_fixed = fix_json_duplicate_keys(new_content)
                        if was_fixed:
                            new_content = fixed
                            json_fixed += 1
                    with open(fp, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    total_resolved += count
                    if count > 0:
                        print(f"{fp}: {count} conflicts resolved")
            except Exception as e:
                print(f"Error {fp}: {e}")

print(f"Total conflict blocks resolved: {total_resolved}")
print(f"JSON files deduplicated: {json_fixed}")