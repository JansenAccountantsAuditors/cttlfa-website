$cb=Get-Random
try{
  $r=Invoke-WebRequest -Uri ("https://admin.cttfa.co.za/index.html?cb="+$cb) -UseBasicParsing -Method Head
  Write-Output "== index headers =="
  foreach($k in $r.Headers.Keys){ Write-Output ($k + ": " + $r.Headers[$k]) }
}catch{ Write-Output ("INDEX HEAD ERR: "+$_.Exception.Message) }
try{
  $p=Invoke-WebRequest -Uri ("https://admin.cttfa.co.za/uct-schedule-2026-09.pdf?cb="+$cb) -UseBasicParsing -Method Head
  Write-Output "== pdf headers =="
  foreach($k in $p.Headers.Keys){ Write-Output ($k + ": " + $p.Headers[$k]) }
}catch{ Write-Output ("PDF HEAD ERR: "+$_.Exception.Message) }
Remove-Item _hdr.ps1 -ErrorAction SilentlyContinue
