# Acceptance checklist

This separates automated checks from tests requiring actual hardware/accounts. Unchecked items are not claimed as verified.

## Automated/local

- [x] TypeScript and BrightScript static checks pass.
- [x] Backend and web tests pass.
- [x] Production web build and generic Roku ZIP build successfully.
- [ ] Phone browser demo pairs, browses, favorites, and submits commands.
- [x] Arabic PNG renderer produces joined letters for the inspected Arabic demo title; mixed-direction hardware cases remain below.
- [x] Public source and generic ZIP contain no private configuration; staged secret scan passed.

## Configured service integration

- [x] GitHub repository and Pages deployment are live.
- [x] Render uses Free and reports production health.
- [ ] Supabase migrations/private Storage work; state survives API restart.
- [x] Provider catalog requests succeed from Render.
- [x] Real movie metadata produced69English results with a strong identity match; downloaded SRT returned HTTP 200. Episode matching is covered by automated fixtures; real episode match remains unverified.
- [ ] Cold starts, subtitle quota failures, and service interruptions display clear states.

## Roku hardware

The developer installer reported success and ECP reported AOA TV as the active app on the user's Roku. This confirms installation and launch, not playback or visual correctness.

- [ ] Native remote can browse categories, multiple pages, favorites, series, episodes, and English search.
- [ ] Arabic category names, titles, details, and playback overlays are legible at TV distance.
- [ ] Actual live channel, movie, and episode play with audio.
- [x] English external subtitles display (user visually confirmed); offset changes preserve playback position.
- [x] Movie pause/stop saves progress; native resume starts five seconds before saved position.
- [ ] Completed episodes offer the next episode; live channels never appear in Continue Watching.
- [ ] Two phone commands do not replay stale content or corrupt progress.
- [ ] Closing/reopening the app does not execute an expired command.

## Phones

- [ ] Android Chrome: install, pair, Arabic search, favorites, Play on TV, subtitles.
- [ ] iPhone Safari: Add to Home Screen and the same household flow.
- [ ] Revoking a phone immediately denies its next authenticated request.
- [ ] Shared favorites/progress agree on two phones and Roku.

## Repair verification, 2026-11-08

- Roku build 5 installed with existing pairing retained; custom playback title overlay removed.
- Native Movies ? category ? movie ? Play successfully reached playing; remote Pause reported 22 seconds / 5590 seconds. Progress saved and Continue Watching grew from two to three entries.
- Confirmed selection freeze root cause: invalid integer ToStr(16) invocation in URI encoder; replaced and retested on TV.
- Confirmed protocol bug: unquoted BrightScript camelCase JSON keys; exact-case keys now used for native commands, heartbeat, and progress.
- Hosted movie and series artwork returned HTTP 200; user confirmed phone images work. Some live logo sources may still fail.
- Hosted Latin title image and on-TV movie details render without glyph boxes. Automated mixed Arabic/Latin/symbol font coverage passed; full mixed-language hardware matrix remains unverified.
- 26 automated tests pass, including separate artwork/device rate budgets, protected pairing limits, subtitle matching/quota handling, and server Retry-After cooldown.
- OpenSubtitles credentials configured privately and verified:69English results, strong match, cached SRT HTTP 200. Roku build7 confirms the requested external track is current, mode On, captions not suppressed. Subtitle timing reload preserved pause and native position90seconds. User visually confirmed English captions on the actual TV. Off was verified with mode Off; restoring the selection returned the external track to current with mode On.
- Native series ? season ? episode ? Play reached playing; Pause saved 24 seconds / 1420 seconds and added a fourth Continue Watching entry. Native movie resume began at17seconds from saved22seconds. Remote focus remained responsive after Back.
- Native Live TV reached playing; Continue Watching count stayed4, excluding the channel.
- Android/iPhone full acceptance matrix and actual audio quality checks remain unverified.

## Azure cutover and pairing, 2026-11-08

- Student VM: North Central US B2ats v2, one 64 GB P6 SSD, HTTPS through Caddy. Spending protection remains On; monthly $6 and first-year $80 alert budgets configured. Forecast $44.80 of $100 student credit using account-confirmed first-year allowances.
- Controlled VM restart: Docker/app/Caddy recovered automatically; public readiness HTTP 200 in 661 ms.
- Idle validation: no user app traffic from22:52:28 UTC through 23:23:09 UTC (30 minutes 41 seconds); local readiness HTTP 200 in 0.961 seconds. Subsequent public health/readiness returned HTTP 200 in 212 ms / 661 ms.
- Startup collection latency fixed by singleflight persisted catalog loading; stale catalogs serve immediately while refreshing behind the scenes. Signed images use stable 15-minute signing buckets, preventing every phone poll from reloading unchanged images.
- Azure catalog: 26,421 movies; categories, Arabic/mixed English-Arabic PNG, title image, and poster returned HTTP 200. After warmup, catalog/categories completed in 53 ms / 56 ms.
- Provider auth from Azure succeeded; live/movie/series category queries returned 77 / 32 / 37 categories.
- Roku build9 migrated the recognized saved Render origin once, preserving its token. Existing custom origins and later manual rollback are retained.
- Existing favorites(3), visible Continue Watching(1), hidden items, device credentials and subtitle settings remain in the same Supabase database. Test playback restored the previously hidden test title to hidden afterward.
- Actual Azure playback resumed at the saved position; English SRT HTTP 200 and native external-track current=true. During video, anonymous phone request showed the TV code; a temporary phone claimed it, the panel cleared, playback session was unchanged, and the test phone was revoked.
- Phone API address controls removed; name empty with a placeholder, explicit name required, TV-code request cooldown supported. Existing token migration and trusted rollback pass automated tests.
- 51 automated tests pass (26 server / 25 web), plus TypeScript/BrightScript, production build, generic Roku ZIP and public secret scans.
- Pages now targets Azure; Render suspended and scheduled keep-alive disabled. Full physical Android/iPhone acceptance matrix remains unverified.
