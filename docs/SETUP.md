# Setup

## 1. Keep credentials private

Create a root `.env` from the server example. It is ignored by Git. Never put IPTV credentials in a Vite environment variable: `VITE_*` values are public browser configuration. Only the public API origin belongs in `VITE_API_URL`.

Store hosted credentials privately on the Azure VM under /opt/aoa-tv/app.env; see [Azure deployment](AZURE.md). Keep `.local/` private. Do not attach screenshots containing tokens, provider URLs, or setup files to public issues.

## 2. Supabase Free

Create a free Supabase project without adding a billing method. Run the migration in `supabase/` through the SQL editor. Follow the server README for the private storage bucket and required secret values. The backend uses the service role key; the phone and Roku apps must never receive that key. Keep the existing Supabase project when changing compute hosts.

Supabase contains persistent catalog data, device authorization, favorites, progress, commands, and cached assets. Compute-host filesystems are not used as the durable household database.

## 3. Azure for Students (primary) and Render rollback

Follow [Azure deployment](AZURE.md) for the primary continuously running VM. The following Render instructions are retained for rollback.

Connect the public AOA_TV repository. Use its `render.yaml` blueprint or create a Docker web service using the server Dockerfile with the repository root as build context. Select **Free** and configure all production secrets from the server example. Set `DEMO_MODE=false`, the public Render URL, and the GitHub Pages origin. Do not use Render's expiring free Postgres database; persistence uses Supabase.

Verify `/health` reports a healthy production service. Check catalog access from the hosted backend: some IPTV providers reject data-center requests. If this fails, fix provider compatibility before proceeding with a household deployment.

## 4. GitHub Pages

Repository Settings → Pages → Source: **GitHub Actions**. Set repository Actions variable `VITE_API_URL` to the active public Azure HTTPS origin. Run **Deploy phone app**. The intended URL is `https://akramekhairi.github.io/AOA_TV/`.

The phone selects the API origin from deployment configuration; users never enter an address. The published files are a static UI; no secret or private catalog is deployed to Pages.

## 5. Enroll and install Roku

Enable developer mode on the TV using Roku's documented remote sequence: Home three times, Up twice, Right, Left, Right, Left, Right. Record its local IP and choose a developer password. This allows one sideloaded app at a time.

Build `dist/AOA_TV.zip` with `npm run package:roku`. Visit the Roku's local IP in a browser, sign in as `rokudev`, and upload that ZIP through the development installer. The ZIP contains no private settings.

Alternatively, set `ROKU_HOST` (IP address only) and `ROKU_DEV_PASSWORD` in your private `.env`, then run `npm run sideload:roku`. The script sends the developer password to your Roku using digest authentication without putting it in command-line arguments or logs.

Set `PUBLIC_URL` and `ADMIN_KEY` in your private root `.env`, then run:

```sh
node scripts/enroll-roku.mjs
```

This writes `.local/roku-enrollment.json` without printing credentials. Enter its backend URL and device token in the Roku app's setup. The admin key belongs only on the server/setup machine, not on the TV. Keep the generated token private. A future convenience setup method may replace manual token entry; the first version prioritizes a generic package without embedded credentials.

Open Roku Settings to create a phone pairing code. Enter that code in the phone web app. Codes expire; request another if needed. Pair each household phone separately.

## 6. Subtitles

Create an OpenSubtitles.com account and API application key. Configure backend secrets according to its environment example. Subtitle searches are English-only for films and episodes. Download quotas are account-dependent; the app must report exhaustion and allow playback without subtitles.

## 7. Add the phone app to the home screen

- Android Chrome: open the Pages URL, then use **Install app** or **Add to Home screen** from the menu.
- iPhone Safari: open the Pages URL, tap **Share**, then **Add to Home Screen**.

The service worker caches the interface only. Authentication, catalog, playback, and subtitle operations require network access.

## Updates and recovery

- Push code to main for CI and public container builds. Deploy the immutable container digest to Azure using the setup guide; Pages uses its own workflow.
- Download the Roku ZIP from the validation workflow and sideload it. Keep the same app registry and device credentials when possible; pair again if registry data was reset.
- Azure does not sleep from inactivity. Check /health and /ready for process versus database status. If Supabase was paused, resume the project in its dashboard.
- Inspect sanitized server logs and `/health`; never log full provider requests or device tokens.
- Free quota errors should be resolved by reducing usage or waiting for reset, not by automatically upgrading.
