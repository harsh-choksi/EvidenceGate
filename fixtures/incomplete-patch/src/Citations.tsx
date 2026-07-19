export interface Source {
  id: string;
  title: string;
  url: string;
}

export function Citations({ sources }: { sources: Source[] }) {
  return (
    <aside aria-label="Sources">
      <h2>Sources</h2>
      <ul>
        {sources.map((source) => (
          <li key={source.id}>{source.title}</li>
        ))}
      </ul>
    </aside>
  );
}
