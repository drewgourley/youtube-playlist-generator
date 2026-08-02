import type { VideoCandidate } from '../types';

interface Props {
  videos: VideoCandidate[];
  onReshuffle: () => void;
  onRemove: (videoId: string) => void;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function Results({ videos, onReshuffle, onRemove }: Props) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Selected videos</h2>
        <span className="badge">{videos.length}</span>
        <button className="btn-ghost small" onClick={onReshuffle}>
          Reshuffle
        </button>
      </div>

      <ul className="results">
        {videos.map((v) => (
          <li key={v.videoId} className="result">
            <a
              href={`https://www.youtube.com/watch?v=${v.videoId}`}
              target="_blank"
              rel="noreferrer"
              className="thumb"
            >
              {v.thumbnail ? <img src={v.thumbnail} alt="" loading="lazy" /> : null}
            </a>
            <div className="result-meta">
              <a
                href={`https://www.youtube.com/watch?v=${v.videoId}`}
                target="_blank"
                rel="noreferrer"
                className="result-title"
              >
                {v.title}
              </a>
              <div className="result-sub">
                {v.channelTitle} · {formatViews(v.viewCount)} views ·{' '}
                {new Date(v.publishedAt).toLocaleDateString()}
              </div>
            </div>
            <button
              className="btn-ghost small remove"
              title="Remove"
              onClick={() => onRemove(v.videoId)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
