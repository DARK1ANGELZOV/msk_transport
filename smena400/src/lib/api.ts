/**
 * Клиент API.
 *
 * Типы здесь описывают ровно то, что сервер соглашается показать. Обратите
 * внимание, чего в них нет: переходов, эффектов будущих действий, списка
 * состояний. Клиент физически не знает, чем кончится ветка, — и это не
 * ограничение реализации, а свойство продукта.
 */

export type ScaleId = 'loyalty' | 'safety'
export type Scales = Record<ScaleId, number>

export interface ScenarioCard {
  id: string
  title: string
  subtitle: string | null
  difficulty: number | null
  context: {
    trip_stage: string | null
    service_class: string | null
    car: string | null
    location: string | null
    urgency: string | null
  }
  source: { document: string; situation: string }
}

export interface ScenarioPassport extends ScenarioCard {
  context: ScenarioCard['context'] & {
    safety_risk?: string
    passenger_profile?: { who?: string; state?: string; mobility?: string }
    constraints?: string[]
    available_resources?: string[]
  }
  source: {
    document: string
    situation: string
    source_reference: string
    normative_rule: string[]
    gameplay_interpretation: string[]
    scenario_rationale: string
  }
  scales: { loyalty: number; safety: number }
}

export interface ActionView {
  id: string
  label: string
  kind: 'choice' | 'say' | 'sequence' | 'escalate' | 'idle'
  note: string | null
}

export interface ResultView {
  actionLabel: string | null
  effects: Partial<Scales>
  consequence: string | null
  timedOut: boolean
  grade: 'correct' | 'partial' | 'wrong' | null
  correctOrder: string[] | null
  events: { note: string; effects: Partial<Scales>; delayed: boolean }[]
  intent: { said: string; via: string | null } | null
}

export interface Screen {
  sessionId: string
  attempt: number
  status: 'active' | 'finished' | 'abandoned'
  scenario: ScenarioCard
  step: number
  scales: Scales
  state: {
    id: string
    kind: 'decision' | 'sequence' | 'final'
    zone: string | null
    speaker: string | null
    text: string
    info: string | null
    freeText: boolean
    verdict: 'good' | 'mixed' | 'bad' | null
    summary: string | null
    rephrased?: boolean
    timer: { totalSec: number; remainingMs: number } | null
  } | null
  actions: ActionView[]
  sequence: { items: { id: string; label: string }[] } | null
  lastResult: ResultView | null
}

export interface Decision {
  step: number
  situation: string
  chosen: {
    label: string
    said: string | null
    effects: Partial<Scales>
    consequence: string | null
    timedOut: boolean
  }
  alternative: {
    label: string
    effects: Partial<Scales>
    consequence: string | null
    outcome_hint: string | null
  } | null
}

export interface Debrief {
  scenario: { id: string; title: string; source: ScenarioPassport['source'] }
  outcome: {
    stateId: string
    verdict: 'good' | 'mixed' | 'bad'
    title: string
    text: string
    summary: string
  }
  scales: { id: ScaleId; title: string; short: string; from: number; to: number; delta: number }[]
  timeline: TimelineItem[]
  decisions: Decision[]
  consequences: { note: string; effects: Partial<Scales>; delayed: boolean; causeLabel: string | null }[]
  strengths: { text: string; step: number | null }[]
  improvements: { text: string; step: number | null }[]
  competency: {
    id: string
    title: string
    hint: string
    earned: number
    max: number
    touched: boolean
    pct: number | null
  }[]
  steps: number
}

export type TimelineItem =
  | {
      type: 'action'
      step: number
      stateText: string
      label: string
      said: string | null
      kind: string
      effects: Partial<Scales>
      scalesAfter: Scales
      consequence: string | null
      normative: boolean
      timedOut: boolean
      thinkMs: number
    }
  | {
      type: 'event' | 'deferred'
      step: number
      note: string
      effects: Partial<Scales>
      scalesAfter: Scales
      causeLabel: string | null
      late: boolean
    }

export interface Comparison {
  scales: { id: ScaleId; title: string; short: string; before: number; after: number; delta: number }[]
  outcomeChanged: boolean
  outcomeBefore: string
  outcomeAfter: string
  changedDecisions: { step: number; situation: string; before: string; after: string }[]
}

export interface Progress {
  runs: number
  scenarios: (ScenarioCard & {
    attempts: number
    lastVerdict: string | null
    lastLoyalty: number | null
    lastSafety: number | null
    best: string | null
  })[]
  competency: { id: string; title: string; hint: string; touched: boolean; pct: number | null }[]
}

export interface Meta {
  scales: { id: ScaleId; title: string; short: string; hint: string }[]
  competencies: { id: string; title: string; hint: string }[]
  ai: { enabled: boolean; provider: string | null; model: string | null; note: string }
}

/** Отказ сервера — это часть игры («так нельзя»), а не сбой связи. */
export class ApiError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...init
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    throw new ApiError('сервер ответил непонятно', 'bad-json', res.status)
  }
  if (!res.ok || data?.ok === false) {
    throw new ApiError(data?.error ?? 'ошибка запроса', data?.code ?? 'error', res.status)
  }
  return data as T
}

const post = <T>(url: string, body?: unknown) =>
  call<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  meta: () => call<Meta>('/api/meta'),
  scenarios: () => call<{ scenarios: ScenarioCard[] }>('/api/scenarios'),
  scenario: (id: string) => call<{ scenario: ScenarioPassport }>(`/api/scenarios/${id}`),
  progress: () => call<Progress>('/api/progress'),

  start: (scenarioId: string) =>
    post<{ screen: Screen }>('/api/sessions', { scenarioId }),

  screen: (id: string) => call<{ screen: Screen }>(`/api/sessions/${id}`),

  act: (id: string, body: { actionId?: string; order?: string[]; timeout?: boolean }) =>
    post<{ screen: Screen; finished: boolean }>(`/api/sessions/${id}/actions`, body),

  say: (id: string, text: string) =>
    post<{ screen?: Screen; finished?: boolean; understood?: boolean; reply?: string; said?: string }>(
      `/api/sessions/${id}/message`, { text }
    ),

  quit: (id: string) => post<{ status: string }>(`/api/sessions/${id}/finish`),

  debrief: (id: string) =>
    call<{
      debrief: Debrief
      attempt: number
      comparison: Comparison | null
      previousAttempt: number | null
    }>(`/api/sessions/${id}/debrief`)
}
