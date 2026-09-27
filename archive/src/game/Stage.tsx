import { useEffect } from 'react'

import {
  ENGINE, MULTI_TYPES, meetsRequires, metresIn,
  type Choice, type Line, type Scenario, type ScenarioNode, type World
} from '../../engine/index.js'
import { km as kmText, mmss, seconds } from '../lib/format'
import { Label, Meter, toneFor } from '../ui/kit'

import { MultiNode, SpatialNode } from './Nodes'
import { RouteStrip } from './RouteStrip'
import { Speech } from './Speech'
import type { LegState } from './useLeg'

/**
 * Сцена инцидента: приборная панель и узел.
 *
 * Один и тот же набор используется и в одиночном режиме, и внутри смены —
 * поэтому проводник видит одно и то же независимо от того, как он зашёл.
 */

// ---------------------------------------------------------------------------
// Приборная панель
// ---------------------------------------------------------------------------

export function Hud({
  scenario, line, world, remaining, limit, stressed, extra
}: {
  scenario: Scenario
  line: Line | null
  world: World
  remaining: number | null
  limit: number
  stressed: boolean
  extra?: React.ReactNode
}) {
  const service = line?.services.find((s) => s.id === scenario.context?.service)
  const segment = line?.limits.find((l) => (world.km ?? 0) < l.toKm)
  const limitKmh = segment?.kmh ?? 400
  const limitReason = segment?.why ?? ''
  const topSpeed = line ? Math.max(...line.limits.map((l) => l.kmh)) : 400

  return (
    <header className="border-b border-hair bg-surface sticky top-0 z-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-3 pb-2.5 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-xs">
          <span className="text-faint uppercase tracking-[0.12em] truncate">
            {service?.title ?? line?.title ?? scenario.context?.route}
          </span>
          <span className="tabular-nums text-ink">{world.clock ?? ''}</span>
          <span className="text-faint">вагон {scenario.context?.car ?? 4}</span>
          <span className={world.comms ? 'text-faint' : 'text-danger'}>
            канал: {world.comms ? 'свободен' : 'занят'}
          </span>
          {world.flags.includes('filmed') ? (
            <span className="text-warn uppercase tracking-[0.12em]">вас снимают</span>
          ) : null}
          {scenario.examMode ? (
            <span className="text-accent uppercase tracking-[0.12em]">экзамен</span>
          ) : null}
          {extra}
        </div>

        {line ? (
          <div className="flex items-end gap-4">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-3xl leading-none tabular-nums">
                {world.speedKmh}
              </span>
              <span className="label">км/ч</span>
            </div>
            {/*
              Шкала отложена от конструкционных четырёхсот, а предел участка
              стоит засечкой. Так видно и то, как быстро идёт состав, и то,
              что он упёрся в ограничение, — а не просто «полоска до края».
            */}
            <div className="flex-1 pb-1">
              <div className="relative h-1.5 bg-hair">
                <div
                  className="absolute inset-y-0 left-0 bg-ink/75 transition-[width] duration-500 ease-linear"
                  style={{ width: `${Math.min(100, (world.speedKmh / topSpeed) * 100)}%` }}
                />
                <div
                  className="absolute -top-1 -bottom-1 w-px bg-accent"
                  style={{ left: `${Math.min(100, (limitKmh / topSpeed) * 100)}%` }}
                  title={`Ограничение участка: ${limitKmh} км/ч`}
                />
              </div>
              <div className="label mt-1.5">
                предел участка {limitKmh}
                {limitReason ? ` · ${limitReason}` : ''}
              </div>
            </div>
          </div>
        ) : null}

        {line && world.stopName ? (
          <RouteStrip
            line={line}
            service={scenario.context?.service ?? ''}
            world={world}
            leadSec={line.dispatch?.medicalLeadSec ?? 300}
          />
        ) : null}

        <div className="grid grid-cols-3 gap-3 pt-0.5">
          <Scale title="Безопасность" value={world.safety} />
          <Scale title="Пассажир" value={world.loyalty} />
          <Scale title="Вагон" value={world.carMood} />
        </div>

        {limit > 0 && remaining !== null ? (
          <div className="flex items-center gap-3 pt-0.5">
            <span className="label shrink-0">На решение</span>
            <div className="h-1.5 bg-hair overflow-hidden flex-1">
              <div
                className={`h-1.5 ${remaining <= limit * 0.34 ? 'bg-danger' : 'bg-accent'}`}
                style={{ width: `${(remaining / limit) * 100}%`, transition: 'width .1s linear' }}
              />
            </div>
            <span
              className={`num text-sm w-28 shrink-0 text-right tabular-nums whitespace-nowrap ${
                remaining <= limit * 0.34 ? 'text-danger' : 'text-ink'
              }`}
              role="timer"
              aria-live="off"
            >
              {remaining.toFixed(0)} с · {kmText(metresIn(world.speedKmh, remaining))}
            </span>
          </div>
        ) : null}

        {stressed ? (
          <p className="label text-danger" role="status">
            Высокий стресс: видны не все варианты
          </p>
        ) : null}
      </div>
    </header>
  )
}

function Scale({ title, value }: { title: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label truncate">{title}</span>
        <span className="num text-xs text-faint">{Math.round(value)}</span>
      </div>
      <Meter value={value} tone={toneFor(value)} height="h-1.5" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Узел
// ---------------------------------------------------------------------------

export function NodeView({
  scenario, node, world, speedKmh, stressed, revealed, onReveal, onChoice, onMulti,
  leg, speech, onLeaveSpeech
}: {
  scenario: Scenario
  node: ScenarioNode
  world: World
  speedKmh: number
  stressed: boolean
  revealed: boolean
  onReveal: () => void
  onChoice: (id: string) => void
  onMulti: (ids: string[]) => void
  leg?: LegState
  speech?: boolean
  onLeaveSpeech?: () => void
}) {
  const available = (node.choices ?? []).filter((c) => meetsRequires(c.requires, world))
  const hidden = stressed && !revealed
    ? Math.max(0, available.length - ENGINE.TUNNEL_VISION_KEEP)
    : 0
  const shown = hidden ? available.slice(0, ENGINE.TUNNEL_VISION_KEEP) : available

  // Цифры выбирают вариант. Под таймером мышь — лишнее движение,
  // а на защите так удобнее вести демонстрацию.
  useEffect(() => {
    if (MULTI_TYPES.has(node.type)) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > shown.length) return
      e.preventDefault()
      onChoice(shown[n - 1].id)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [node, shown, onChoice])

  return (
    <article className="flex flex-col gap-5 animate-rise">
      <div className="flex flex-col gap-2">
        {node.speaker ? <Label>{node.speaker}</Label> : null}
        <p className="stage-text text-lg sm:text-xl leading-snug max-w-[55ch]">{node.text}</p>
        {node.hint && !scenario.examMode ? (
          <p className="text-sm text-faint border-l-2 border-hair pl-3 max-w-[62ch]">{node.hint}</p>
        ) : null}
      </div>

      {MULTI_TYPES.has(node.type) ? (
        node.type === 'spatial'
          ? <SpatialNode node={node} onSubmit={onMulti} />
          : <MultiNode node={node} world={world} onSubmit={onMulti} />
      ) : speech && leg && onLeaveSpeech ? (
        <Speech leg={leg} onGiveUp={onLeaveSpeech} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((c, i) => (
            <ChoiceButton
              key={c.id}
              choice={c}
              index={i + 1}
              speedKmh={speedKmh}
              onPick={() => onChoice(c.id)}
            />
          ))}
          {hidden ? (
            <button className="btn self-start" onClick={onReveal}>
              Показать все варианты · +{ENGINE.REVEAL_SEC} с рейса ({hidden})
            </button>
          ) : null}
          {shown.length > 1 ? (
            <p className="label pt-1">
              Клавиши 1–{shown.length} выбирают вариант · слева от текста — цена в секундах рейса
            </p>
          ) : null}
        </div>
      )}
    </article>
  )
}

/**
 * Вариант выбора.
 *
 * Рядом с ценой в секундах — она же в метрах пути. Это и есть «цена секунды»
 * в буквальном виде: двенадцать секунд на трёхстах шестидесяти километрах
 * в час — это тысяча двести метров, которые состав пройдёт, пока вы говорите.
 */
function ChoiceButton({
  choice, index, speedKmh, onPick
}: { choice: Choice; index: number; speedKmh: number; onPick: () => void }) {
  const cost = choice.costSec ?? 0
  return (
    <button
      className="card text-left p-3.5 flex items-start gap-4 hover:border-accent hover:bg-accent-soft transition-colors"
      onClick={onPick}
    >
      <span className="num text-xs w-5 h-5 shrink-0 grid place-items-center border border-hair text-faint">
        {index}
      </span>
      <span className="shrink-0 w-16 pt-0.5">
        <span className="num text-xs text-accent block">{seconds(cost)}</span>
        {speedKmh > 0 ? (
          <span className="num text-[0.68rem] text-faint block">
            {kmText(metresIn(speedKmh, cost))}
          </span>
        ) : null}
      </span>
      <span className="text-[0.95rem] leading-snug">{choice.text}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Сцена целиком
// ---------------------------------------------------------------------------

/**
 * Игровое поле инцидента: событие мира, узел и нижняя панель.
 * Экран решает, что показывать вместо узла, когда инцидент закончился.
 */
export function Stage({
  scenario, leg, speech, onLeaveSpeech, children, footer
}: {
  scenario: Scenario
  leg: LegState
  speech?: boolean
  onLeaveSpeech?: () => void
  children?: React.ReactNode
  footer?: React.ReactNode
}) {
  const world = leg.world
  if (!world) return null

  return (
    <main className="stage flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 flex flex-col justify-center gap-6">
      {leg.lastEvent && !leg.finished ? (
        <div
          className="border-l-2 border-accent bg-accent-soft px-3 py-2 text-sm animate-rise"
          role="status"
          aria-live="polite"
        >
          <span className="num text-xs text-faint mr-2">{mmss(leg.lastEvent.at)}</span>
          {leg.lastEvent.toast || leg.lastEvent.redirect?.why}
        </div>
      ) : null}

      {children ?? (leg.node ? (
        <NodeView
          // Ключ по узлу обязателен: без него React переиспользует компонент,
          // и отметки предыдущего узла с множественным выбором остаются
          // на следующем — игрок отправил бы чужой выбор, не заметив этого.
          key={leg.cursor}
          scenario={scenario}
          node={leg.node}
          world={world}
          speedKmh={world.speedKmh}
          stressed={leg.stressed}
          revealed={leg.revealed}
          onReveal={leg.reveal}
          onChoice={leg.choose}
          onMulti={leg.chooseMany}
          leg={leg}
          speech={speech}
          onLeaveSpeech={onLeaveSpeech}
        />
      ) : null)}

      {footer}
    </main>
  )
}

/** Нижняя панель инцидента: вдох и выход. */
export function LegFooter({
  leg, onQuit, quitLabel = 'Прервать', speech, onToggleSpeech
}: {
  leg: LegState
  onQuit: () => void
  quitLabel?: string
  speech?: boolean
  onToggleSpeech?: () => void
}) {
  const world = leg.world
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 hairline">
      <button
        className="btn"
        onClick={leg.breathe}
        disabled={!world || world.stress <= 5 || leg.breathUsedHere}
        title={
          leg.breathUsedHere
            ? 'На одном узле вдох делается один раз'
            : 'Снимает 20 стресса и стоит 4 секунды рейса'
        }
      >
        {leg.breathUsedHere ? 'Вдох сделан' : `Вдох · −20 стресса · +${ENGINE.BREATH_SEC} с`}
      </button>
      <div className="flex items-center gap-2">
        {onToggleSpeech ? (
          <button
            className={`btn ${speech ? 'border-accent text-accent' : ''}`}
            onClick={onToggleSpeech}
            title="Отвечать своими словами вместо выбора из вариантов"
          >
            {speech ? 'Своими словами' : 'Кнопками'}
          </button>
        ) : null}
        <button className="btn" onClick={onQuit}>{quitLabel}</button>
      </div>
    </div>
  )
}
