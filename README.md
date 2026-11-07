# AOA_TV

A household Roku IPTV player with legible Arabic titles and a phone web controller. One shared profile, favorites, Continue Watching, and optional English subtitles for movies and episodes.

**Open AOA_TV on the Roku first.** A paired phone sends playback requests through the backend; Roku streams directly from your provider. The phone does not cast video or need to remain open after playback begins.

## Components

| Component | Technology | Hosting |
| --- | --- | --- |
| Phone app | React, TypeScript, Vite, installable PWA | GitHub Pages |
| API and Arabic text rendering | Fastify, Sharp/Pango | Render Free |
| Persistent data and private assets | Postgres and Storage | Supabase Free |
| Television app | BrightScript and SceneGraph | Roku developer sideload |

Public code does not contain IPTV credentials, stream URLs, catalog dumps, or viewing history. These belong in private backend configuration and Supabase. No video proxy, transcoding, recording, or phone playback is included.

## Development

Install Node.js 22 or newer, then run from the repository root:

```sh
npm ci
npm run check
npm test
npm run build
npm run package:roku
```

On Windows PowerShell, use `npm.cmd` if script execution policy prevents `npm` from running.

Run the backend and frontend in separate terminals using `npm run dev` and `npm run dev:web`. Configure the backend using its `.env.example`; demo mode must be explicitly enabled and uses fictional content with temporary state. The phone app's Settings accepts the backend URL, so a locally configured endpoint does not need to be committed.

See [Setup](docs/SETUP.md), [API contract](docs/API.md), and [Acceptance checklist](docs/ACCEPTANCE.md).

## Daily use

1. Open AOA_TV on the TV.
2. Open the phone app and pair once with the code shown in Roku Settings.
3. Search Arabic or English, select a movie/channel/episode, and tap **Play on TV**.
4. Use **English subtitles** on a movie or episode to search, select, disable, or adjust timing.

Everyone shares favorites and progress. Paired phones remain authorized even away from home; revoke unwanted phones from Roku Settings. Videos must be in a format your Roku supports. Subtitle availability and synchronization depend on the provider's release and OpenSubtitles results.

## Free hosting limitations

The configuration selects free services and requires no paid plan. Render sleeps after inactivity and may need about a minute to wake. Supabase may pause an inactive project; resume it in the dashboard. Quota exhaustion can stop features until capacity resets. Do not add billing methods or select paid instances to follow this project's no-charge deployment plan.

No uptime guarantee is implied. Keep exported backups of important viewing history; do not depend on free hosting as the sole copy of important data.

## Status

Build and automated verification results are recorded in [Acceptance](docs/ACCEPTANCE.md). Real IPTV, Roku hardware, iPhone, Android, and hosted deployment checks must be completed against the actual configured services; simulated tests are not substitutes.
