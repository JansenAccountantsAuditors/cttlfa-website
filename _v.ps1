Start-Sleep -Seconds 40
$cb=Get-Random
$r=Invoke-WebRequest -Uri ("https://admin.cttfa.co.za/index.html?cb="+$cb) -UseBasicParsing -Headers @{'Cache-Control'='no-cache'}
$c=$r.Content
foreach($m in @('body.pdf_url=customAtt.url','customAtt={url:prep.att_url')){
  Write-Output ($m + " => " + ([regex]::Matches($c,[regex]::Escape($m))).Count)
}
Remove-Item _v.ps1 -ErrorAction SilentlyContinue
