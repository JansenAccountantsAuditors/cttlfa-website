$ErrorActionPreference='Stop'
Set-Location $env:USERPROFILE\cttlfa-website
git add admin.cttfa.co.za/index.html
$msg = @"
Registrations: season-pair cycle labels + team entrants by club

- Cycle now labelled by its two football-season years (2023/24, 2025/26, next
  2027/28) on the admin Registrations page and the club portal (portal RPCs).
- New reg_club_teams map (current-season teams per club, from the live standings,
  mapped to registration club names the same way as the public site) + admin RPC
  reg_club_teams_current(); "Registered members by club" now shows Teams entered
  and Members/team, with CSV/PDF. Clubs with members but 0 teams (e.g. clubs that
  have left) are flagged; registrations do not track team entries.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LYzdhwyUpPCdjfCMzczULX
"@
git commit -m $msg
git pull --rebase origin main
git push origin main
git log --oneline -1
