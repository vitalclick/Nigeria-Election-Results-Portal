import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { LiveCounters } from '@/components/LiveCounters';

export default function LandingPage() {
  const t = useTranslations('landing');
  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <p className="text-sm uppercase tracking-widest text-ng-green font-semibold">
        {t('eyebrow')}
      </p>
      <h1 className="text-4xl md:text-5xl font-bold mt-3 leading-tight">
        {t('title')}
      </h1>
      <p className="mt-5 text-lg text-slate-700 max-w-3xl">{t('lede')}</p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/en/map"
          className="px-5 py-3 rounded-md bg-ng-green text-white font-medium hover:opacity-90"
        >
          {t('cta_map')}
        </Link>
        <Link
          href="/en/discrepancies"
          className="px-5 py-3 rounded-md border border-slate-300 hover:bg-slate-100"
        >
          {t('cta_disc')}
        </Link>
        <Link
          href="/en/agent"
          className="px-5 py-3 rounded-md border border-slate-300 hover:bg-slate-100"
        >
          {t('cta_agent')}
        </Link>
      </div>

      <div className="mt-12">
        <LiveCounters electionId="2027-presidential" />
      </div>

      <section className="mt-16 grid md:grid-cols-3 gap-6">
        <div className="p-6 border rounded-lg bg-white">
          <h3 className="font-semibold">{t('feature1_title')}</h3>
          <p className="mt-2 text-slate-600">{t('feature1_body')}</p>
        </div>
        <div className="p-6 border rounded-lg bg-white">
          <h3 className="font-semibold">{t('feature2_title')}</h3>
          <p className="mt-2 text-slate-600">{t('feature2_body')}</p>
        </div>
        <div className="p-6 border rounded-lg bg-white">
          <h3 className="font-semibold">{t('feature3_title')}</h3>
          <p className="mt-2 text-slate-600">{t('feature3_body')}</p>
        </div>
      </section>
    </div>
  );
}
