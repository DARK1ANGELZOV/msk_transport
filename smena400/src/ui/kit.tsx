import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { ScaleMeta, Scales } from '../lib/api'

export function Card({
  children, className = '', role
}: { children: ReactNode; className?: string; role?: string }) {
  return <div className={`card ${className}`} role={role}>{children}</div>
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel ${className}`}>{children}</div>
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`label ${className}`}>{children}</div>
}

export function Spinner({ text = 'Загрузка' }: { text?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted text-sm" role="status">
      <span className="w-2 h-2 bg-accent animate-pulse400" aria-hidden="true" />
      {text}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-2 border-danger pl-3 py-1 text-sm text-danger" role="alert">
      {children}
    </div>
  )
}

/**
 * Цвет показателя.
 *
 * Привязан к идентификатору, а не к порядку на экране: безопасность всегда
 * голубая, лояльность всегда тёплая, и в любом сценарии они выглядят
 * одинаково. Переучиваться при переходе между ситуациями не приходится.
 */
const TONE: Record<string, { text: string; bg: string }> = {
  safety: { text: 'text-safety', bg: 'bg-safety' },
  loyalty: { text: 'text-loyalty', bg: 'bg-loyalty' },
  order: { text: 'text-order', bg: 'bg-order' },
  trust: { text: 'text-trust', bg: 'bg-trust' }
}
const toneOf = (id: string) => TONE[id] ?? { text: 'text-accent', bg: 'bg-accent' }

/**
 * Показатель состояния.
 *
 * Крупная цифра, тонкая полоса и отдельное изменение рядом. Само по себе
 * новое значение не говорит ничего — «−9» говорит всё, поэтому изменение
 * показывается явно и держится до следующего хода.
 *
 * Низкое значение окрашивается в красный независимо от показателя: красный
 * в этом интерфейсе означает риск, и это единственное, что он означает.
 */
export function ScaleBar({
  meta, value, delta = 0, size = 'normal'
}: {
  meta: ScaleMeta
  value: number
  delta?: number
  size?: 'normal' | 'big'
}) {
  const tone = toneOf(meta.id)
  const low = value < 35

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label truncate">{meta.short}</span>
        {delta !== 0 && (
          <span
            className={`num text-xs ${delta > 0 ? 'text-good' : 'text-danger'} animate-rise`}
            aria-label={`изменение ${delta > 0 ? 'плюс' : 'минус'} ${Math.abs(delta)}`}
          >
            {delta > 0 ? '+' : '−'}{Math.abs(delta)}
          </span>
        )}
      </div>
      <div
        className={`num leading-none mt-0.5 ${size === 'big' ? 'text-3xl' : 'text-xl'} ${
          low ? 'text-danger' : tone.text
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 h-1 bg-sunken overflow-hidden">
        <div
          className={`h-full ${low ? 'bg-danger' : tone.bg} transition-[width] duration-500`}
          style={{ width: `${Math.max(2, value)}%` }}
        />
      </div>
    </div>
  )
}

/** Показатели сценария рядом: порознь они не читаются. */
export function ScaleRow({
  meta, scales, deltas, size
}: {
  meta: ScaleMeta[]
  scales: Scales
  deltas?: Partial<Scales>
  size?: 'normal' | 'big'
}) {
  return (
    <div className="flex gap-6">
      {meta.map((m) => (
        <ScaleBar
          key={m.id}
          meta={m}
          value={scales[m.id] ?? 0}
          delta={deltas?.[m.id] ?? 0}
          size={size}
        />
      ))}
    </div>
  )
}

/**
 * Таймер.
 *
 * Всегда красный: время — это риск, и в этом интерфейсе красный означает
 * только его. Цифра крупная, полоса убывает слева направо.
 *
 * Отсчёт идёт от значения, полученного с сервера. Клиентские часы здесь
 * только рисуют: решение о том, истекло время или нет, принимает сервер.
 */
export function Timer({
  totalSec, remainingMs, onExpire
}: {
  totalSec: number
  remainingMs: number
  onExpire: () => void
}) {
  const [left, setLeft] = useState(remainingMs)
  const fired = useRef(false)

  useEffect(() => {
    setLeft(remainingMs)
    fired.current = false
    const started = Date.now()
    const id = setInterval(() => {
      const next = Math.max(0, remainingMs - (Date.now() - started))
      setLeft(next)
      if (next === 0 && !fired.current) {
        fired.current = true
        onExpire()
      }
    }, 100)
    return () => clearInterval(id)
  }, [remainingMs, onExpire])

  const share = Math.max(0, Math.min(1, left / (totalSec * 1000)))
  const urgent = share < 0.34
  const seconds = Math.ceil(left / 1000)

  return (
    <div className="flex items-center gap-3" role="timer" aria-live="off">
      <span className="label">На решение</span>
      <div className="flex-1 h-1.5 bg-sunken overflow-hidden">
        <div
          className="h-full bg-danger"
          style={{
            width: `${share * 100}%`,
            transition: 'width .1s linear',
            opacity: urgent ? 1 : 0.75
          }}
        />
      </div>
      <span className={`num tabular-nums text-danger ${urgent ? 'text-lg' : 'text-sm'}`}>
        {seconds} с
      </span>
    </div>
  )
}

/** Метка исхода: цвет несёт смысл, а не украшает. */
export function Verdict({ verdict }: { verdict: 'good' | 'mixed' | 'bad' }) {
  const map = {
    good: ['border-good text-good', 'Ситуация закрыта'],
    mixed: ['border-warn text-warn', 'Закрыта с издержками'],
    bad: ['border-danger text-danger', 'Вышла из-под контроля']
  } as const
  const [cls, title] = map[verdict]
  return <span className={`chip border ${cls}`}>{title}</span>
}

/** Полоса компетенции. Непроверенная компетенция показывается прочерком. */
export function CompetencyBar({
  title, hint, pct, touched
}: {
  title: string
  hint?: string
  pct: number | null
  touched: boolean
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{title}</span>
        <span className="num text-sm text-muted">
          {touched && pct !== null ? `${pct} %` : '—'}
        </span>
      </div>
      <div className="mt-1 h-1 bg-sunken overflow-hidden">
        {touched && pct !== null ? (
          <div className="h-full bg-accent" style={{ width: `${Math.max(2, pct)}%` }} />
        ) : null}
      </div>
      {hint ? <p className="text-xs text-faint mt-1">{hint}</p> : null}
    </div>
  )
}
