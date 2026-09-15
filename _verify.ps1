$ErrorActionPreference='SilentlyContinue'
$cb=Get-Random
# live PDF
$pdf=Join-Path $env:TEMP ("uctchk_"+$cb+".pdf")
try{
  Invoke-WebRequest -Uri ("https://admin.cttfa.co.za/uct-schedule-2026-09.pdf?cb="+$cb) -UseBasicParsing -OutFile $pdf -Headers @{'Cache-Control'='no-cache'}
  $b=[System.IO.File]::ReadAllBytes($pdf)
  $hdr=[System.Text.Encoding]::ASCII.GetString($b[0..4])
  Write-Output ("PDF bytes=" + $b.Length + " header=" + $hdr)
  Remove-Item $pdf -ErrorAction SilentlyContinue
}catch{ Write-Output ("PDF FETCH ERR: " + $_.Exception.Message) }
# app markers
try{
  $r=Invoke-WebRequest -Uri ("https://admin.cttfa.co.za/index.html?cb="+$cb) -UseBasicParsing -Headers @{'Cache-Control'='no-cache'}
  $c=$r.Content
  foreach($m in @('deb_prepared_get','debUrlToB64','Prepared email','deb_prepared_clear')){
    Write-Output ($m + " => " + ([regex]::Matches($c,[regex]::Escape($m))).Count)
  }
}catch{ Write-Output ("INDEX ERR: " + $_.Exception.Message) }
Remove-Item _verify.ps1 -ErrorAction SilentlyContinue
