export type SortOrder = 'viewCount' | 'date' | 'rating' | 'relevance';

export type Privacy = 'private' | 'unlisted' | 'public';

export interface Criteria {
  /** How the YouTube search ranks candidates before random selection. */
  order: SortOrder;
  /** ISO date (yyyy-mm-dd) lower bound, inclusive. Empty = no bound. */
  publishedAfter: string;
  /** ISO date (yyyy-mm-dd) upper bound, inclusive. Empty = no bound. */
  publishedBefore: string;
  /** Candidates to pull per channel (1-50) before pooling + shuffling. */
  poolPerChannel: number;
  /** Number of videos to place in the final playlist. */
  playlistSize: number;
  /** Drop candidates below this view count. 0 = no minimum. */
  minViews: number;
  /** Drop Shorts (videos <= 60s) from the candidate pool. */
  excludeShorts: boolean;
}

export interface ResolvedChannel {
  id: string;
  title: string;
  /** The original text the user entered. */
  input: string;
}

export interface VideoCandidate {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
  viewCount: number;
  durationSeconds: number;
}
