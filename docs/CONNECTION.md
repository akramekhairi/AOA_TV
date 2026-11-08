# Connection and hosting

Render coordinates pairing, catalog search, playback commands, shared favorites/progress, Arabic title images, and subtitles. Video streams directly from the provider to Roku.

Keep AOA TV open on Roku to receive phone commands. Roku polls every two seconds, including during playback. Successful polls prove presence independently of playback session reports. Phones keep pairing through temporary failures and recheck immediately when returning to the foreground or reconnecting to a network.

The GitHub Actions health workflow requests the backend every ten minutes to reduce free-service cold starts. This is best effort: scheduled jobs may be delayed, and GitHub disables schedules in public repositories after 60 days without repository activity. Free hosting cannot guarantee instant availability. Run the workflow manually or open the backend health endpoint to wake it when needed. No paid plan is required.

Validation: automated reconnection, token retention, stale-session presence, and retry tests pass. Android/iPhone background-resume behavior and Arabic playback overlays still require household device testing.
