# CTTLFA preview — wire it into Netlify so it auto-updates

This repo is the full preview site. Once it is on GitHub and Netlify is linked to
it, the site keeps itself current: an hourly job pulls the latest leagues **and**
knockout cups from the league system and Netlify republishes automatically. No
manual redeploys.

## What is in here
```
index.html                                   the site (password-gated preview, no-index)
season.json                                  live data: leagues + all 54 knockout cups + crests
photos/                                       gallery images + locally-hosted club badges (photos/crests)
netlify.toml                                  Netlify config (publish the repo root, no build step)
lr_sync.py                                    pulls the league system -> season.json + badges
.github/workflows/leaguerepublic-sync.yml     the hourly sync (commits only when data changes)
```

## One-time setup (about 15 minutes)

### 1. Put this folder on GitHub
- Create a new repository (private is fine for the preview).
- Upload everything in this folder, keeping the structure (or push it with git).

### 2. Turn the sync on
- In the repo: **Settings → Actions → General**.
- Under **Workflow permissions**, choose **Read and write permissions**, save.
- Open the **Actions** tab, pick **LeagueRepublic sync**, and click **Run workflow**
  once to confirm it works. It should finish green and commit an updated
  `season.json` if anything changed.

### 3. Link Netlify to the repo
- In Netlify, open the existing preview site (cttlfa.netlify.app):
  **Site configuration → Build & deploy → Continuous deployment → Link repository**,
  and choose this GitHub repo. (Or create a new site with **Add new site → Import
  an existing project** and pick the repo.)
- Build command: leave empty. Publish directory: `.` (already set in netlify.toml).
- Deploy. From now on, every commit — including the hourly data commits — republishes
  the site on its own.

## How the auto-update works
- The hourly job runs `lr_sync.py`, which reads the current fixtures, results, logs
  and cup rounds and writes `season.json` (and downloads any new club badges).
- It commits only when the data has actually changed, so the site rebuilds a few
  times a day rather than every hour for nothing.
- The browser loads `season.json` from the site, so the Match Centre, Junior
  Combined Logs, the live newsroom and the Knockout Cups are all current without
  anyone touching the site.

## The preview password
`index.html` is gated for review and set not to appear in search results. The
access password is **cttlfaweb2026**. When it goes fully public, we remove the gate.

## Cadence note
The sync is set to hourly to stay inside GitHub's free Actions minutes on a private
repo. On the public production repo (GitHub Actions are unlimited for public repos)
we can tighten it to every 20 minutes — change the `cron` line in the workflow.
