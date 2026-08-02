interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function ChannelsInput({ value, onChange }: Props) {
  const count = value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Channels</h2>
        <span className="badge">{count}</span>
      </div>
      <p className="hint">
        One channel per line. Paste a URL, an @handle, a channel ID (UC…), or a channel name.
      </p>
      <textarea
        className="channels"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder={'@veritasium\nhttps://www.youtube.com/@3blue1brown\nUCsXVk37bltHxD1rDPwtNM8Q'}
      />
    </section>
  );
}
