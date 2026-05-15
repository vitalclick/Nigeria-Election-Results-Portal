import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Verification status colour scale - shared with the map renderer
        status: {
          nodata: '#e5e7eb',
          single: '#f6c453',
          consensus: '#22c55e',
          discrepancy: '#f97316',
          confirmed: '#2563eb',
          conflict: '#dc2626',
        },
        ng: {
          green: '#008753',
          white: '#ffffff',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
