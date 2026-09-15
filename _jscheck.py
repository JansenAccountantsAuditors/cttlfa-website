import re, subprocess, sys, os, tempfile
files=[r"admin.cttfa.co.za\index.html", r"club.cttfa.co.za\index.html"]
ok=True
for f in files:
    html=open(f,encoding="utf-8").read()
    blocks=re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S|re.I)
    print(f"{f}: {len(blocks)} inline script block(s)")
    for i,b in enumerate(blocks):
        tf=tempfile.NamedTemporaryFile("w",suffix=".js",delete=False,encoding="utf-8")
        tf.write(b); tf.close()
        r=subprocess.run(["node","--check",tf.name],capture_output=True,text=True)
        os.unlink(tf.name)
        if r.returncode!=0:
            ok=False; print(f"  block {i}: FAIL"); print(r.stderr[:800])
        else:
            print(f"  block {i}: ok ({len(b)} chars)")
print("ALL OK" if ok else "SYNTAX ERRORS FOUND")
