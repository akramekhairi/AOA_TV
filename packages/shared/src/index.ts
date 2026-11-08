export type MediaType = 'live' | 'movie' | 'series' | 'episode';
export interface ContentItem {
  id: string; providerId: string; type: MediaType; title: string;
  categoryId?: string; poster?: string; description?: string; year?: number;
  seriesId?: string; season?: number; episode?: number; extension?: string;
  imdbId?: string; tmdbId?: string; titleImage?: string; descriptionImage?: string;
}
export interface Category { id: string; title: string; type: MediaType; titleImage?: string }
export interface CatalogPage { items: ContentItem[]; total: number; page: number; pageSize: number }
export interface Progress { contentId: string; position: number; duration: number; completed: boolean; updatedAt: string; item?: ContentItem }
export interface TvStatus { online: boolean; state: string; contentId?: string; position?: number; duration?: number; sessionId?: string; updatedAt?: string }
export type CommandAction = 'play' | 'pause' | 'resume' | 'stop' | 'seek' | 'subtitles';
export interface PlaybackCommand { id: string; action: CommandAction; contentId?: string; position?: number; subtitleId?: string | null; offset?: number; sessionId: string; expiresAt: string; status: 'pending' | 'acknowledged' | 'failed' | 'expired'; error?: string }
export interface Playback { item: ContentItem; url: string; streamFormat: string; position: number; sessionId: string; subtitleUrl?: string; warning?: string }
export interface SubtitleResult { id: string; label: string; language: string; score: number; strongMatch: boolean; downloadCount?: number }
export interface Device { id: string; name: string; kind: 'phone' | 'roku'; createdAt: string }
export interface PairingDisplay { id: string; code: string; expiresAt: string }
export interface RokuPollResponse { commands: PlaybackCommand[]; pairingDisplay?: PairingDisplay }
export interface PairingRequestResponse { status: 'pending'; expiresAt: string; reused: boolean; retryAfterSeconds: number }
export const normalizeSearch = (value: string) => value.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').toLocaleLowerCase().trim();
