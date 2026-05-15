import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpenBallot Nigeria',
  description:
    'Transparent. Verifiable. Irreversible. Nigeria\'s open, multi-source, document-first election results platform.',
  manifest: '/manifest.json',
  themeColor: '#008753',
  openGraph: {
    title: 'OpenBallot Nigeria',
    description: 'The form is the truth. The truth is public.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
