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
- [x] Real movie metadata produced69English results with a strong identity match; downloaded SRT returned HTTP200. Episode matching is covered by automated fixtures; real episode match remains unverified.
- [ ] Cold starts, subtitle quota failures, and service interruptions display clear states.

## Roku hardware

The developer installer reported success and ECP reported AOA TV as the active app on the user's Roku. This confirms installation and launch, not playback or visual correctness.

- [ ] Native remote can browse categories, multiple pages, favorites, series, episodes, and English search.
- [ ] Arabic category names, titles, details, and playback overlays are legible at TV distance.
- [ ] Actual live channel, movie, and episode play with audio.
- [ ] English external subtitles display; offset changes preserve playback position.
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
- OpenSubtitles credentials configured privately and verified:69English results, strong match, cached SRT HTTP200. Roku build7 confirms the requested external track is current, mode On, captions not suppressed. Subtitle timing reload preserved pause and native position90seconds. Visible caption confirmation is pending household observation.
- Native series ? season ? episode ? Play reached playing; Pause saved24seconds/1420seconds and added a fourth Continue Watching entry. Native movie resume began at17seconds from saved22seconds. Remote focus remained responsive after Back.
- Native Live TV reached playing; Continue Watching count stayed4, excluding the channel.
- Android/iPhone full acceptance matrix and actual audio quality checks remain unverified.
