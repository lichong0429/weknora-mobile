/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EFEFFF',
          100: '#E4E2FF',
          200: '#C9C6FF',
          300: '#A9A3FA',
          400: '#8B7CF2',
          500: '#6D5CF5',
          600: '#5B5BD6',
          700: '#4A48B8',
          800: '#3B3A8F',
          900: '#2E2D6B'
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#F6F7F9',
          subtle: '#F0F1F4'
        },
        ink: {
          DEFAULT: '#1A1D26',
          secondary: '#5B5F66',
          muted: '#8A8F99',
          faint: '#B9BEC7'
        },
        line: {
          DEFAULT: '#EDEDF2'
        },
        accent: {
          blue: '#3B82F6',
          emerald: '#0FB87E',
          violet: '#8B5CF6',
          amber: '#F59E0B'
        }
      },
      borderRadius: {
        '2xl': '18px',
        '3xl': '20px',
        '4xl': '24px'
      },
      boxShadow: {
        card: '0 4px 12px rgba(17, 17, 26, 0.06)',
        'card-hover': '0 8px 24px rgba(17, 17, 26, 0.10)',
        pill: '0 6px 20px rgba(17, 17, 26, 0.12)',
        'brand-lg': '0 10px 24px rgba(91, 91, 214, 0.35)'
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'system-ui', '-apple-system', 'sans-serif']
      }
    }
  },
  plugins: []
};
