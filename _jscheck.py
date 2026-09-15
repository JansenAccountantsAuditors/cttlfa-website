import re, subprocess, sys, os, tempfile, glob
files=[r"admin.cttfa.co.za\index.html", r"club.cttfa.co.za\index.html"]
ok=True
def check(label, code):
    global ok
    tf=tempfile.NamedTemporaryFile("w",suffix=".js",delete=False,encoding="utf-8")
    tf.write(code); tf.close()
    r=subprocess.run(["node","--check",tf.name],capture_output=True,text=True)
    os.unlink(tf.name)
    if r.returncode!=0:
        ok=False; print(f"  {label}: FAIL"); print(r.stderr[:800])
    else:
        print(f"  {label}: ok ({len(code)} chars)")
for f in files:
    html=open(f,encoding="utf-8").read()
    blocks=re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S|re.I)
    print(f"{f}: {len(blocks)} inline script block(s)")
    for i,b in enumerate(blocks):
        check(f"block {i}", b)
    jsdir=os.path.join(os.path.dirname(f),"js")
    mods=sorted(glob.glob(os.path.join(jsdir,"*.js")))
    if mods:
        print(f"{f}: {len(mods)} module file(s) in js/")
        for m in mods:
            check(os.path.basename(m), open(m,encoding="utf-8").read())
print("ALL OK" if ok else "SYNTAX ERRORS FOUND")
