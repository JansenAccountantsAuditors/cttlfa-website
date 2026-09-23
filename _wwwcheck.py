import re, subprocess, os
h = open('index.html', encoding='utf-8').read()
blocks = re.findall(r'<script(?![^>]*\ssrc=)[^>]*>(.*?)</script>', h, re.S)
print(len(blocks), 'inline blocks')
ok = True
for i, b in enumerate(blocks):
    fn = '_wb%d.js' % i
    open(fn, 'w', encoding='utf-8').write(b)
    r = subprocess.run(['node', '--check', fn], capture_output=True, text=True)
    err = r.stderr.strip()
    print('block', i, '(%d chars):' % len(b), 'ok' if not err else err[:400])
    if err: ok = False
    os.remove(fn)
print('ALL OK' if ok else 'FAILED')
