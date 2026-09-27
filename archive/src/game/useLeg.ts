import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ENGINE, INTENT_REASON, TERMINAL_TYPES, advanceWorld, classify, initialWorld,
  meetsRequires, replay, resolveNode,
  type FiredEvent, type IntentVerdict, type PathStep, type RunPath, type Scenario,
  type ScenarioNode, type World
} from '../../engine/index.js'

export interface Carry {
  carMood: number
  stress: number
  flags: string[]
}

export interface LegState {
  node: ScenarioNode | undefined
  cursor: string
  world: World | null
  finished: boolean
  outcome: ScenarioNode | null
  remaining: number | null
  stressed: boolean
  lastEvent: FiredEvent | null
  breathUsedHere: boolean
  revealed: boolean
  path: RunPath
  /** Сколько раз на этом узле пассажир переспросил. */
  retriesHere: number
  /** Последняя непонятая реплика и почему её не поняли. */
  misheard: { said: string; reason: string } | null
  choose: (id: string) => void
  /** Свободная реплика: распознаётся тем же кодом, что и на сервере. */
  say: (text: string) => IntentVerdict
  chooseMany: (ids: string[]) => void
  breathe: () => void
  reveal: () => void
}

/**
 * Состояние одного инцидента: где мы в графе, что показывать, куда идти дальше.
 *
 * Вынесено из экрана, потому что инцидент играется в двух местах — отдельно
 * и внутри смены, — и это должен быть один и тот же код. Иначе рейс и одиночный
 * режим разойдутся в мелочах, а разошедшись, начнут по-разному считать время.
 *
 * Хук ничего не отправляет на сервер: он только ведёт путь и сообщает наружу,
 * когда инцидент закончился. Что делать с этим путём — решает экран.
 */
export function useLeg(
  scenario: Scenario | null,
  carry: Carry | null,
  onFinish?: (path: RunPath, outcome: ScenarioNode, world: World) => void
): LegState {
  const [steps, setSteps] = useState<PathStep[]>([])
  const [breaths, setBreaths] = useState<{ afterStep: number }[]>([])
  const [reveals, setReveals] = useState<{ atStep: number }[]>([])
  const [retries, setRetries] = useState<{ atStep: number; said: string }[]>([])
  const [misheard, setMisheard] = useState<{ said: string; reason: string } | null>(null)
  const [revealedHere, setRevealedHere] = useState(false)
  const [thinkSec, setThinkSec] = useState(0)
  const [startedAt] = useState(() => new Date().toISOString())

  const shownAt = useRef(0)
  const reported = useRef(false)

  const sim = useMemo(
    () => (scenario
      ? replay(scenario, { steps, breaths, reveals, retries }, { strict: false, carry })
      : null),
    [scenario, steps, breaths, reveals, retries, carry]
  )

  const world: World | null = useMemo(() => {
    if (!scenario) return null
    const last = sim?.visited.at(-1)
    return last ? last.world : initialWorld(scenario, carry)
  }, [scenario, sim, carry])

  /**
   * Мир на текущую секунду раздумья: состояние после последнего шага,
   * продвинутое вперёд тем же кодом, который отработает при фиксации шага.
   * Поэтому вариант, исчезающий на глазах у игрока, исчезает и в пересчёте
   * на сервере — расходиться нечему.
   */
  const live = useMemo(() => {
    if (!scenario || !world) return { world, events: [] as FiredEvent[] }
    const copy: World = { ...world, flags: [...world.flags] }
    const log: FiredEvent[] = []
    const fired = new Set<number>(sim?.firedEvents ?? [])
    advanceWorld(scenario, copy, (sim?.tripSec ?? 0) + thinkSec, fired, log)
    return { world: copy, events: log }
  }, [scenario, world, sim, thinkSec])

  const rawCursor = sim?.visited.at(-1)?.next ?? scenario?.entry ?? ''
  const cursor = scenario && world ? resolveNode(scenario, rawCursor, world).cursor : rawCursor
  const node = scenario?.nodes[cursor]
  const finished = Boolean(node && TERMINAL_TYPES.has(node.type))

  const commit = useCallback((step: Omit<PathStep, 'node' | 'deliberateMs'>) => {
    if (!node || finished) return
    const think = Math.max(0, performance.now() - shownAt.current)
    setSteps((prev) => [...prev, {
      node: cursor,
      deliberateMs: step.timeout ? undefined : Math.round(think),
      ...step
    }])
    setRevealedHere(false)
    setMisheard(null)
  }, [cursor, node, finished])

  /**
   * Ход времени. Тикер один и работает всегда, а не только когда у узла есть
   * лимит: поезд едет, пока проводник читает реплику, и приборы обязаны это
   * показывать. Из накопленного раздумья выводятся и обратный отсчёт,
   * и положение состава на полосе маршрута.
   */
  useEffect(() => {
    shownAt.current = performance.now()
    setThinkSec(0)
    if (finished || !node) return undefined
    const limit = node.limitSec ?? 0
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - shownAt.current) / 1000
      setThinkSec(elapsed)
      if (limit > 0 && elapsed >= limit) {
        window.clearInterval(id)
        commit({ timeout: true })
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [cursor, node, finished, commit])

  const path: RunPath = useMemo(
    () => ({ startedAt, finishedAt: new Date().toISOString(), steps, breaths, reveals, retries }),
    [startedAt, steps, breaths, reveals, retries]
  )

  useEffect(() => {
    if (!finished || !node || !world || reported.current) return
    reported.current = true
    // Наружу уходит и мир после инцидента: смене нужно, что переносить дальше.
    onFinish?.(path, node, world)
  }, [finished, node, world, path, onFinish])

  const shown = live.world ?? world

  return {
    node,
    cursor,
    world: shown,
    finished,
    outcome: finished ? (node ?? null) : null,
    remaining: node?.limitSec ? Math.max(0, node.limitSec - thinkSec) : null,
    stressed: (shown?.stress ?? 0) >= ENGINE.TUNNEL_VISION_AT,
    lastEvent: [...(sim?.events ?? []), ...live.events].at(-1) ?? null,
    breathUsedHere: breaths.some((b) => b.afterStep === steps.length - 1),
    revealed: revealedHere,
    path,
    retriesHere: retries.filter((r) => r.atStep === steps.length).length,
    misheard,
    choose: (id) => commit({ choice: id }),
    /**
     * Свободная реплика.
     *
     * Распознаётся здесь тем же кодом, который отработает на сервере, —
     * поэтому засчитанное на экране будет засчитано и в базе. Непонятая
     * реплика не теряется: она уходит в путь как переспрос и стоит секунд
     * рейса, как переспрос пассажира в жизни.
     */
    say: (text: string) => {
      const empty: IntentVerdict = { choice: null, reason: 'short', words: [], scores: [] }
      if (!node || !shown || finished) return empty
      const available = (node.choices ?? []).filter((c) => meetsRequires(c.requires, shown))
      const verdict = classify(node, text, available)
      if (verdict.choice) {
        setMisheard(null)
        commit({ choice: verdict.choice, said: text.trim().slice(0, 400) })
      } else {
        setRetries((prev) => [...prev, { atStep: steps.length, said: text.trim().slice(0, 400) }])
        setMisheard({ said: text.trim(), reason: INTENT_REASON[verdict.reason] ?? 'Не понял.' })
      }
      return verdict
    },
    chooseMany: (ids) => commit({ choices: ids }),
    breathe: () => setBreaths((prev) => [...prev, { afterStep: steps.length - 1 }]),
    reveal: () => {
      setRevealedHere(true)
      setReveals((prev) => [...prev, { atStep: steps.length }])
    }
  }
}
