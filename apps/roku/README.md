# Roku client

This is a generic developer-sideloadable SceneGraph channel. The ZIP root must contain `manifest`, `source/`, and `components/`; no backend address, credentials, provider credentials, or administrator key is embedded.

From the repository root run `npm run check` to statically check BrightScript, and `npm run package:roku` to create the ZIP. Use Roku developer mode's browser installer to upload it. Target Roku OS 12.5 or later; this package uses SceneGraph 1.2 for sideload compatibility. Streaming Store certification/publishing is a separate workflow.

In Settings, enter the reachable backend origin using the native keyboard, then enter the **Roku device token returned by administrator enrollment**. Registry storage preserves both across launches. Changing the origin preserves a stored token; Forget clears both. Use Create phone pairing code to connect phones, and Manage paired phones to revoke access. The administrator key is never entered in this app.

The left menu contains Continue Watching, Favorites, Live, Movies, Series, Search, and Settings. Live/Movies/Series first show categories including All titles. Catalog pages have Previous/Next rows. Search uses the native keyboard and all top-level media types. Select a series, choose a season, then an episode. On a title, use Play / Resume or Start over; `*` toggles its favorite state. Back returns through details, episodes/seasons, categories, and menu. While playing, Roku's native player handles Play/Pause, seek, and captions; Back stops playback. Use the phone to search/select English subtitles and adjust timing. Backend PNGs render catalog titles, categories, and title/description details, including mixed Arabic text.

All API transfers and registry access run on a Task. Commands poll every two seconds; online status posts every ten seconds and progress every fifteen seconds plus state changes. Playback uses Roku's native Video node and direct streams, with external SRT caption tracks. Subtitle changes reload the stream at the actual current position and preserve pause. A play command is acknowledged after the player reaches `playing`; error or a 25-second startup timeout fails it. HTTP acknowledgement failures retry with backoff without replaying the command. Expired commands and mismatched playback sessions are rejected locally as well as by the backend.

Details open immediately from cached catalog data and enrich in the background. Back cancels pending startup; leaving playback restores the visible catalog and refreshes Continue Watching. Progress writes serialize the newest sample, retain the final sample after exit, and retry transient failures up to five times with bounded backoff. Session changes discard obsolete samples. Wire JSON explicitly preserves `contentId` and `sessionId` casing; BrightScript's unquoted associative-array keys otherwise become lowercase. Debug output uses safe stage names, HTTP codes, and player states without media titles, URLs, or credentials.

## Device verification

BrightScript static checking does not emulate Roku hardware. Before using a provider in production, sideload and verify:

- Setup survives relaunch; changing origin preserves token; Forget removes setup.
- English and Arabic/mixed title PNGs load, descriptions are readable, category/page navigation works, and favorites persist.
- Pair a phone, start/pause/resume/seek/stop, then revoke it and confirm access is rejected.
- Resume/start over, finish an episode, inspect Continue Watching and its next episode.
- Select and disable an English SRT, adjust offset, and confirm reload position and pause preservation.
- Send repeated controls, switch titles while buffering, unplug network, and use an expired command or incompatible stream.

Container and codec support depends on the specific Roku model. This channel maps MOV/M4V to MP4, M3U8 to HLS, MPD to DASH, and accepts MP4/HLS/DASH/ISM/MKV. Other containers fail with an explicit message. It does not transcode streams. Embedded subtitle rendering and Arabic SRT glyph support depend on Roku firmware; catalog/detail Arabic text uses server PNG rendering. Signed artwork URLs expire: reopening a catalog/details view obtains fresh URLs. Local development HTTPS certificates must be trusted by Roku; HTTP LAN origins are supported for development.
