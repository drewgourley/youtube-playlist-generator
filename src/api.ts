import type { Criteria, VideoCandidate, Privacy } from './types';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

export interface AuthStatus {
  signedIn: boolean;
  channelTitle: string | null;
}

export function getAuthStatus(): Promise<AuthStatus> {
  return jsonFetch<AuthStatus>('/api/auth/status');
}

export function login(): void {
  window.location.href = '/api/auth/login';
}

export function logout(): Promise<{ ok: boolean }> {
  return jsonFetch('/api/auth/logout', { method: 'POST' });
}

export async function generate(channels: string[], criteria: Criteria): Promise<VideoCandidate[]> {
  const data = await jsonFetch<{ videos: VideoCandidate[] }>('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ channels, criteria }),
  });
  return data.videos;
}

export interface PlaylistMeta {
  title: string;
  description: string;
  privacy: Privacy;
}

export interface PublishResult {
  url: string;
  added: number;
  failed: number;
}

export function publish(videoIds: string[], meta: PlaylistMeta): Promise<PublishResult> {
  return jsonFetch<PublishResult>('/api/playlists', {
    method: 'POST',
    body: JSON.stringify({ videoIds, meta }),
  });
}
