/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fogon: {
          dark: '#121212',
          card: '#1A1A1A',
          gold: '#C8A45D',
          'gold-light': '#E6C687',
          wine: '#5A1826',
          'wine-light': '#8A273C',
          forest: '#14281D',
          'forest-light': '#1C3A29',
          cream: '#F4EFE6',
          'cream-muted': '#D3CCC1'
        }
      },
      fontFamily: {
        display: ['Cinzel', 'serif'],
        script: ['"Great Vibes"', 'cursive'],
        body: ['Montserrat', 'sans-serif']
      }
    },
  },
  plugins: [],
}
