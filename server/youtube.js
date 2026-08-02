// Server-side YouTube Data API helpers. The API key never leaves the server.
const API_BASE = 'https://www.googleapis.com/youtube/v3';

export class YtApiError extends Error {
  constructor(message, status, reason) {
    super(message);
    this.name = 'YtApiError';
    this.status = status;
    this.reason = reason;
  }
}

async function handleResponse(res) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason;
    const msg = data?.error?.message || res.statusText;
    throw new YtApiError(reason ? `${msg} (${reason})` : msg, res.status, reason);
  }
  return data;
}

async function ytGet(endpoint, params, apiKey) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey);
  return handleResponse(await fetch(url.toString()));
}

async function ytPost(endpoint, params, body, token) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, attempts = 5) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const transient =
        e instanceof YtApiError && (e.status === 409 || e.status === 500 || e.status === 503);
      if (!transient || i === attempts - 1) throw e;
      await sleep(400 * 2 ** i + Math.random() * 200);
    }
  }
  throw lastError;
}

function parseIsoDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

function parseChannelInput(raw) {
  const input = raw.trim();
  const channelMatch = input.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (channelMatch) return { kind: 'id', value: channelMatch[1] };
  const handleUrlMatch = input.match(/youtube\.com\/@([\w.-]+)/i);
  if (handleUrlMatch) return { kind: 'handle', value: handleUrlMatch[1] };
  const userMatch = input.match(/youtube\.com\/user\/([\w-]+)/i);
  if (userMatch) return { kind: 'username', value: userMatch[1] };
  const customMatch = input.match(/youtube\.com\/c\/([\w.-]+)/i);
  if (customMatch) return { kind: 'query', value: customMatch[1] };
  if (/^UC[\w-]{20,}$/.test(input)) return { kind: 'id', value: input };
  if (input.startsWith('@')) return { kind: 'handle', value: input.slice(1) };
  return { kind: 'query', value: input };
}

async function resolveChannel(rawInput, apiKey) {
  const { kind, value } = parseChannelInput(rawInput);

  if (kind === 'id') {
    const data = await ytGet('channels', { part: 'snippet', id: value }, apiKey);
    const item = data.items?.[0];
    if (!item) throw new Error(`Channel not found: ${rawInput}`);
    return { id: item.id, title: item.snippet.title };
  }

  if (kind === 'handle' || kind === 'username') {
    const param = kind === 'handle' ? 'forHandle' : 'forUsername';
    const data = await ytGet('channels', { part: 'snippet', [param]: value }, apiKey);
    const item = data.items?.[0];
    if (item) return { id: item.id, title: item.snippet.title };
  }

  const search = await ytGet(
    'search',
    { part: 'snippet', type: 'channel', q: value, maxResults: '1' },
    apiKey,
  );
  const hit = search.items?.[0];
  if (!hit?.id?.channelId) throw new Error(`Channel not found: ${rawInput}`);
  return { id: hit.id.channelId, title: hit.snippet.channelTitle || value };
}

async function searchChannelVideos(channel, criteria, apiKey) {
  const params = {
    part: 'snippet',
    type: 'video',
    channelId: channel.id,
    order: criteria.order,
    maxResults: String(Math.min(50, Math.max(1, criteria.poolPerChannel))),
  };
  if (criteria.publishedAfter) params.publishedAfter = `${criteria.publishedAfter}T00:00:00Z`;
  if (criteria.publishedBefore) params.publishedBefore = `${criteria.publishedBefore}T23:59:59Z`;

  const data = await ytGet('search', params, apiKey);
  return (data.items ?? [])
    .filter((it) => it.id?.videoId)
    .map((it) => ({
      videoId: it.id.videoId,
      title: it.snippet.title,
      channelId: it.snippet.channelId,
      channelTitle: it.snippet.channelTitle,
      publishedAt: it.snippet.publishedAt,
      thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || '',
      viewCount: 0,
      durationSeconds: 0,
    }));
}

async function attachStats(candidates, apiKey) {
  const byId = new Map(candidates.map((c) => [c.videoId, c]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await ytGet(
      'videos',
      { part: 'statistics,contentDetails', id: chunk.join(',') },
      apiKey,
    );
    for (const item of data.items ?? []) {
      const candidate = byId.get(item.id);
      if (candidate) {
        candidate.viewCount = Number(item.statistics?.viewCount ?? 0);
        candidate.durationSeconds = parseIsoDuration(item.contentDetails?.duration);
      }
    }
  }
  return candidates;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const SHORTS_MAX_SECONDS = 60;

/** Resolves channels, gathers candidates, and returns the filtered pool. */
export async function gatherCandidates(channelInputs, criteria, apiKey) {
  const pool = [];
  const seen = new Set();

  for (const input of channelInputs) {
    const channel = await resolveChannel(input, apiKey);
    const videos = await searchChannelVideos(channel, criteria, apiKey);
    for (const v of videos) {
      if (!seen.has(v.videoId)) {
        seen.add(v.videoId);
        pool.push(v);
      }
    }
  }

  if (pool.length === 0) throw new Error('No videos matched. Try widening the criteria.');

  await attachStats(pool, apiKey);

  let filtered = pool;
  if (criteria.excludeShorts) filtered = filtered.filter((v) => v.durationSeconds > SHORTS_MAX_SECONDS);
  if (criteria.minViews > 0) filtered = filtered.filter((v) => v.viewCount >= criteria.minViews);

  if (filtered.length === 0) throw new Error('No videos matched the criteria. Try widening them.');

  return shuffle(filtered);
}

async function createPlaylist(title, description, privacy, token) {
  const data = await withRetry(() =>
    ytPost(
      'playlists',
      { part: 'snippet,status' },
      { snippet: { title, description }, status: { privacyStatus: privacy } },
      token,
    ),
  );
  return data.id;
}

async function addVideoToPlaylist(playlistId, videoId, token) {
  await withRetry(() =>
    ytPost(
      'playlistItems',
      { part: 'snippet' },
      { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
      token,
    ),
  );
}

/** Creates a playlist on the user's account and appends every video id. */
export async function publishPlaylist(videoIds, meta, token) {
  const playlistId = await createPlaylist(meta.title, meta.description, meta.privacy, token);
  let added = 0;
  let failed = 0;
  for (const videoId of videoIds) {
    try {
      await addVideoToPlaylist(playlistId, videoId, token);
      added++;
    } catch {
      failed++;
    }
    if (added + failed < videoIds.length) await sleep(250);
  }
  return { url: `https://www.youtube.com/playlist?list=${playlistId}`, added, failed };
}
