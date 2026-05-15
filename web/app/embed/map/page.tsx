import { ResultsMap } from '@/components/ResultsMap';

// Embeddable variant of the public map.
// Renders without header/chrome so it can be dropped into iframes by media
// partners. The route returns the relaxed X-Frame-Options header configured
// in next.config.mjs.
export default function EmbedMap({
  searchParams,
}: {
  searchParams: { election?: string };
}) {
  const electionId = searchParams.election ?? '2027-presidential';
  return (
    <div style={{ height: '100vh', width: '100%' }}>
      <ResultsMap electionId={electionId} />
    </div>
  );
}
