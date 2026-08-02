import type { Criteria, Privacy, VideoCandidate } from './types';

const CRITERIA_KEY = 'ypg.criteria';
const CHANNELS_KEY = 'ypg.channels';
const SESSION_KEY = 'ypg.session';
const PENDING_CREATE_KEY = 'ypg.pendingCreate';

export const DEFAULT_CRITERIA: Criteria = {
  order: 'viewCount',
  publishedAfter: '',
  publishedBefore: '',
  poolPerChannel: 25,
  playlistSize: 20,
  minViews: 0,
  excludeShorts: true,
};

export function loadCriteria(): Criteria {
  try {
    const raw = localStorage.getItem(CRITERIA_KEY);
    if (!raw) return DEFAULT_CRITERIA;
    return { ...DEFAULT_CRITERIA, ...(JSON.parse(raw) as Partial<Criteria>) };
  } catch {
    return DEFAULT_CRITERIA;
  }
}

export function saveCriteria(criteria: Criteria): void {
  localStorage.setItem(CRITERIA_KEY, JSON.stringify(criteria));
}

export function loadChannels(): string {
  return localStorage.getItem(CHANNELS_KEY) ?? '';
}

export function saveChannels(text: string): void {
  localStorage.setItem(CHANNELS_KEY, text);
}

export function pickRandom<T>(pool: T[], size: number): T[] {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(1, size));
}

// Working state persisted across the OAuth redirect (survives the round trip to
// Google in the same tab via sessionStorage).
export interface WorkingState {
  pool: VideoCandidate[];
  videos: VideoCandidate[];
  title: string;
  description: string;
  privacy: Privacy;
}

export function loadWorkingState(): WorkingState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as WorkingState) : null;
  } catch {
    return null;
  }
}

export function saveWorkingState(state: WorkingState): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

export function setPendingCreate(pending: boolean): void {
  if (pending) sessionStorage.setItem(PENDING_CREATE_KEY, '1');
  else sessionStorage.removeItem(PENDING_CREATE_KEY);
}

export function consumePendingCreate(): boolean {
  const pending = sessionStorage.getItem(PENDING_CREATE_KEY) === '1';
  sessionStorage.removeItem(PENDING_CREATE_KEY);
  return pending;
}
