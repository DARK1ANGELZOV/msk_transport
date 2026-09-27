/**
 * Тонкий слой над fetch.
 *
 * Сессия живёт в HttpOnly-куке, поэтому здесь нет ни токенов, ни заголовков
 * авторизации: браузер отправляет куку сам, а скрипт страницы её не видит.
 */
import type {
  Analysis, CompetencyId, Line, Recommendation, RunPath, RunResult, Scenario,
  TripDoc, TripResult, ValidationReport
} from '../../engine/index.js'


export interface User {
  id: string
  login: string
  name: string
  role: 'conductor' | 'methodist' | 'manager'
  depot: string
  brigade: string
  tabNumber: string
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    throw new ApiError('сервер вернул не JSON', res.status)
  }
  const body = data as { ok?: boolean; error?: string }
  if (!res.ok || body?.ok === false) {
    throw new ApiError(body?.error ?? `ошибка ${res.status}`, res.status)
  }
  return data as T
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

// ------------------------------------------------------------------- вход

export const api = {
  me: () => call<{ user: User | null }>('/api/me'),
  login: (login: string, password: string) => post<{ user: User }>('/api/login', { login, password }),
  logout: () => post<{ ok: true }>('/api/logout'),

  // --------------------------------------------------------------- рейсы
  scenarios: () => call<{ scenarios: ScenarioCard[] }>('/api/scenarios'),
  scenario: (id: string, mode: string) =>
    call<{ scenario: Scenario; line: Line | null }>(
      `/api/scenarios/${encodeURIComponent(id)}?mode=${mode}`
    ),
  submitRun: (payload: { scenarioId: string; scenarioVersion: number; mode: string; path: RunPath }) =>
    post<SubmitResponse>('/api/runs', payload),
  run: (id: string) => call<DebriefResponse>(`/api/runs/${encodeURIComponent(id)}`),
  /** Разбор любого прохождения: сервер сам решает, отдать инцидент или смену. */
  anyRun: (id: string) =>
    call<DebriefResponse | TripDebriefResponse>(`/api/runs/${encodeURIComponent(id)}`),

  // ---------------------------------------------------------------- смена
  trips: () => call<{ trips: TripCard[] }>('/api/trips'),
  trip: (id: string) => call<TripPackage>(`/api/trips/${encodeURIComponent(id)}`),
  submitTrip: (payload: { tripId: string; path: { startedAt: string; finishedAt: string; legs: RunPath[] } }) =>
    post<TripSubmitResponse>('/api/trip-runs', payload),

  // ------------------------------------------------------------- профиль
  profile: () => call<ProfileResponse>('/api/profile'),
  leaderboard: (season?: string) =>
    call<LeaderboardResponse>(`/api/leaderboard${season ? `?season=${season}` : ''}`),

  // ------------------------------------------------------------ методист
  methodistScenarios: () => call<{ versions: ScenarioVersionRow[] }>('/api/methodist/scenarios'),
  methodistScenario: (id: string) =>
    call<{ scenario: Scenario; analysis: Analysis }>(`/api/methodist/scenarios/${encodeURIComponent(id)}`),
  publishScenario: (scenario: unknown) =>
    post<{ scenario: Scenario; report: ValidationReport }>('/api/methodist/publish', { scenario }),
  graphStats: (id: string) => call<GraphStats>(`/api/methodist/stats/${encodeURIComponent(id)}`),

  // -------------------------------------------------------- руководитель
  overview: () => call<ManagerOverview>('/api/manager/overview')
}

// ------------------------------------------------------------------ типы

export interface ScenarioCard {
  id: string
  version: number
  title: string
  summary: string
  mode: string
  difficulty: number
  competencies: CompetencyId[]
  estimatedSec?: number
  context?: Scenario['context']
  maxScore: number
  /** Обстановка сценария, посчитанная сервером по модели линии. */
  setting: {
    km: number
    speedKmh: number
    stopName: string | null
    toStopSec: number | null
    brakingM: number
    lineTitle: string
  } | null
}

export interface TripCard {
  id: string
  title: string
  summary: string
  difficulty: number
  lineTitle: string
  serviceTitle: string
  legs: number
  ready: boolean
  estimatedSec: number
  fromKm: number
  toKm: number
}

export interface TripPackage {
  trip: TripDoc
  line: Line | null
  gaps: { index: number; fromKm: number; toKm: number; gapSec: number }[]
  scenarios: Scenario[]
}

export interface TripSubmitResponse {
  runId: string
  status: 'scored' | 'disputed'
  result: TripResult
  freshAchievements: string[]
}

export interface TripDebriefResponse {
  run: StoredRun
  trip: TripDoc
  line: Line | null
  scenarios: Scenario[]
  annotations: Record<string, Annotations>
  references: Record<string, string[]>
}

export interface SubmitResponse {
  runId: string
  status: 'scored' | 'disputed'
  result: RunResult
  freshAchievements: string[]
  reference: string[]
  annotations: Annotations
}

export type Annotations = Record<string, {
  hint: string
  feedback: string
  sop: string
  mentorNote: string
  choices: Record<string, { feedback: string; sop: string; mentorNote: string }>
}>

export interface StoredRun {
  id: string
  userId: string
  scenarioId: string
  scenarioVersion: number
  mode: string
  status: 'scored' | 'disputed'
  startedAt: number | null
  finishedAt: number | null
  score: number
  maxScore: number
  scorePct: number
  safety: number
  loyalty: number
  carMood: number
  stressPeak: number
  tripSec: number
  lostSec: number
  sopMatched: number
  sopTotal: number
  verdict: string
  competencyPct: Partial<Record<CompetencyId, number>>
  achievements: string[]
  path: RunPath
  rejected: string[]
  createdAt: number
}

export interface DebriefResponse {
  run: StoredRun
  scenario: Scenario
  line: Line | null
  reference: string[]
  annotations: Annotations
  stats: GraphStats | null
}

export interface AchievementCard {
  id: string
  title: string
  condition: string
  icon: string
  owned: boolean
  at: number | null
}

export interface ProfileResponse {
  user: User
  competency: Partial<Record<CompetencyId, number>>
  competencies: { id: CompetencyId; title: string; short: string }[]
  runs: number
  disputed: number
  streak: number
  bestPct: number
  achievements: AchievementCard[]
  history: {
    id: string; scenarioId: string; title: string; mode: string
    status: string; scorePct: number; verdict: string; at: number
  }[]
  next: Recommendation[]
}

export interface LeaderboardResponse {
  season: string
  brigades: {
    depot: string; brigade: string; people: number
    runs: number; avg_pct: number; total: number
  }[]
  personal: {
    id: string; name: string; depot: string; brigade: string
    runs: number; avg_pct: number; best_pct: number; total: number
    achievements: number; mine: boolean
  }[]
}

export interface ScenarioVersionRow {
  id: string
  version: number
  status: string
  title: string
  summary: string
  difficulty: number
  created_at: number
  published_at: number | null
}

export interface GraphStats {
  scenario: { id: string; version: number; title: string }
  nodes: {
    node: string; text: string; type: string; multi: boolean
    total: number; runs: number; onReference: boolean; correctShare: number | null
    choices: { id: string; text: string; count: number; share: number }[]
  }[]
  problems: { node: string; text: string; correctShare: number | null }[]
}

export interface ManagerOverview {
  competencies: { id: CompetencyId; title: string; short: string }[]
  readinessRule: string
  people: {
    id: string; name: string; depot: string; brigade: string; tabNumber: string
    runs: number; lastAt: number | null
    competency: Partial<Record<CompetencyId, number>>
    weakest: CompetencyId | null
    status: 'ready' | 'near' | 'practice'
    ready: boolean
  }[]
  brigades: {
    key: string; depot: string; brigade: string; size: number; ready: number; near: number
    competency: Partial<Record<CompetencyId, number>>
  }[]
}
