/**
 * Палитра задана переменными CSS, а не литералами.
 *
 * Так тема переключается одним атрибутом на <html>, и ни один компонент
 * не знает, светлая она сейчас или тёмная. Проводник учится и в депо при
 * дневном свете, и в дороге вечером — обе темы обязаны быть рабочими,
 * а не «одна настоящая, вторая инвертированная».
 *
 * Цвета взяты из предметной области: холодный стальной нейтральный ряд
 * (зима, металл, платформа) и один акцент — сигнальный янтарный.
 * Красный оставлен семантике: он означает опасность, а не «наш бренд».
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'rgb(var(--c-ground) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        hair: 'rgb(var(--c-hair) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        faint: 'rgb(var(--c-faint) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--c-accent-soft) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        good: 'rgb(var(--c-good) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)'
      },
      fontFamily: {
        display: ['Oswald', 'Arial Narrow', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Consolas', 'monospace']
      },
      maxWidth: { content: '68rem' },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } }
      },
      animation: {
        rise: 'rise .28s ease-out both',
        'pulse-soft': 'pulseSoft 1.1s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
