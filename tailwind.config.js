/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      colors: {
        surface: {
          0: '#0a0a0a',
          1: '#111111',
          2: '#1a1a1a',
          3: '#242424',
          4: '#2e2e2e',
        },
        border: '#2e2e2e',
        muted: '#6b6b6b',
        subtle: '#4a4a4a',
      },
    },
  },
  plugins: [],
}
