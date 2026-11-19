/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0710',
        night: '#140B1A',
        wine: '#7A0E2B',
        crimson: '#B3123F',
        rose: '#E8B4A0',
        blush: '#F6DCD2',
        mist: '#B9A9B6',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 calc(24px * var(--glow)) rgba(179, 18, 63, calc(0.45 * var(--glow)))',
        rose: '0 0 calc(18px * var(--glow)) rgba(232, 180, 160, calc(0.35 * var(--glow)))',
      },
    },
  },
  plugins: [],
};
