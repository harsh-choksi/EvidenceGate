export interface Citation {
  sourceId: string;
  title: string;
  url: string;
}

export function Citations({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return <p role="status">No cited sources were returned.</p>;
  return (
    <aside aria-label="Citations">
      <h2>Citations</h2>
      <ol>
        {citations.map((citation) => (
          <li key={citation.sourceId}>
            <a href={citation.url} target="_blank" rel="noopener noreferrer">
              {citation.title}
            </a>
          </li>
        ))}
      </ol>
    </aside>
  );
}
