# Dates and Themes

## Local Import

The first launch reads `~/Library/Application Support/mac-ddl-count/tracker.json` and imports its saved deadlines into the workspace's `trackedDeadlines` array. The original app's files remain unchanged. A workspace backup precedes the migration. This machine's tracker contained 91 dates: 42 paper, 20 funding, 5 award, 12 service and 12 other entries.

Each entry retains its exact UTC instant, label, subtitle, notes, completion status and source identity. Multiple entries for different papers in the same conference round remain separate. Import Mac dates adds newly created source entries without duplicating existing IDs. Deleting an imported date persists across restarts because the first-launch migration runs once.

Standalone dates do not create placeholder research projects. A date may be linked to a project through its editor. Existing project milestones remain available in a separate tab.

## CCF Feed

The feed reads the public [CCF Deadlines repository](https://github.com/ccfddl/ccf-deadlines), which also powers [CCF Deadlines](https://ccfddl.com/). It fetches the conference index and YAML files, retains original round indices, and caches parsed data by file SHA. The UI supports search, area filtering, individual deadline tracking and adding all upcoming dates for a conference. The source's last successful refresh appears on screen; errors preserve cached data and retain the previous successful timestamp.

The application refreshes at startup and every six hours while running. Refresh feed checks immediately. Changed tracked dates appear as proposals with the previous and current time. Applying a proposal changes its date and source metadata while retaining the personal label, notes, status and project link. Dates never change silently.

AoE maps to UTC−12. UTC offsets and IANA zones resolve to exact UTC instants; unsupported zones and unannounced dates remain untracked. The UI shows both original timezone and local time. Countdown badges use exact instants rather than calendar-day estimates.

## The Web Conference

The initial setup adds WWW 2027 Research & Industry track dates from the [official important dates](https://www2027.thewebconf.org/important-dates/) and [research CFP](https://www2027.thewebconf.org/research-track-papers/), checked October 9, 2026:

| Kind | AoE Deadline | Hong Kong Time |
| --- | --- | --- |
| Abstract | October 18, 2026, 23:59 | October 19, 2026, 19:59 |
| Paper | October 25, 2026, 23:59 | October 26, 2026, 19:59 |
| Decision | January 4, 2027, 23:59 | January 5, 2027, 19:59 |
| Camera-ready | January 31, 2027, 23:59 | February 1, 2027, 19:59 |

The records use end-of-minute seconds for end-of-day deadlines. A difference of less than one minute between such records and a source's minute-only time does not create an update proposal.

## Appearance

Light, Dark and System preferences persist in the workspace. The header offers a quick light/dark switch. Semantic colors distinguish paper, funding, award, service, abstract, submission and urgency. The dark theme applies to workspace chrome, cards, dialogs, CodeMirror, terminal colors and the native window background. Switching theme updates the terminal without restarting its shell session.

## Verification

`npm test` covers timezone conversion, source identity, duplicate-safe imports, preservation of user edits, update acceptance, first-launch setup and cached feed behavior during outages. `npm run test:deadlines` launches an isolated Electron workspace to check this machine's Mac import, conference tracking, date edits, dark editor/terminal and restart persistence. It reads the Mac tracker and writes only temporary test workspace files. A live feed check retrieved 374 conferences on October 9, 2026.
