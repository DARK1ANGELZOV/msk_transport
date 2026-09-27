import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { ScaleId, Scales } from '../lib/api'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
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
 * Шкала.
 *
 * Обе шкалы нарисованы одинаково по форме и по-разному по цвету: безопасность
 * холодная и техническая, лояльность тёплая. Под таймером человек считывает
 * их боковым зрением, и перепутать их нельзя.
 *
 * Изменение показывается отдельной цифрой и держится несколько секунд:
 * само по себе новое значение ничего не говорит, а «−9» говорит всё.
 */
export function ScaleBar({
  id, title, value, delta = 0, compact = false
}: {
  id: ScaleId
  title: string
  value: number
  delta?: number
  compact?: boolean
}) {
  const tone = id === 'safety' ? 'bg-safety' : 'bg-loyalty'
  const text = id === 'safety' ? 'text-safety' : 'text-loyalty'
  const low = value < 35

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label truncate">{title}</span>
        <span className="flex items-baseline gap-1.5">
          {delta !== 0 && (
            <span
              className={`num text-xs ${delta > 0 ? 'text-good' : 'text-danger'} animate-rise`}
              aria-label={`изменение ${delta > 0 ? 'плюс' : 'минус'} ${Math.abs(delta)}`}
            >
              {delta > 0 ? '+' : '−'}{Math.abs(delta)}
            </span>
          )}
          <span className={`num ${compact ? 'text-sm' : 'text-lg'} ${low ? 'text-danger' : text}`}>
            {value}
          </span>
        </span>
      </div>
      <div className="mt-1 h-1.5 bg-sunken border border-hair overflow-hidden">
        <div
          className={`h-full ${low ? 'bg-danger' : tone} transition-[width] duration-500`}
          style={{ width: `${Math.max(2, value)}%` }}
        />
      </div>
    </div>
  )
}

/** Обе шкалы рядом: они всегда показываются вместе, порознь смысла нет. */
export function ScaleRow({
  scales, deltas, compact
}: {
  scales: Scales
  deltas?: Partial<Scales>
  compact?: boolean
}) {
  return (
    <div className="flex gap-5">
      <ScaleBar
        id="loyalty" title="Лояльность" value={scales.loyalty}
        delta={deltas?.loyalty ?? 0} compact={compact}
      />
      <ScaleBar
        id="safety" title="Безопасность" value={scales.safety}
        delta={deltas?.safety ?? 0} compact={compact}
      />
    </div>
  )
}

/**
 * Таймер.
 *
 * Полоса убывает, цифра считает секунды. Когда остаётся меньше трети,
 * цвет меняется: это единственный момент, где интерфейс имеет право
 * подгонять — потому что в реальности время действительно кончается.
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
      <div className="flex-1 h-1 bg-sunken overflow-hidden">
        <div
          className={`h-full ${urgent ? 'bg-danger' : 'bg-accent'}`}
          style={{ width: `${share * 100}%`, transition: 'width .1s linear' }}
        />
      </div>
      <span className={`num text-sm tabular-nums ${urgent ? 'text-danger' : 'text-muted'}`}>
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
  return (
    <span className={`chip border ${cls}`}>
      {title}
    </span>
  )
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
