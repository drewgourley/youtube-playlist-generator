import type { Criteria, SortOrder } from '../types';

interface Props {
  criteria: Criteria;
  onChange: (criteria: Criteria) => void;
}

const ORDER_LABELS: Record<SortOrder, string> = {
  viewCount: 'Most viewed',
  date: 'Newest first',
  rating: 'Top rated',
  relevance: 'Most relevant',
};

export function CriteriaForm({ criteria, onChange }: Props) {
  function update<K extends keyof Criteria>(key: K, value: Criteria[K]) {
    onChange({ ...criteria, [key]: value });
  }

  const num = (v: string) => (v === '' ? 0 : Math.max(0, Math.floor(Number(v))));

  return (
    <section className="card">
      <div className="card-head">
        <h2>Criteria</h2>
      </div>

      <div className="grid">
        <label>
          Rank candidates by
          <select
            value={criteria.order}
            onChange={(e) => update('order', e.target.value as SortOrder)}
          >
            {(Object.keys(ORDER_LABELS) as SortOrder[]).map((o) => (
              <option key={o} value={o}>
                {ORDER_LABELS[o]}
              </option>
            ))}
          </select>
        </label>

        <label>
          Minimum views
          <input
            type="number"
            min={0}
            step={1000}
            value={criteria.minViews || ''}
            onChange={(e) => update('minViews', num(e.target.value))}
            placeholder="0"
          />
        </label>

        <label>
          Published after
          <input
            type="date"
            value={criteria.publishedAfter}
            onChange={(e) => update('publishedAfter', e.target.value)}
          />
        </label>

        <label>
          Published before
          <input
            type="date"
            value={criteria.publishedBefore}
            onChange={(e) => update('publishedBefore', e.target.value)}
          />
        </label>

        <label>
          Candidates per channel
          <input
            type="number"
            min={1}
            max={50}
            value={criteria.poolPerChannel}
            onChange={(e) =>
              update('poolPerChannel', Math.min(50, Math.max(1, num(e.target.value))))
            }
          />
        </label>

        <label>
          Videos in playlist
          <input
            type="number"
            min={1}
            value={criteria.playlistSize}
            onChange={(e) => update('playlistSize', Math.max(1, num(e.target.value)))}
          />
        </label>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={criteria.excludeShorts}
          onChange={(e) => update('excludeShorts', e.target.checked)}
        />
        Exclude Shorts (videos 60s or shorter)
      </label>
    </section>
  );
}
