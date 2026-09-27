/**
 * Общие элементы интерфейса.
 *
 * Держим их в одном месте, чтобы карточки, шкалы и подписи выглядели
 * одинаково во всех трёх кабинетах: у проводника, методиста и руководителя.
 * Разъехавшиеся отступы читаются как неаккуратность продукта, даже когда
 * логика внутри безупречна.
 */
import { type ReactNode, useEffect, useState } from 'react'
import type { CompetencyId } from '../../engine/index.js'

// ---------------------------------------------------------------- каркас

export function Label({ children }: { children: ReactNode }) {
  return <div className="label">{children}</div>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
}

export function Section({
  eyebrow, title, action, children
}: { eyebrow?: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4 border-t-2 border-ink/70 pt-3">
        <div className="flex flex-col gap-1">
          {eyebrow ? <Label>{eyebrow}</Label> : null}
          <h2 className="font-display text-xl uppercase tracking-wide leading-none">{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-faint py-6">{children}</p>
}

export function Spinner({ text = 'Загрузка' }: { text?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-faint">
      <span className="inline-block w-2 h-2 bg-accent animate-pulse-soft" aria-hidden="true" />
      <span className="label">{text}</span>
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-danger border-l-2 border-danger pl-3 py-1">
      {children}
    </p>
  )
}

// ----------------------------------------------------------------- шкалы

const TONE: Record<string, string> = {
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-danger',
  accent: 'bg-accent',
  ink: 'bg-ink'
}

export function toneFor(value: number): 'good' | 'warn' | 'bad' {
  if (value >= 70) return 'good'
  if (value >= 45) return 'warn'
  return 'bad'
}

export function Meter({
  value, tone = 'ink', height = 'h-2'
}: { value: number; tone?: keyof typeof TONE; height?: string }) {
  return (
    <div className={`${height} bg-hair w-full overflow-hidden`}>
      <div
        className={`${height} ${TONE[tone]} transition-[width] duration-300`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function BarRow({
  title, value, tone, hint
}: { title: string; value: number; tone?: keyof typeof TONE; hint?: string }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,11rem)_1fr_2.5rem] items-center gap-3 text-sm">
      <span className="text-muted" title={hint}>{title}</span>
      <Meter value={value} tone={tone ?? toneFor(value)} />
      <span className="num text-xs text-faint text-right">{Math.round(value)}</span>
    </div>
  )
}

// -------------------------------------------------------------- диаграмма

interface RadarProps {
  values: Partial<Record<CompetencyId, number>>
  axes: { id: CompetencyId; short: string }[]
  compare?: Partial<Record<CompetencyId, number>>
  compareLabel?: string
  size?: number
}

/**
 * Лепестковая диаграмма компетенций.
 *
 * Рисуется руками, без библиотеки: осей семь, данные приходят в процентах,
 * и всё, что нужно, — это тригонометрия и одна сетка. Библиотека здесь
 * весила бы больше, чем весь экран профиля.
 */
export function Radar({ values, axes, compare, compareLabel, size = 320 }: RadarProps) {
  const shown = axes.filter((a) => typeof values[a.id] === 'number')
  if (shown.length < 3) {
    return <Empty>Данных пока мало: пройдите хотя бы три рейса, чтобы диаграмма стала осмысленной.</Empty>
  }

  // Подписи выносятся за пределы многоугольника, поэтому область просмотра
  // шире рисунка: иначе крайние оси обрезаются по краям, и «СКОРОСТЬ»
  // превращается в «ОРОСТЬ».
  const padX = size * 0.26
  const cx = size / 2
  const cy = size / 2 - 6
  const r = size * 0.27
  const angle = (i: number) => (Math.PI * 2 * i) / shown.length - Math.PI / 2
  const point = (i: number, v: number) => [
    cx + Math.cos(angle(i)) * r * (v / 100),
    cy + Math.sin(angle(i)) * r * (v / 100)
  ]
  const poly = (src: Partial<Record<CompetencyId, number>>) =>
    shown.map((a, i) => point(i, src[a.id] ?? 0).map((n) => n.toFixed(1)).join(',')).join(' ')

  return (
    <figure className="flex flex-col items-center gap-2 m-0">
      <svg
        viewBox={`${-padX} 0 ${size + padX * 2} ${size}`}
        className="w-full max-w-[26rem]"
        role="img"
        aria-label={`Профиль компетенций: ${shown.map((a) => `${a.short} ${values[a.id]}%`).join(', ')}`}
      >
        {[25, 50, 75, 100].map((ring) => (
          <polygon
            key={ring}
            points={shown.map((_, i) => point(i, ring).map((n) => n.toFixed(1)).join(',')).join(' ')}
            fill="none"
            stroke="rgb(var(--c-hair))"
            strokeWidth="1"
          />
        ))}
        {shown.map((a, i) => {
          const [x, y] = point(i, 100)
          return <line key={a.id} x1={cx} y1={cy} x2={x} y2={y} stroke="rgb(var(--c-hair))" strokeWidth="1" />
        })}

        {compare ? (
          <polygon
            points={poly(compare)}
            fill="rgb(var(--c-faint) / 0.14)"
            stroke="rgb(var(--c-faint))"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        ) : null}

        <polygon
          points={poly(values)}
          fill="rgb(var(--c-accent) / 0.18)"
          stroke="rgb(var(--c-accent))"
          strokeWidth="2"
        />
        {shown.map((a, i) => {
          const [x, y] = point(i, values[a.id] ?? 0)
          return <circle key={a.id} cx={x} cy={y} r="3" fill="rgb(var(--c-accent))" />
        })}

        {shown.map((a, i) => {
          const [x, y] = point(i, 124)
          const anchor = Math.abs(x - cx) < 12 ? 'middle' : x > cx ? 'start' : 'end'
          return (
            <text
              key={a.id}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fill="rgb(var(--c-muted))"
              className="text-[10px] font-mono uppercase tracking-wider"
            >
              {a.short} {values[a.id]}
            </text>
          )
        })}
      </svg>
      {compareLabel ? (
        <figcaption className="label flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-accent inline-block" /> вы
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-faint inline-block" /> {compareLabel}
          </span>
        </figcaption>
      ) : null}
    </figure>
  )
}

// ---------------------------------------------------------------- значки

const ICONS: Record<string, string> = {
  book: 'M4 4h11a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3V4Zm3 3v8m0 0h11',
  handshake: 'M4 11l4-4 3 3 3-3 4 4-5 5-2-2-2 2-5-5Z',
  pulse: 'M2 12h4l2-6 4 12 2-6h6',
  tunnel: 'M4 20V12a8 8 0 0 1 16 0v8M9 20v-8a3 3 0 0 1 6 0v8',
  snow: 'M12 2v20M4 7l16 10M20 7L4 17',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l4 2',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c5 6 5 12 0 18-5-6-5-12 0-18Z',
  check: 'M4 12l5 6L20 5',
  star: 'M12 3l2.8 6 6.2.8-4.6 4.3 1.2 6.4L12 17.4 6.4 20.5l1.2-6.4L3 9.8 9.2 9 12 3Z',
  repeat: 'M4 9h12l-3-3m7 9H8l3 3',
  calendar: 'M4 7h16v13H4zM4 7l1-3h14l1 3M9 12h2m4 0h2m-8 4h2m4 0h2',
  mentor: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-8 17a8 8 0 0 1 16 0'
}

export function Icon({ name, className = 'w-5 h-5' }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.star} />
    </svg>
  )
}

// ------------------------------------------------------------------ тема

const THEME_KEY = 'ekipazh-theme'

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem(THEME_KEY) ?? 'dark'
    } catch {
      // Приватное окно или запрет на хранение: тема просто не запомнится.
      return 'dark'
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Настройка не сохранится — это допустимо, интерфейс работает.
    }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme()
  return (
    <button className="btn" onClick={toggle} aria-label="Переключить тему">
      {theme === 'dark' ? 'Светлая' : 'Тёмная'}
    </button>
  )
}
