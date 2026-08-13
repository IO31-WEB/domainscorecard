/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Domain Realty brand blue (sampled from the agency logo) plus a
        // deeper "Gulf at dusk" navy-blue for contrast panels — kept to a
        // blue/white palette throughout, no gold/brass accents.
        'domain-blue': '#1878BE',
        'domain-blue-dark': '#125A93',
        'domain-deep': '#0B2E4A',
        'domain-deep-light': '#123F63',
        'domain-tint': '#EAF4FC',
        'domain-ink': '#1F2937',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
