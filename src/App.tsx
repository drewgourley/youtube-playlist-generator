import { useCallback, useEffect, useState } from 'react';
import './App.css';
import type { Criteria, Privacy, VideoCandidate } from './types';
import {
  DEFAULT_CRITERIA,
  consumePendingCreate,
  loadChannels,
  loadCriteria,
  loadWorkingState,
  pickRandom,
  saveChannels,
  saveCriteria,
  saveWorkingState,
  setPendingCreate,
} from './config';
import * as api from './api';
import { ChannelsInput } from './components/ChannelsInput';
import { CriteriaForm } from './components/CriteriaForm';
import { Results } from './components/Results';

export default function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [channelTitle, setChannelTitle] = useState<string | null>(null);

  const [channelsText, setChannelsText] = useState<string>(() => loadChannels());
  const [criteria, setCriteria] = useState<Criteria>(() => loadCriteria());

  const restored = loadWorkingState();
  const [pool, setPool] = useState<VideoCandidate[]>(() => restored?.pool ?? []);
  const [videos, setVideos] = useState<VideoCandidate[]>(() => restored?.videos ?? []);

  const [title, setTitle] = useState(restored?.title ?? 'Random Mix');
  const [description, setDescription] = useState(
    restored?.description ?? 'Generated with YouTube Playlist Generator.',
  );
  const [privacy, setPrivacy] = useState<Privacy>(restored?.privacy ?? 'private');

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [playlistUrl, setPlaylistUrl] = useState('');

  const refreshAuth = useCallback(async () => {
    try {
      const s = await api.getAuthStatus();
      setSignedIn(s.signedIn);
      setChannelTitle(s.channelTitle);
    } catch {
      setSignedIn(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshAuth();
      if (cancelled) return;
      // Surface the result of the OAuth redirect, then clean the URL.
      const params = new URLSearchParams(window.location.search);
      const authResult = params.get('auth');
      if (authResult === 'error') setError('Sign-in failed. Please try again.');
      if (params.has('auth')) window.history.replaceState({}, '', window.location.pathname);
      // Resume the create the user started before being sent to sign in.
      if (authResult === 'ok' && consumePendingCreate() && videos.length > 0) {
        handlePublish();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshAuth]);

  useEffect(() => saveChannels(channelsText), [channelsText]);
  useEffect(() => saveCriteria(criteria), [criteria]);
  useEffect(() => {
    saveWorkingState({ pool, videos, title, description, privacy });
  }, [pool, videos, title, description, privacy]);

  async function handleGenerate() {
    setError('');
    setPlaylistUrl('');
    setBusy(true);
    setStatus('Searching channels…');
    try {
      const inputs = channelsText.split('\n');
      const found = await api.generate(inputs, criteria);
      setPool(found);
      setVideos(pickRandom(found, criteria.playlistSize));
      setStatus(`Found ${found.length} candidates.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  function handleReshuffle() {
    if (pool.length === 0) return;
    setVideos(pickRandom(pool, criteria.playlistSize));
    setPlaylistUrl('');
  }

  function handleRemove(videoId: string) {
    setVideos((prev) => prev.filter((v) => v.videoId !== videoId));
    setPlaylistUrl('');
  }

  async function handlePublish() {
    setError('');
    setPlaylistUrl('');
    setBusy(true);
    setStatus('Creating playlist…');
    try {
      const result = await api.publish(
        videos.map((v) => v.videoId),
        { title: title.trim() || 'Random Mix', description, privacy },
      );
      setPlaylistUrl(result.url);
      setStatus(
        result.failed > 0
          ? `Playlist created with ${result.added} videos (${result.failed} could not be added).`
          : 'Playlist created.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await api.logout();
    setSignedIn(false);
    setChannelTitle(null);
  }

  // Persist state and flag intent before the full-page redirect to Google.
  function handleSignInAndCreate() {
    setPendingCreate(true);
    saveWorkingState({ pool, videos, title, description, privacy });
    api.login();
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <span className="logo" aria-hidden>▶</span> YouTube Playlist Generator
        </h1>
        {signedIn ? (
          <div className="account">
            <span className="who">{channelTitle ?? 'Signed in'}</span>
            <button className="btn-ghost" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        ) : (
          <button className="btn-ghost" onClick={api.login}>
            Sign in with Google
          </button>
        )}
      </header>

      <main className="layout">
        <div className="col">
          <ChannelsInput value={channelsText} onChange={setChannelsText} />
          <CriteriaForm criteria={criteria} onChange={setCriteria} />
          <button className="btn-primary block" onClick={handleGenerate} disabled={busy}>
            {busy ? 'Working…' : 'Generate random playlist'}
          </button>
          <button
            className="btn-ghost block"
            onClick={() => setCriteria(DEFAULT_CRITERIA)}
            disabled={busy}
          >
            Reset criteria
          </button>
        </div>

        <div className="col">
          {status && !error && <div className="status">{status}</div>}
          {error && <div className="error">{error}</div>}

          {videos.length > 0 && (
            <>
              <Results videos={videos} onReshuffle={handleReshuffle} onRemove={handleRemove} />

              <section className="card">
                <div className="card-head">
                  <h2>Create on YouTube</h2>
                </div>
                <label>
                  Playlist title
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label>
                  Description
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <label>
                  Visibility
                  <select value={privacy} onChange={(e) => setPrivacy(e.target.value as Privacy)}>
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                {signedIn ? (
                  <button className="btn-primary block" onClick={handlePublish} disabled={busy}>
                    Create playlist ({videos.length} videos)
                  </button>
                ) : (
                  <button className="btn-primary block" onClick={handleSignInAndCreate}>
                    Sign in with Google to create
                  </button>
                )}
                {playlistUrl && (
                  <div className="success">
                    ✓ Created —{' '}
                    <a href={playlistUrl} target="_blank" rel="noreferrer">
                      open playlist on YouTube
                    </a>
                  </div>
                )}
              </section>
            </>
          )}

          {videos.length === 0 && !busy && (
            <div className="placeholder">
              Configure channels and criteria, then generate a playlist to see results here.
            </div>
          )}
        </div>
      </main>

      <footer className="footer">
        <span>
          This product uses the YouTube API Services. By using it you agree to the{' '}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            YouTube Terms of Service
          </a>{' '}
          and the{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          .
        </span>
      </footer>
    </div>
  );
}
