import { useState } from 'react'

import {
  elementsOf, meetsRequires,
  type Element, type ScenarioNode, type World
} from '../../engine/index.js'
import { seconds } from '../lib/format'
import { Label } from '../ui/kit'

/**
 * Узлы с множественным выбором: список действий, доклад, приоритеты.
 *
 * Порядок отметок — часть навыка, поэтому он виден: рядом с каждым выбранным
 * пунктом стоит номер. В медицинском инциденте «сначала доложить, потом
 * осмотреть» и «сначала осмотреть, потом доложить» — разные исходы,
 * и интерфейс обязан показывать, что порядок вообще существует.
 */
export function MultiNode({
  node, world, onSubmit
}: { node: ScenarioNode; world: World; onSubmit: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const pool = elementsOf(node).filter((el) => meetsRequires(el.requires, world))

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const kind = node.type === 'radio' ? 'Доклад' : node.type === 'sort' ? 'Приоритеты' : 'Действия'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <Label>{kind} · порядок учитывается</Label>
        {picked.length ? (
          <button className="btn" onClick={() => setPicked([])}>Сбросить</button>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2 list-none p-0 m-0">
        {pool.map((el) => {
          const index = picked.indexOf(el.id)
          const on = index >= 0
          return (
            <li key={el.id}>
              <button
                className={`w-full card text-left p-3.5 flex items-start gap-4 transition-colors ${
                  on ? 'border-accent bg-accent-soft' : 'hover:border-line'
                }`}
                aria-pressed={on}
                onClick={() => toggle(el.id)}
              >
                <span
                  className={`num text-xs w-6 h-6 shrink-0 grid place-items-center border ${
                    on ? 'border-accent text-accent' : 'border-hair text-faint'
                  }`}
                >
                  {on ? index + 1 : '·'}
                </span>
                <span className="text-[0.95rem] leading-snug flex-1">{el.text}</span>
                {el.costSec ? (
                  <span className="num text-xs text-faint whitespace-nowrap">{seconds(el.costSec)}</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      <button
        className="btn btn-primary self-start"
        onClick={() => onSubmit(picked)}
        disabled={!picked.length}
      >
        Выполнить{picked.length ? ` · ${picked.length}` : ''}
      </button>
    </div>
  )
}

/**
 * Клик по схеме.
 *
 * Схема рисуется вектором по ключу из сценария, а цели заданы долями 0..1 —
 * поэтому один и тот же узел одинаково работает на телефоне и на проекторе,
 * а при переносе в 3D координаты не придётся пересчитывать.
 */
export function SpatialNode({
  node, onSubmit
}: { node: ScenarioNode; onSubmit: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const targets = (node.items ?? []).filter((t) => typeof t.x === 'number')

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="flex flex-col gap-3">
      <Label>Схема · {node.map === 'vestibule' ? 'тамбур' : 'вагон'} · порядок учитывается</Label>

      <div className="card p-3">
        <svg viewBox="0 0 100 60" className="w-full" role="group" aria-label="Схема помещения">
          <Plan map={node.map} />
          {targets.map((t) => {
            const on = picked.includes(t.id)
            return (
              <g key={t.id} onClick={() => toggle(t.id)} className="cursor-pointer">
                <circle
                  cx={(t.x ?? 0) * 100}
                  cy={(t.y ?? 0) * 60}
                  r={(t.r ?? 0.06) * 100}
                  fill={on ? 'rgb(var(--c-accent) / .25)' : 'rgb(var(--c-accent) / .06)'}
                  stroke="rgb(var(--c-accent))"
                  strokeWidth={on ? 1.2 : 0.6}
                  strokeDasharray={on ? undefined : '2 1.5'}
                />
                <text
                  x={(t.x ?? 0) * 100}
                  y={(t.y ?? 0) * 60 + 1.4}
                  textAnchor="middle"
                  className="text-[3px] font-mono"
                  fill="rgb(var(--c-accent))"
                >
                  {on ? picked.indexOf(t.id) + 1 : '?'}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
        {targets.map((t: Element) => {
          const index = picked.indexOf(t.id)
          return (
            <li key={t.id}>
              <button
                className={`w-full text-left px-3 py-2 border text-sm flex items-center gap-3 transition-colors ${
                  index >= 0 ? 'border-accent bg-accent-soft' : 'border-hair hover:border-line'
                }`}
                aria-pressed={index >= 0}
                onClick={() => toggle(t.id)}
              >
                <span className="num text-xs w-5 text-center text-faint">
                  {index >= 0 ? index + 1 : '·'}
                </span>
                <span className="flex-1">{t.text}</span>
                {t.costSec ? <span className="num text-xs text-faint">{seconds(t.costSec)}</span> : null}
              </button>
            </li>
          )
        })}
      </ul>

      <button
        className="btn btn-primary self-start"
        onClick={() => onSubmit(picked)}
        disabled={!picked.length}
      >
        Выполнить{picked.length ? ` · ${picked.length}` : ''}
      </button>
    </div>
  )
}

/** Схематичный план: не чертёж вагона, а ориентир. Так и подписано. */
function Plan({ map }: { map?: string }) {
  const stroke = 'rgb(var(--c-line))'
  if (map === 'vestibule') {
    return (
      <g fill="none" stroke={stroke} strokeWidth="0.8">
        <rect x="4" y="6" width="92" height="48" />
        <line x1="4" y1="20" x2="96" y2="20" strokeDasharray="2 2" />
        <rect x="8" y="24" width="14" height="26" />
        <rect x="82" y="14" width="10" height="32" />
        <line x1="40" y1="6" x2="40" y2="54" strokeDasharray="1.5 2" />
        <line x1="60" y1="6" x2="60" y2="54" strokeDasharray="1.5 2" />
      </g>
    )
  }
  return (
    <g fill="none" stroke={stroke} strokeWidth="0.8">
      <rect x="3" y="8" width="94" height="44" rx="4" />
      {[16, 28, 40, 52, 64, 76].map((x) => (
        <g key={x}>
          <rect x={x} y="12" width="8" height="7" />
          <rect x={x} y="41" width="8" height="7" />
        </g>
      ))}
      <line x1="3" y1="30" x2="97" y2="30" strokeDasharray="2 2" />
    </g>
  )
}
