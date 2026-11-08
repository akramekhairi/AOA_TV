import {normalizeSearch, type ContentItem} from '@aoa/shared';

export type CollectionType = '' | 'movie' | 'series' | 'live';

/** Keep collection order while searching titles and grouping episodes with series. */
export function filterCollection(items: ContentItem[], query: string, type: CollectionType): ContentItem[] {
  const search = normalizeSearch(query);
  return items.filter(item =>
    (!type || item.type === type || (type === 'series' && item.type === 'episode')) &&
    (!search || normalizeSearch(item.title).includes(search))
  );
}
