# API v1 contract

Base `/api/v1`. JSON requests/responses; authenticated requests use `Authorization: Bearer <device token>`. Errors `{error:string}`. Phones never receive provider stream URLs. All times ISO UTC, positions in seconds. Content IDs `xtream:<live|movie|series|episode>:<provider ID>`. Query strings must be URL encoded.

## Enrollment and pairing
- POST `/admin/enroll` header `X-Admin-Key`, body `{name}` → `{token,device}` for Roku. Admin key comes from private environment. Roku settings accepts the returned token, never the admin key.
- POST `/pairing/code` Roku only → `{code,expiresAt}` (5 minutes).
- POST `/pairing/claim` public body `{code,name}` → `{token,device}`.
- GET `/devices` → `{devices:Device[]}`; DELETE `/devices/:id` revokes phone; Roku only.

## Catalog
- GET `/catalog?type=live|movie|series&q=&categoryId=&page=1&pageSize=30` → CatalogPage; omitted type searches all top-level types.
- GET `/categories?type=live|movie|series` → `{categories:Category[]}`.
- GET `/content/:id` → ContentItem.
- GET `/series/:id/episodes` → `{items:ContentItem[]}`.
- POST `/catalog/refresh` → `{ok:true}`.
- GET `/favorites` → `{items:ContentItem[]}`; PUT `/favorites/:id` and DELETE `/favorites/:id` → `{ok:true}`.
- GET `/progress` → `{items:Progress[]}` (in-progress and next episodes).

## Playback and status
- GET `/tv/status` → TvStatus.
- POST `/commands` body `{action,contentId?,position?,subtitleId?,offset?}` → PlaybackCommand. Omit position for resume, use 0 for start over. Server allocates session ID for play; other commands bind current session.
- GET `/commands/:id` → PlaybackCommand.
- GET `/roku/commands` Roku only → `{commands:PlaybackCommand[]}` pending unexpired commands, in order.
- POST `/roku/commands/:id/ack` Roku only body `{status:'acknowledged'|'failed',error?}` → `{ok:true}`.
- GET `/roku/playback/:commandId` Roku only → Playback (resolves play/subtitles command).
- POST `/roku/status` Roku only body TvStatus → `{ok:true}` heartbeat every 10 sec, online threshold 30 sec.
- PUT `/roku/progress` Roku only body `{contentId,position,duration,completed,sessionId}` → `{ok:true}`; stale sessions rejected; every 15sec and state changes.

## Subtitles
- GET `/subtitles/search?contentId=&query=` → `{results:SubtitleResult[],suggestedId?:string}`; only movies/episodes.
- POST `/subtitles/select` body `{contentId,subtitleId:string|null,offset?:number}` → `{ok:true}`. Persists selection; when this item is playing sends subtitles command to reload at current position. No strong match means user must choose a result.
- Image/subtitle asset URLs are signed and expiring, returned by catalog/playback; no auth header required on those URLs.

Health GET `/health` → `{ok:true,demo:boolean}`. Demo mode uses fictional fixtures and in-memory state only; explicit DEMO_MODE=true, never silently falls back from production storage errors.
