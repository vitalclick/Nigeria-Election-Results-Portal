import createMiddleware from 'next-intl/middleware';

import { defaultLocale, locales } from './lib/i18n';

export default createMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: 'always',
});

export const config = {
  // Match all routes except _next, api, embed, and static files.
  matcher: ['/((?!api|_next|embed|.*\\..*).*)'],
};
