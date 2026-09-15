$ErrorActionPreference='Stop'
Set-Location $env:USERPROFILE\cttlfa-website
git add club.cttfa.co.za/index.html
$msg = @"
Club portal: 2-year registration cycle, member ID/SAFA/club columns, detailed help page

- portal_members / portal_registrations rebuilt on the SAFA two-year card cycle
  (even-year November window) with category backfill + foreign flag, matching the
  Admin Centre exactly; club-scoped via _portal_register().
- Members tab: cycle selector, Seniors/Juniors/Foreign tiles, and Name, Category,
  SAFA number, ID number, Club, Type columns; search + CSV include all fields.
  POPIA-aware note; club sees only its own roll.
- New Help tab: full walkthrough of every page, plus contextual '?' hover tips
  (same mechanism as the Admin Centre) toggled from the header.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LYzdhwyUpPCdjfCMzczULX
"@
git commit -m $msg
Write-Output '--- pull --rebase ---'
git pull --rebase origin main
Write-Output '--- push ---'
git push origin main
Write-Output '--- head ---'
git log --oneline -1
