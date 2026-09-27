/**
 * Визуальная система «Смены 400».
 *
 * Продукт должен ощущаться как рабочий инструмент бригады, а не как портал
 * обучения. Отсюда три решения:
 *
 *   — палитра приборная: глубокий графит с холодным уклоном, крупный контраст,
 *     цвет тратится только на смысл;
 *   — две шкалы разной температуры: безопасность холодная и техническая,
 *     лояльность тёплая и человеческая. Их нельзя перепутать боковым зрением,
 *     а это важно, когда идёт таймер;
 *   — цифры и таймер — моноширинные, чтобы не дрожали при отсчёте.
 *
 * Цвета живут в CSS-переменных (см. index.css): светлая тема нужна для работы
 * в дневном вагоне, тёмная — в поездке и на планшете.
 */
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: rgb('--c-ground'),
        raised: rgb('--c-raised'),
        sunken: rgb('--c-sunken'),
        hair: rgb('--c-hair'),
        ink: rgb('--c-ink'),
        muted: rgb('--c-muted'),
        faint: rgb('--c-faint'),
        accent: rgb('--c-accent'),
        safety: rgb('--c-safety'),
        loyalty: rgb('--c-loyalty'),
        danger: rgb('--c-danger'),
        warn: rgb('--c-warn'),
        good: rgb('--c-good')
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"IBM Plex Sans Condensed"', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      fontSize: {
        'timer': ['3.25rem', { lineHeight: '1', letterSpacing: '-0.02em' }]
      },
      borderRadius: { none: '0', sm: '2px', DEFAULT: '3px', lg: '4px' },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        pulse400: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.45' } }
      },
      animation: {
        rise: 'rise .22s ease-out both',
        pulse400: 'pulse400 1s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
