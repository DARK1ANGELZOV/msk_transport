/**
 * Типы публичного API ядра.
 *
 * Ядро написано на обычном ESM без сборки: его подключает и Node на сервере,
 * и Vite в браузере. Типы вынесены отдельным файлом, чтобы клиент получил
 * подсказки и проверку, а сервер — ни одного лишнего шага сборки.
 */

export type CompetencyId =
  | 'safety' | 'deescalation' | 'medical' | 'comms' | 'empathy' | 'speed' | 'foreign'

export type ScaleId = 'safety' | 'loyalty' | 'carMood' | 'stress'
export type NodeType = 'dialog' | 'checklist' | 'radio' | 'sort' | 'spatial' | 'outcome'

export interface Effects {
  safety?: number
  loyalty?: number
  carMood?: number
  stress?: number
  competency?: Partial<Record<CompetencyId, number>>
}

export interface Requires {
  comms?: boolean
  flag?: string
  notFlag?: string
  [key: string]: unknown
}

export interface Choice {
  id: string
  text: string
  /** Как проводник может сказать то же самое своими словами. */
  keywords?: string[]
  /** Слова, которые говорят против этого варианта. */
  avoid?: string[]
  costSec?: number
  requires?: Requires
  effects?: Effects
  sop?: string
  feedback?: string
  mentorNote?: string
  next: string
}

/** Элемент множественного выбора: блок доклада, пункт списка, цель на схеме. */
export interface Element {
  id: string
  text: string
  costSec?: number
  requires?: Requires
  effects?: Effects
  /** Только для spatial: доли 0..1 внутри схемы. */
  x?: number
  y?: number
  r?: number
}

export interface ScenarioNode {
  type: NodeType
  speaker?: string
  text?: string
  media?: string
  map?: string
  limitSec?: number
  onTimeout?: string
  onEnter?: Partial<Record<ScaleId, number>> & { comms?: boolean }
  hint?: string
  feedback?: string
  sop?: string
  mentorNote?: string
  choices?: Choice[]
  blocks?: Element[]
  items?: Element[]
  next?: string
  required?: string[]
  correctOrder?: string[]
  orderBonus?: Effects
  partialCredit?: boolean
  slots?: string[]
  requiresWorld?: Requires
  elseGoto?: string
  elseReason?: string
  verdict?: 'good' | 'partial' | 'bad'
  summary?: string
}

export interface ScenarioContext {
  /** Идентификатор линии; всё остальное — километраж, скорость, время до
   *  остановки — считает физика, а не поля контента. */
  line?: string
  service?: string
  startKm?: number
  moving?: boolean
  car?: number
  comms?: boolean
  flags?: string[]
  /** Запасной путь для сценариев без линии. */
  route?: string
  clock?: string
  speedKmh?: number
  km?: number
  nextStop?: { name: string; inMin: number }
}

export interface Station {
  km: number
  name: string
  code?: string
  technical?: boolean
}

export interface LineService {
  id: string
  title: string
  departure: string
  direction?: 'back'
  stops: string[]
}

export interface Line {
  schema: string
  id: string
  title: string
  lengthKm: number
  trainsetTitle?: string
  physics: {
    accelMs2: number
    serviceDecelMs2: number
    emergencyDecelMs2: number
    dwellSec: number
  }
  stations: Station[]
  limits: { toKm: number; kmh: number; why?: string }[]
  services: LineService[]
  dispatch: { medicalLeadSec: number; extendStopLeadSec: number; policeLeadSec: number }
  authoring?: { assumptions?: string; sources?: string[]; updatedAt?: string }
}

export interface TrainState {
  km: number
  speedKmh: number
  dwelling: boolean
  travelledM: number
  direction: 'forward' | 'back'
  clock: string
  elapsedSec: number
  remainingSec: number
  nextStop: { name: string; code?: string; km: number; distanceM: number; etaSec: number } | null
  brakingM: { service: number; emergency: number }
}

export interface WorldEvent {
  atElapsedSec?: number
  set?: Record<string, unknown>
  toast?: string
  goto?: string | null
}

export interface Scenario {
  schema: string
  id: string
  version: number
  status: 'draft' | 'published' | 'archived'
  title: string
  summary?: string
  mode?: string
  difficulty?: number
  estimatedSec?: number
  context?: ScenarioContext
  competencies?: CompetencyId[]
  state?: Partial<Record<ScaleId, number>>
  entry: string
  reference?: string[]
  worldEvents?: WorldEvent[]
  nodes: Record<string, ScenarioNode>
  authoring?: { author?: string; sop?: string[]; assumptions?: string; updatedAt?: string }
  examMode?: boolean
}

export interface World {
  safety: number
  loyalty: number
  carMood: number
  stress: number
  comms: boolean
  flags: string[]
  /** Положение состава: подтягивается физикой линии на каждой секунде рейса. */
  km: number | null
  speedKmh: number
  travelledM: number
  toStopSec: number | null
  stopName: string | null
  stopDistanceM?: number | null
  brakingM?: number
  clock?: string
  dwelling?: boolean
}

export interface PathStep {
  node: string
  choice?: string
  choices?: string[]
  timeout?: boolean
  deliberateMs?: number
  /** Свободная реплика, если играли голосом, а не кнопками. */
  said?: string
}

export interface RunPath {
  startedAt?: string
  finishedAt?: string
  steps: PathStep[]
  breaths?: { afterStep: number }[]
  /** Шаги, на которых игрок раскрывал скрытые варианты при туннельном зрении. */
  reveals?: { atStep: number }[]
  /** Непонятые реплики: пассажир переспрашивал, и это стоило секунд рейса. */
  retries?: { atStep: number; said: string }[]
}

export interface VisitedEntry {
  node: string
  type: NodeType
  atTripSec: number
  thinkSec: number
  costSec: number
  timeout: boolean
  picked: { id: string; text: string; effects: Effects }[]
  feedback: string
  sop: string
  mentorNote: string
  stressBefore: number
  stressAfter: number
  world: World
  next: string
  breath?: boolean
  revealed?: boolean
  orderAccuracy?: number
  /** Что было сказано своими словами и почему это отнесли к этому варианту. */
  said?: string
  intent?: { words: string[]; scores: IntentScore[] }
}

export interface IntentHit {
  stem: string
  matched: string
  exact: boolean
  value: number
}

export interface IntentScore {
  id: string
  score: number
  hits: IntentHit[]
}

export interface IntentVerdict {
  choice: string | null
  reason: 'ok' | 'short' | 'unclear' | 'ambiguous'
  words: string[]
  scores: IntentScore[]
}

export interface FiredEvent {
  at: number
  toast: string
  redirect?: { from: string; to: string; why: string }
}

export interface RunResult {
  ok: boolean
  rejected: string[]
  scenarioId: string
  scenarioVersion: number
  world: World
  stressPeak: number
  breathCount: number
  retryCount: number
  competency: Record<CompetencyId, number>
  competencyPct: Partial<Record<CompetencyId, number>>
  tripSec: number
  idealSec: number
  lostSec: number
  window: number
  overdue: boolean
  sopMatched: number
  sopTotal: number
  timeScore: number
  sopScore: number
  competencyScore: number
  score: number
  maxScore: number
  scorePct: number
  achievements: string[]
  visited: VisitedEntry[]
  events: FiredEvent[]
  firedEvents: number[]
  verdict: 'good' | 'partial' | 'bad' | 'rejected' | 'unfinished'
  outcome: { text: string; summary: string } | null
}

export interface Analysis {
  maxScore: number
  minScore: number
  maxCompetency: Record<CompetencyId, number>
  idealSec: number
  window: number
  paths: number
  truncated: boolean
}

export interface ValidationReport {
  ok: boolean
  errors: string[]
  warnings: string[]
  nodes: number
}

export interface Recommendation {
  scenarioId: string
  title: string
  kind: 'repeat' | 'weakness' | 'weakness-again' | 'new'
  priority: number
  reason: string
}

export declare const COMPETENCIES: { id: CompetencyId; title: string; short: string }[]
export declare const COMPETENCY_IDS: CompetencyId[]
export declare const SCALES: { id: string; title: string; hint: string }[]
export declare const MULTI_TYPES: Set<string>
export declare const TERMINAL_TYPES: Set<string>
export declare const ENGINE: {
  TIMEOUT_STRESS: number
  BREATH_SEC: number
  BREATH_STRESS: number
  TUNNEL_VISION_AT: number
  TUNNEL_VISION_KEEP: number
  REVEAL_SEC: number
  RETRY_SEC: number
  MIN_DELIBERATE_MS: number
  CLOCK_TOLERANCE_MS: number
  FAST_STEPS_ALLOWED: number
}
export interface TripLeg { scenario: string; lead?: string }

export interface TripDoc {
  schema: string
  id: string
  title: string
  summary?: string
  line: string
  service: string
  car?: number
  difficulty?: number
  briefing?: string
  legs: TripLeg[]
}

export interface RecoveryChange {
  gapSec: number
  carMood: [number, number]
  stress: [number, number]
  fatigueFloor: number
}

export interface Carry { carMood: number; stress: number; flags: string[] }

export interface TripResult {
  ok: boolean
  tripId: string
  rejected: string[]
  legs: { scenarioId: string; version: number; title: string; run: RunResult }[]
  gaps: (RecoveryChange & { index: number; fromKm?: number; toKm?: number })[]
  score: number
  maxScore: number
  minScore: number
  scorePct: number
  competency: Record<CompetencyId, number>
  competencyPct: Partial<Record<CompetencyId, number>>
  tripSec: number
  lostSec: number
  stressPeak: number
  sopMatched: number
  sopTotal: number
  safetyAvg: number
  verdicts: string[]
  achievements: string[]
}

export declare const TRIP: {
  carMood: { baseline: number; tauMin: number; maxShare: number }
  stress: { baseline: number; tauMin: number; maxShare: number; fatiguePerLeg: number }
  minGapSec: number
}
export declare const TRIP_ACHIEVEMENTS: {
  id: string; title: string; condition: string; icon: string
}[]
export declare function recover(
  carry: Carry, gapSec: number, legIndex?: number
): { carry: Carry; change: RecoveryChange }
export declare function gapBetween(
  line: Line, serviceId: string, fromKm: number, toKm: number
): number
export declare function gradeTrip(
  trip: TripDoc, scenarios: Record<string, Scenario>, tripPath: { legs: RunPath[] },
  context?: Record<string, unknown>
): TripResult

export declare const READINESS: { minRuns: number; minSafety: number; minAny: number }
export declare const READINESS_TEXT: string
export declare function readiness(
  competency: Partial<Record<CompetencyId, number>>, runs: number
): 'ready' | 'near' | 'practice'
export declare const HALF_LIFE_DAYS: number
export declare const BOXES: number[]

export declare function competencyTitle(id: string): string
export declare function clamp(v: number, lo?: number, hi?: number): number
export declare function initialWorld(scenario: Scenario, carry?: Carry | null): World
export declare function syncPosition(scenario: Scenario, world: World, tripSec: number): World

export declare function registerLine(doc: Line): Line | null
export declare function getLine(id: string): Line | null
export declare function knownLines(): Line[]
export declare function trainState(
  line: Line, serviceId: string | undefined, startKm: number, tripSec: number,
  options?: { moving?: boolean }
): TrainState
export declare function brakingDistanceM(
  speedKmh: number, line: Line, mode?: 'service' | 'emergency'
): number
export declare function metresIn(speedKmh: number, sec: number): number
export declare function leadBoundaryKm(
  line: Line, serviceId: string | undefined, stopKm: number, leadSec: number
): number | null
export declare function clockAt(departure: string | undefined, sec: number): string
export declare function meetsRequires(requires: Requires | undefined, world: World): boolean
export declare function edgesOf(node: ScenarioNode): string[]
export declare function elementsOf(node: ScenarioNode): Element[]
export declare function stem(word: string): string
export declare function stems(text: string): string[]
export declare function classify(
  node: ScenarioNode, said: string, available?: Choice[]
): IntentVerdict
export declare const INTENT_REASON: Record<string, string>
export declare const ENGINE_INTENT: {
  MIN_SCORE: number; MARGIN: number; MIN_WORDS: number
  TEXT_WEIGHT: number; KEYWORD_WEIGHT: number; AVOID_PENALTY: number
  PREFIX_MIN: number; PREFIX_WEIGHT: number
}

export declare function advanceWorld(
  scenario: Scenario, world: World, until: number, fired: Set<number>, log: FiredEvent[]
): void
export declare function resolveNode(
  scenario: Scenario, cursor: string, world: World, limit?: number
): { cursor: string; redirects: { from: string; to: string; why: string }[] }
export declare function replay(
  scenario: Scenario, path: RunPath, options?: { strict?: boolean; carry?: Carry | null }
): RunResult
export declare function grade(
  scenario: Scenario, path: RunPath,
  context?: {
    strict?: boolean; runsTotal?: number; streakDays?: number
    duelsReviewed?: number; carry?: Carry | null
  }
): RunResult
export declare function analyze(scenario: Scenario, options?: { cache?: boolean }): Analysis
export declare function clearAnalysisCache(): void
export declare function competencyPercent(
  scenario: Scenario, competency: Record<string, number>
): Partial<Record<CompetencyId, number>>
export declare function scorePercent(scenario: Scenario, score: number): number
export declare function validate(scenario: unknown): ValidationReport
export declare function idealTripSec(scenario: Scenario): number
export declare function tripWindow(scenario: Scenario): number
export declare function referencePairs(scenario: Scenario): Map<string, string>
export declare function recommend(
  scenarios: { id: string; title: string; competencies?: CompetencyId[]; difficulty?: number }[],
  profile: { competency?: Partial<Record<CompetencyId, number>> },
  srs: { scenarioId: string; box: number; dueAt: number; lastScorePct?: number }[],
  now?: number
): Recommendation[]
export declare function nextBox(box: number, scorePct: number): number
export declare function dueAfter(box: number): number
export declare function streakDays(dates: (number | string)[], now?: number): number
export declare const ACHIEVEMENTS: {
  id: string; title: string; condition: string; icon: string
  check: (ctx: unknown) => boolean
}[]
export declare function achievementById(
  id: string
): { id: string; title: string; condition: string; icon: string } | null
