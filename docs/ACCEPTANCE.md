# Acceptance checklist

This separates automated checks from tests requiring actual hardware/accounts. Unchecked items are not claimed as verified.

## Automated/local

- [x] TypeScript and BrightScript static checks pass.
- [x] Backend and web tests pass.
- [x] Production web build and generic Roku ZIP build successfully.
- [ ] Phone browser demo pairs, browses, favorites, and submits commands.
- [x] Arabic PNG renderer produces joined letters for the inspected Arabic demo title; mixed-direction hardware cases remain below.
- [ ] Public files and ZIP contain no private configuration.

## Configured service integration

- [ ] GitHub repository and Pages deployment are live.
- [ ] Render uses Free and reports production health.
- [ ] Supabase migrations/private Storage work; state survives API restart.
- [ ] Provider catalog requests succeed from Render.
- [ ] Real movie/episode metadata produces useful subtitle matches.
- [ ] Cold starts, subtitle quota failures, and service interruptions display clear states.

## Roku hardware

The developer installer reported success and ECP reported AOA TV as the active app on the user's Roku. This confirms installation and launch, not playback or visual correctness.

- [ ] Native remote can browse categories, multiple pages, favorites, series, episodes, and English search.
- [ ] Arabic category names, titles, details, and playback overlays are legible at TV distance.
- [ ] Actual live channel, movie, and episode play with audio.
- [ ] English external subtitles display; offset changes preserve playback position.
- [ ] Pause/stop saves progress; resume starts slightly before saved position.
- [ ] Completed episodes offer the next episode; live channels never appear in Continue Watching.
- [ ] Two phone commands do not replay stale content or corrupt progress.
- [ ] Closing/reopening the app does not execute an expired command.

## Phones

- [ ] Android Chrome: install, pair, Arabic search, favorites, Play on TV, subtitles.
- [ ] iPhone Safari: Add to Home Screen and the same household flow.
- [ ] Revoking a phone immediately denies its next authenticated request.
- [ ] Shared favorites/progress agree on two phones and Roku.
