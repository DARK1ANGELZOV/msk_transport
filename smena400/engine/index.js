/**
 * Точка входа в ядро.
 *
 * Ядро не знает ни про HTTP, ни про базу, ни про React — это обычные функции
 * над данными. Благодаря этому одна и та же логика выполняется на сервере,
 * в тестах и в валидаторе контента, и нигде не расходится.
 */
export {
  SCALES, SCALE_IDS, SCALE_MIN, SCALE_MAX, clamp,
  COMPETENCIES, COMPETENCY_IDS, competencyTitle, emptyCompetency,
  ACTION_KINDS, TRIP_STAGES, SERVICE_CLASSES, URGENCY,
  VERDICTS, verdictTitle
} from './model.js'

export {
  startSession, currentState, availableActions, step,
  remainingMs, isFinished, CLOCK_GRACE_MS
} from './machine.js'

export { classify, stem, stems, buildIndex, INTENT, INTENT_REASON } from './intent.js'

export { debrief, compareAttempts } from './feedback.js'

export { rewindTo, rewindPoints } from './rewind.js'

export { validate, edgesOf } from './validate.js'
