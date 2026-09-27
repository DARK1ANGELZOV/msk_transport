import { getLine, trainState } from './line.js'

/**
 * Словарь предметной области: компетенции, шкалы, константы движка.
 *
 * Файл общий для клиента и сервера. Всё, что влияет на оценку, живёт здесь
 * и в соседних файлах ядра — ни одна цифра результата не приходит из интерфейса
 * и ни одна не приходит от языковой модели. Оценка должна быть воспроизводимой:
 * тот же путь с теми же таймингами обязан дать тот же результат через год,
 * иначе её нельзя класть в допуск к работе.
 */

/** Компетенции. Порядок фиксирован: по нему рисуется лепестковая диаграмма. */
export const COMPETENCIES = [
  { id: 'safety', title: 'Безопасность и регламент', short: 'Безопасность' },
  { id: 'deescalation', title: 'Деэскалация конфликта', short: 'Деэскалация' },
  { id: 'medical', title: 'Медицинская готовность', short: 'Медицина' },
  { id: 'comms', title: 'Коммуникация и доклад', short: 'Коммуникация' },
  { id: 'empathy', title: 'Сервис и эмпатия', short: 'Эмпатия' },
  { id: 'speed', title: 'Скорость решения', short: 'Скорость' },
  { id: 'foreign', title: 'Иностранный пассажир', short: 'Иностранцы' }
]

export const COMPETENCY_IDS = COMPETENCIES.map((c) => c.id)

export const competencyTitle = (id) =>
  COMPETENCIES.find((c) => c.id === id)?.title ?? id

/** Видимые шкалы состояния мира. Стресс скрыт от игрока до разбора. */
export const SCALES = [
  { id: 'safety', title: 'Безопасность', hint: 'Соответствие требованиям безопасности и СОП' },
  { id: 'loyalty', title: 'Лояльность пассажира', hint: 'Отношение конкретного человека' },
  { id: 'carMood', title: 'Настроение вагона', hint: 'Отношение остальных пассажиров' }
]

export const SCALE_IDS = ['safety', 'loyalty', 'carMood', 'stress']

/**
 * Узлы, где игрок отмечает элементы, а не выбирает одну ветку: переход задан
 * на самом узле. Сюда же относится `spatial` — клик по схеме вагона.
 * Его цели описаны теми же элементами, только с координатами: одна механика
 * оценки на все формы ввода, и новый тип узла добавляется одним рендерером.
 */
export const MULTI_TYPES = new Set(['checklist', 'radio', 'sort', 'spatial'])
export const TERMINAL_TYPES = new Set(['outcome'])

export const ENGINE = {
  /** Пропуск хода: время считается по лимиту узла, плюс наказание стрессом. */
  TIMEOUT_STRESS: 15,
  /** «Вдох»: цена в секундах рейса и сколько снимает стресса. */
  BREATH_SEC: 4,
  BREATH_STRESS: -20,
  /** Порог, за которым интерфейс сужается (туннельное зрение). */
  TUNNEL_VISION_AT: 70,
  /** Сколько вариантов остаётся видимыми при туннельном зрении. */
  TUNNEL_VISION_KEEP: 2,
  /** Цена раскрытия скрытых вариантов, секунд рейса. */
  REVEAL_SEC: 3,
  /**
   * Цена непонятой реплики в свободном разговоре.
   *
   * Пассажир переспрашивает — и это стоит времени, как в жизни. Ноль здесь
   * означал бы, что говорить наугад бесплатно, и весь режим превратился бы
   * в перебор формулировок.
   */
  RETRY_SEC: 3,
  /** Человек не читает узел быстрее этого. Ниже — подделка тайминга. */
  MIN_DELIBERATE_MS: 250,
  /**
   * Допуск на расхождение суммы раздумий и интервала начало–конец, мс.
   *
   * Раздумье — это часть реального времени прохождения, поэтому интервал
   * обязан быть не меньше суммы раздумий. Допуск нужен только на расхождение
   * часов клиента и сервера и на округления: свёрнутая вкладка растит
   * интервал, а не сумму, то есть ошибается в безопасную сторону.
   */
  CLOCK_TOLERANCE_MS: 5_000,
  /** Сколько шагов подряд ниже MIN_DELIBERATE_MS считаем ошибкой, а не случайностью. */
  FAST_STEPS_ALLOWED: 1
}

/**
 * Веса итогового балла.
 *
 * Балл — вторичен по отношению к профилю компетенций, но он нужен рейтингу,
 * поэтому формула зафиксирована и открыта: игрок должен понимать, за что
 * ему начислено. Безопасность весит вдвое: это единственная шкала,
 * провал по которой не компенсируется ничем.
 */
export const SCORE_WEIGHTS = {
  safety: 2,
  loyalty: 1,
  carMood: 1,
  /** Максимум за отсутствие потерянного времени. */
  time: 100,
  /** Максимум за совпадение с эталонным путём по СОП. */
  sop: 100,
  /**
   * Вклад компетенций в балл.
   *
   * Без него балл жил отдельной жизнью от профиля: шкалы упираются в сто,
   * и неполный доклад, стоивший минус восемнадцать безопасности, полностью
   * залечивался следующими начислениями — в рейтинге он не стоил ничего.
   * Теперь балл — свёртка того же, что показывает лепестковая диаграмма,
   * а не отдельная валюта.
   */
  competency: 0.5
}

/**
 * Порог допуска к работе.
 *
 * Это не свойство продукта, а политика перевозчика: числа обязаны быть
 * в одном месте, объявлены вслух и одинаковы во всех кабинетах. Здесь
 * они и лежат — руководителю показывается ровно эта формулировка,
 * а не «система посчитала».
 *
 * Безопасность вынесена отдельным порогом: остальные компетенции
 * компенсируют друг друга, эта — нет.
 */
export const READINESS = {
  minRuns: 5,
  minSafety: 55,
  minAny: 40
}

export const READINESS_TEXT =
  `не меньше ${READINESS.minRuns} зачётных рейсов, безопасность от ${READINESS.minSafety}, ` +
  `ни одна компетенция ниже ${READINESS.minAny}`

/**
 * Три состояния вместо двух.
 *
 * Бинарное «допуск / не допуск» бесполезно инструктору: оно не говорит,
 * до кого осталось два шага, а до кого двадцать. «Почти» — это те,
 * у кого держится безопасность и просела ровно одна компетенция.
 */
export function readiness(competency, runs) {
  const values = Object.values(competency ?? {})
  if (!values.length || runs < READINESS.minRuns) return 'practice'
  const safety = competency.safety ?? 0
  if (safety < READINESS.minSafety) return 'practice'
  const below = values.filter((v) => v < READINESS.minAny).length
  if (below === 0) return 'ready'
  return below === 1 ? 'near' : 'practice'
}

export const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))

export const emptyCompetency = () =>
  Object.fromEntries(COMPETENCY_IDS.map((id) => [id, 0]))

/**
 * Стартовое состояние мира сценария: шкалы, флаги, связь, положение состава.
 *
 * `carry` — то, что пришло из предыдущего инцидента рейса. Переносятся только
 * настроение вагона, стресс и флаги: это те же пассажиры и тот же проводник.
 * Лояльность и безопасность начинаются заново — в следующем инциденте другой
 * человек, а соответствие регламенту меряется в каждом эпизоде отдельно.
 * Подробное обоснование — в engine/trip.js.
 */
export function initialWorld(scenario, carry = null) {
  const s = scenario.state ?? {}
  const world = {
    safety: s.safety ?? 100,
    loyalty: s.loyalty ?? 60,
    carMood: carry ? clamp(carry.carMood) : (s.carMood ?? 70),
    stress: carry ? clamp(carry.stress) : (s.stress ?? 20),
    comms: scenario.context?.comms !== false,
    flags: [...new Set([...(scenario.context?.flags ?? []), ...(carry?.flags ?? [])])]
  }
  syncPosition(scenario, world, 0)
  return world
}

/**
 * Подтягивает в состояние мира положение состава на секунде рейса.
 *
 * Километр, скорость и время до ближайшей остановки — не поля контента,
 * а следствие профиля движения. Контент задаёт только километр, с которого
 * начинается сценарий; всё остальное считает физика, и разойтись им негде.
 *
 * Сценарий без линии (или с незарегистрированной линией) работает по-старому,
 * на полях `nextStop` и `speedKmh`: у старых сценариев не должно ломаться
 * ничего только оттого, что появилась модель линии.
 */
export function syncPosition(scenario, world, tripSec) {
  const ctx = scenario.context ?? {}
  const line = ctx.line ? getLine(ctx.line) : null
  if (!line) {
    world.km = ctx.km ?? null
    world.speedKmh = ctx.speedKmh ?? 0
    world.toStopSec = ctx.nextStop ? Math.max(0, ctx.nextStop.inMin * 60 - tripSec) : null
    world.stopName = ctx.nextStop?.name ?? null
    world.travelledM = Math.round((world.speedKmh / 3.6) * tripSec)
    return world
  }
  const st = trainState(line, ctx.service, ctx.startKm ?? 0, tripSec, { moving: ctx.moving !== false })
  world.km = st.km
  world.speedKmh = st.speedKmh
  world.travelledM = st.travelledM
  world.clock = st.clock
  world.toStopSec = st.nextStop?.etaSec ?? null
  world.stopName = st.nextStop?.name ?? null
  world.stopDistanceM = st.nextStop?.distanceM ?? null
  world.brakingM = st.brakingM.emergency
  world.dwelling = st.dwelling
  return world
}

/**
 * Условие показа варианта.
 *
 * Намеренно простое: равенство скаляров и наличие флага. Сложные выражения
 * в контенте — это язык программирования внутри JSON, который потом
 * невозможно ни провалидировать, ни объяснить методисту.
 */
export function meetsRequires(requires, world) {
  if (!requires) return true
  for (const [key, want] of Object.entries(requires)) {
    switch (key) {
      case 'flag':
        if (!world.flags.includes(want)) return false
        break
      case 'notFlag':
        if (world.flags.includes(want)) return false
        break
      /**
       * Точка невозврата.
       *
       * Диспетчеру нужно время: согласовать продление стоянки, вызвать
       * бригаду к платформе, довести решение до дежурного по станции.
       * Если до остановки осталось меньше — заказывать уже поздно,
       * и вариант исчезает не по таймеру, а потому что состав прошёл
       * нужный километр. Это и есть цена секунды в чистом виде.
       */
      case 'minLeadSec':
        if (typeof world.toStopSec !== 'number' || world.toStopSec < want) return false
        break
      /** Некоторые действия возможны только на стоянке или на малом ходу. */
      case 'maxSpeedKmh':
        if ((world.speedKmh ?? 0) > want) return false
        break
      case 'minSpeedKmh':
        if ((world.speedKmh ?? 0) < want) return false
        break
      default:
        if (world[key] !== want) return false
    }
  }
  return true
}

/** Применяет эффекты выбора к миру. Шкалы зажимаются в 0..100. */
export function applyEffects(world, effects, competency) {
  if (!effects) return
  for (const id of SCALE_IDS) {
    if (typeof effects[id] === 'number') world[id] = clamp(world[id] + effects[id])
  }
  for (const [k, v] of Object.entries(effects.competency ?? {})) {
    if (typeof v === 'number' && k in competency) competency[k] += v
  }
}

/** Куда может уйти узел: рёбра выборов, узловой переход, таймаут, обход по миру. */
export function edgesOf(node) {
  const out = []
  for (const c of node.choices ?? []) if (c.next) out.push(c.next)
  if (node.next) out.push(node.next)
  if (node.onTimeout) out.push(node.onTimeout)
  if (node.elseGoto) out.push(node.elseGoto)
  return out
}

/** Элементы узла, несущие эффекты: варианты, блоки доклада, пункты списка. */
export function elementsOf(node) {
  return [...(node.choices ?? []), ...(node.blocks ?? []), ...(node.items ?? [])]
}
