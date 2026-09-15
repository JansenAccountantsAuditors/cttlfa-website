$ErrorActionPreference='Stop'
Set-Location $env:USERPROFILE\cttlfa-website
git add admin.cttfa.co.za/index.html
$msg = @"
Admin Registrations: team entrants vs registrations overlay

- New reg_team_entrants table (2022-2026 teams entered, from LeagueRepublic
  fixtures + live season standings) and admin-only reg_team_entrants_overlay()
  RPC combining it live with unique carded players per Nov-Oct season.
- Registrations tab: overlay card comparing teams entered vs registered players
  by season (twin bars + table + CSV), showing registrations track the two-year
  SAFA card cycle, not team-entry growth.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LYzdhwyUpPCdjfCMzczULX
"@
git commit -m $msg
Write-Output '--- pull --rebase ---'
git pull --rebase origin main
Write-Output '--- push ---'
git push origin main
git log --oneline -1
