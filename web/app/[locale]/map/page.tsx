import 'mapbox-gl/dist/mapbox-gl.css';

import { Suspense } from 'react';
import { unstable_setRequestLocale } from 'next-intl/server';

import { ResultsMap } from '@/components/ResultsMap';

export const metadata = {
  title: 'Result Verification · OpenBallot Nigeria',
};

export default function MapPage({ params }: { params: { locale: string } }) {
  unstable_setRequestLocale(params.locale);
  return (
    <div className="map-container">
      <Suspense fallback={<div className="p-10 text-slate-500">Loading map…</div>}>
        <ResultsMap defaultElectionId="2027-presidential" />
      </Suspense>
    </div>
  );
}
