Set-Location "C:\Users\charl\cttlfa-website"
git pull --rebase --autostash
git add -A
git commit -F "_cc_msg.txt"
git push
Write-Output "DEPLOY_DONE"
