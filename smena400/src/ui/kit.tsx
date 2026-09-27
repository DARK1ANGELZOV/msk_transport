import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import type { ScaleMeta, Scales } from '../lib/api'
import { IconClock, ScaleIcon } from './brand'

type BoxProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  role?: string
}

export function Card({ children, className = '', style, role }: BoxProps) {
  return <div className={`card ${className}`} style={style} role={role}>{children}</div>
}

export function Panel({ children, className = '', style }: BoxProps) {
  return <div className={`panel ${className}`} style={style}>{children}</div>
}

export function Label({ children, className = '', style }: BoxProps) {
  return <div className={`label ${className}`} style={style}>{children}</div>
}

export function Spinner({ text = 'Загрузка' }: { text?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted text-sm" role="status">
      <span className="w-2 h-2 bg-accent rounded-full animate-pulse400" aria-hidden="true" />
      {text}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-4 py-3 text-sm text-danger rounded-lg"
      style={{ background: 'rgb(var(--c-accent) / .1)', border: '1px solid rgb(var(--c-accent) / .4)' }}
      role="alert"
    >
      {children}
    </div>
  )
}

/**
 * Цвет показателя.
 *
 * Привязан к идентификатору, а не к порядку на экране: безопасность всегда
 * голубая, лояльность всегда тёплая. В любом сценарии они выглядят
 * одинаково, и переучиваться при переходе не приходится.
 */
const TONE: Record<string, string> = {
  safety: 'var(--c-safety)',
  loyalty: 'var(--c-loyalty)',
  order: 'var(--c-order)',
  trust: 'var(--c-trust)'
}
export const toneVar = (id: string) => TONE[id] ?? 'var(--c-blue)'

/**
 * Показатель состояния.
 *
 * Иконка, подпись, крупная цифра и полоса. Изменение показывается отдельно
 * и держится до следующего хода: само по себе новое значение ничего
 * не говорит, а «−9» говорит всё.
 */
export function ScaleBar({
  meta, value, delta = 0, size = 'normal'
}: {
  meta: ScaleMeta
  value: number
  delta?: number
  size?: 'normal' | 'big'
}) {
  const color = `rgb(${toneVar(meta.id)})`
  const low = value < 35
  const shown = low ? 'rgb(var(--c-danger))' : color

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span style={{ color: shown }} className="shrink-0">
          <ScaleIcon id={meta.id} size={size === 'big' ? 18 : 15} />
        </span>
        <span className="text-xs text-muted truncate flex-1">{meta.short}</span>
        {delta !== 0 && (
          <span
            className={`num text-xs font-semibold ${delta > 0 ? 'text-good' : 'text-danger'}`}
            aria-label={`изменение ${delta > 0 ? 'плюс' : 'минус'} ${Math.abs(delta)}`}
          >
            {delta > 0 ? '+' : '−'}{Math.abs(delta)}
          </span>
        )}
        <span
          className={`num font-semibold ${size === 'big' ? 'text-2xl' : 'text-lg'} leading-none`}
          style={{ color: shown }}
        >
          {value}
        </span>
      </div>
      <div className="meter mt-2">
        <span style={{ width: `${Math.max(2, value)}%`, background: shown }} />
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
    <div className="flex gap-5 sm:gap-8">
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
 * Круговая шкала итога.
 *
 * На финале показатель — уже не рабочий инструмент, а результат, и читается
 * он как цифра, а не как полоса. Поэтому здесь кольцо и крупное число.
 */
export function Gauge({
  meta, value, size = 116
}: { meta: ScaleMeta; value: number; size?: number }) {
  const color = `rgb(${toneVar(meta.id)})`
  const stroke = 9
  const r = (size - stroke) / 2
  const len = 2 * Math.PI * r
  const filled = (Math.max(0, Math.min(100, value)) / 100) * len

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} aria-hidden="true">
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="rgb(var(--c-sunken))" strokeWidth={stroke}
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${filled} ${len}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="num text-3xl font-bold" style={{ color }}>{value}</span>
        </div>
      </div>
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span style={{ color }}><ScaleIcon id={meta.id} size={14} /></span>
        {meta.short}
      </span>
    </div>
  )
}

/**
 * Динамика показателей по ходу прохождения.
 *
 * Одна линия на показатель, одна точка на шаг. Нужна затем, чтобы человек
 * увидел не итог, а форму: где именно всё пошло вниз.
 */
export function Dynamics({
  meta, series
}: {
  meta: ScaleMeta[]
  series: { step: number; scales: Scales }[]
}) {
  if (series.length < 2) return null

  const w = 320
  const h = 96
  const pad = 6
  const x = (i: number) => pad + (i * (w - pad * 2)) / (series.length - 1)
  const y = (v: number) => h - pad - ((v / 100) * (h - pad * 2))

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img"
          aria-label="Динамика показателей по шагам">
          {[0, 50, 100].map((v) => (
            <line
              key={v} x1={pad} x2={w - pad} y1={y(v)} y2={y(v)}
              stroke="rgb(var(--c-hair))" strokeWidth="1" strokeDasharray="3 4"
            />
          ))}
          {meta.map((m) => {
            const color = `rgb(${toneVar(m.id)})`
            const pts = series.map((s, i) => `${x(i)},${y(s.scales[m.id] ?? 0)}`)
            return (
              <g key={m.id}>
                <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2.2"
                  strokeLinejoin="round" strokeLinecap="round" />
                <circle
                  cx={x(series.length - 1)}
                  cy={y(series.at(-1)!.scales[m.id] ?? 0)}
                  r="3.5" fill={color}
                />
              </g>
            )
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-4">
        {meta.map((m) => (
          <span key={m.id} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="w-3 h-0.5 rounded-full" style={{ background: `rgb(${toneVar(m.id)})` }} />
            {m.short}
          </span>
        ))}
        <span className="label ml-auto">старт → финал</span>
      </div>
    </div>
  )
}

/**
 * Таймер.
 *
 * Красный бейдж с часами, формат «минуты:секунды». Красный здесь означает
 * ровно то же, что везде в продукте, — время и риск.
 *
 * Отсчёт идёт от значения, полученного с сервера. Клиентские часы только
 * рисуют: решение о том, истекло время или нет, принимает сервер.
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
  const total = Math.ceil(left / 1000)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')

  return (
    <div className="flex items-center gap-3">
      <span className="timer-badge text-sm" data-urgent={urgent} role="timer" aria-live="off">
        <IconClock size={14} />
        {mm}:{ss}
      </span>
      <div className="flex-1 h-1 bg-sunken rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${share * 100}%`,
            background: 'rgb(var(--c-accent))',
            opacity: urgent ? 1 : 0.7,
            transition: 'width .1s linear'
          }}
        />
      </div>
    </div>
  )
}

/** Метка исхода: цвет несёт смысл, а не украшает. */
export function Verdict({ verdict }: { verdict: 'good' | 'mixed' | 'bad' }) {
  const map = {
    good: ['text-good', 'rgb(var(--c-good) / .14)', 'rgb(var(--c-good) / .45)', 'Ситуация успешно разрешена'],
    mixed: ['text-warn', 'rgb(var(--c-warn) / .14)', 'rgb(var(--c-warn) / .45)', 'Закрыта с издержками'],
    bad: ['text-danger', 'rgb(var(--c-danger) / .14)', 'rgb(var(--c-danger) / .45)', 'Вышла из-под контроля']
  } as const
  const [cls, bg, border, title] = map[verdict]
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full ${cls}`}
      style={{ background: bg, border: `1px solid ${border}` }}
    >
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
          {touched && pct !== null ? `${pct}` : '—'}
        </span>
      </div>
      <div className="meter mt-1.5" style={{ height: 6 }}>
        {touched && pct !== null ? (
          <span style={{ width: `${Math.max(2, pct)}%`, background: 'rgb(var(--c-blue))' }} />
        ) : null}
      </div>
      {hint ? <p className="text-xs text-faint mt-1">{hint}</p> : null}
    </div>
  )
}
