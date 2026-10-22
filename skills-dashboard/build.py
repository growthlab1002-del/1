#!/usr/bin/env python3
"""스킬 팩 zip(또는 풀린 폴더)을 읽어 대시보드 HTML 한 장으로 묶습니다.

    python3 skills-dashboard/build.py ~/Downloads/wadiz-skills-pack.zip
    → skills-dashboard/dist/skills-dashboard.html

스킬 원문은 dist/ 안의 결과 파일에만 들어가고, 저장소에는 올라가지 않습니다(.gitignore).
"""
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, 'template.html')
OUT = os.path.join(HERE, 'dist', 'skills-dashboard.html')

SKILL_DIR = '03_스킬_폴더/'
GUIDE_DIR = '04_작업지침/'
GUIDE_KEYS = {'00_': 'prep', '01_': 'ad', '02_': 'sns', '03_': 'sales'}
TEXT_EXT = ('.md', '.csv', '.json', '.py', '.txt')
MAX_FILE_CHARS = 40000  # 참고 파일 하나가 너무 크면 잘라서 넣음


def read_source(src):
    """{상대경로: 텍스트} — zip이면 안쪽 경로, 폴더면 폴더 기준 경로."""
    files = {}
    if os.path.isdir(src):
        for root, _, names in os.walk(src):
            for n in names:
                p = os.path.join(root, n)
                rel = os.path.relpath(p, src).replace(os.sep, '/')
                if rel.endswith(TEXT_EXT):
                    with open(p, encoding='utf-8', errors='replace') as f:
                        files[rel] = f.read()
    else:
        with zipfile.ZipFile(src) as z:
            for info in z.infolist():
                name = info.filename
                if info.is_dir() or not name.endswith(TEXT_EXT):
                    continue
                files[name] = z.read(info).decode('utf-8', errors='replace')
    return files


def parse_frontmatter(text):
    m = re.match(r'^---\n(.*?)\n---\n?', text, re.S)
    if not m:
        return {}, text
    meta, lines = {}, m.group(1).split('\n')
    i = 0
    while i < len(lines):
        km = re.match(r'^([A-Za-z_-]+):\s*(.*)$', lines[i])
        i += 1
        if not km:
            continue
        key, val = km.group(1), km.group(2).strip()
        if val in ('>', '|', '>-', '|-'):
            block = []
            while i < len(lines) and (lines[i].startswith(' ') or not lines[i].strip()):
                block.append(lines[i].strip())
                i += 1
            joiner = ' ' if val.startswith('>') else '\n'
            val = joiner.join(b for b in block).strip()
        elif len(val) >= 2 and val[0] == val[-1] and val[0] in '"\'':
            val = val[1:-1].replace('\\"', '"')
        meta[key] = val
    return meta, text[m.end():]


def strip_root(p):
    """zip 안 최상위 폴더 이름(wadiz-skills-v4.1/ 등)을 떼어 냄."""
    for marker in (SKILL_DIR, GUIDE_DIR):
        k = p.find(marker)
        if k >= 0:
            return p[k:]
    return None


def skill_files(files):
    """{(스킬id, 폴더 안 경로): 텍스트} — 로컬 서버가 스크립트를 풀어 둘 때 씀."""
    out = {}
    for path, text in files.items():
        rel = strip_root(path)
        if rel and rel.startswith(SKILL_DIR):
            parts = rel[len(SKILL_DIR):].split('/')
            if len(parts) >= 2 and all(p not in ('', '.', '..') for p in parts):
                out[(parts[0], '/'.join(parts[1:]))] = text
    return out


def build(src):
    html, skills, guides = build_html(src)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'스킬 {len(skills)}개, 작업지침 {len(guides)}개 → {OUT} ({len(html) // 1024} KB)')
    return skills


def build_html(src, files=None):
    files = files if files is not None else read_source(src)
    skills, guides = {}, {}
    for path, text in sorted(files.items()):
        rel = strip_root(path)
        if not rel:
            continue
        if rel.startswith(GUIDE_DIR):
            fname = rel[len(GUIDE_DIR):]
            for prefix, key in GUIDE_KEYS.items():
                if fname.startswith(prefix):
                    guides[key] = text
            continue
        parts = rel[len(SKILL_DIR):].split('/')
        if len(parts) < 2:
            continue
        sid, inner = parts[0], '/'.join(parts[1:])
        s = skills.setdefault(sid, {'name': sid, 'desc': '', 'body': '', 'refs': []})
        if inner == 'SKILL.md':
            meta, _ = parse_frontmatter(text)
            s['name'] = meta.get('name', sid)
            s['desc'] = meta.get('description', '')
            s['body'] = text
        else:
            if len(text) > MAX_FILE_CHARS:
                text = text[:MAX_FILE_CHARS] + '\n…(길어서 생략)'
            s['refs'].append({'path': inner, 'text': text})

    missing = [k for k, v in skills.items() if not v['body']]
    if missing:
        sys.exit('SKILL.md 가 없는 폴더: ' + ', '.join(missing))
    if not skills:
        sys.exit('스킬을 찾지 못했어요. zip 안에 03_스킬_폴더/ 가 있는지 확인해 주세요.')

    data = json.dumps({'skills': skills, 'guides': guides}, ensure_ascii=False)
    data = data.replace('</', '<\\/')  # <script> 안에서 닫는 태그로 읽히지 않게
    with open(TEMPLATE, encoding='utf-8') as f:
        html = f.read()
    if '__SKILLS_JSON__' not in html:
        sys.exit('template.html 에 __SKILLS_JSON__ 자리가 없어요.')
    html = html.replace('__SKILLS_JSON__', data)
    return html, skills, guides


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(sys.argv[1])
