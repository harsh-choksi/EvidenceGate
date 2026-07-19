import { Citations, type Citation } from "./Citations.js";

export interface SourcedAnswerProps {
  answer: string;
  citations: Citation[];
}

export function SourcedAnswer({ answer, citations }: SourcedAnswerProps) {
  return (
    <main>
      <p>{answer}</p>
      <Citations citations={citations} />
    </main>
  );
}
