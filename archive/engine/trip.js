/**
 * Рейс: смена целиком, а не отдельный инцидент.
 *
 * Это то, ради чего вообще затевалась авиационная рамка. В LOFT экипаж
 * проходит полёт от вылета до посадки, и главная ценность не в отдельном
 * упражнении, а в том, что решения тянутся друг за другом: раздражённый
 * вагон остаётся раздражённым, усталость накапливается, а телефон,
 * который достали на пятидесятом километре, снимает вас и на четырёхсотом.
 *
 * Рейс — это последовательность инцидентов, расставленных по километрам
 * одной линии. Между ними поезд действительно едет: время считает профиль
 * движения, и за эти минуты вагон немного успокаивается, а стресс спадает.
 *
 * Что переносится между инцидентами и почему именно так:
 *
 *   carMood  — да. Это те же пятьдесят человек в том же вагоне, и они
 *              помнят, как вы разговаривали двадцать минут назад.
 *   stress   — да. Это тот же человек, и он устаёт.
 *   flags    — да. «Вас снимают» не отменяется сменой темы.
 *   loyalty  — нет. В следующем инциденте другой пассажир.
 *   safety   — нет, и это осознанное решение. Безопасность — мера
 *              соответствия регламенту в конкретном инциденте. Если тащить
 *              её через всю смену, ранняя ошибка штрафуется дважды: сначала
 *              своим исходом, потом всеми последующими оценками. По смене
 *              она усредняется и показывается отдельной строкой.
 */
import { COMPETENCY_IDS, clamp, emptyCompetency } from './model.js'
import { grade } from './grade.js'
import { analyze } from './scoring.js'
import { profile, secondAtKm } from './line.js'

/**
 * Параметры восстановления на перегоне.
 *
 * Восстановление асимптотическое и неполное: линейный отход к норме за
 * полчаса обнулял бы всё, и перенос состояния терял смысл — а он и есть
 * суть режима. Вагон, которому нахамили в начале рейса, к концу успокоится,
 * но не станет таким, будто ничего не было.
 *
 * `maxShare` — потолок того, сколько от накопленного можно вернуть за один
 * перегон, каким бы длинным он ни был. `fatiguePerLeg` — пол стресса,
 * который поднимается с каждым инцидентом: смена выматывает.
 */
export const TRIP = {
  carMood: { baseline: 70, tauMin: 25, maxShare: 0.55 },
  stress: { baseline: 15, tauMin: 15, maxShare: 0.7, fatiguePerLeg: 4 },
  /** Ниже этого перегон считается «сразу за предыдущим» и восстановления нет. */
  minGapSec: 30
}

/**
 * Восстановление на перегоне.
 *
 * Возвращает и новое состояние, и то, что именно изменилось, — межинцидентный
 * экран показывает это игроку числами. Восстановление одностороннее: вагон
 * успокаивается, но не становится довольнее, чем был бы без инцидента.
 */
export function recover(carry, gapSec, legIndex = 0) {
  const minutes = Math.max(0, gapSec) / 60
  const before = { carMood: carry.carMood, stress: carry.stress }

  const moodShare = Math.min(
    TRIP.carMood.maxShare,
    1 - Math.exp(-minutes / TRIP.carMood.tauMin)
  )
  const moodDeficit = Math.max(0, TRIP.carMood.baseline - carry.carMood)
  const carMood = carry.carMood + moodDeficit * moodShare

  const floor = TRIP.stress.baseline + TRIP.stress.fatiguePerLeg * legIndex
  const stressShare = Math.min(
    TRIP.stress.maxShare,
    1 - Math.exp(-minutes / TRIP.stress.tauMin)
  )
  const stress = carry.stress - Math.max(0, carry.stress - floor) * stressShare

  return {
    carry: { ...carry, carMood: Math.round(carMood), stress: Math.round(stress) },
    change: {
      gapSec: Math.round(gapSec),
      carMood: [Math.round(before.carMood), Math.round(carMood)],
      stress: [Math.round(before.stress), Math.round(stress)],
      fatigueFloor: floor
    }
  }
}

/** Сколько секунд состав идёт от одного инцидента до другого. */
export function gapBetween(line, serviceId, fromKm, toKm) {
  const prof = profile(line, serviceId)
  return Math.max(0, secondAtKm(prof, toKm) - secondAtKm(prof, fromKm))
}

/**
 * Проигрывает рейс целиком.
 *
 * `tripPath.legs[i]` — обычный путь по графу i-го инцидента. Каждый инцидент
 * считается тем же `grade`, что и в одиночном режиме, поэтому античит, разбор
 * и компетенции работают без единой оговорки. Рейс добавляет к этому только
 * перенос состояния и свёртку.
 */
export function gradeTrip(trip, scenarios, tripPath, context = {}) {
  const line = context.line ?? null
  const legPaths = Array.isArray(tripPath?.legs) ? tripPath.legs : []
  const legs = []
  const gaps = []
  const competency = emptyCompetency()

  let carry = null
  let score = 0
  let maxScore = 0
  let minScore = 0
  let tripSec = 0
  let lostSec = 0
  let stressPeak = 0
  let sopMatched = 0
  let sopTotal = 0
  const safeties = []
  const rejected = []

  for (const [i, leg] of (trip.legs ?? []).entries()) {
    const scenario = scenarios[leg.scenario]
    if (!scenario) {
      rejected.push(`инцидент «${leg.scenario}» не найден`)
      break
    }
    const path = legPaths[i]
    if (!path) break

    // Перегон до этого инцидента: время идёт, состояние восстанавливается.
    if (carry && line) {
      const prev = trip.legs[i - 1]
      const prevScenario = scenarios[prev.scenario]
      const gapSec = gapBetween(
        line,
        trip.service,
        prevScenario?.context?.startKm ?? 0,
        scenario.context?.startKm ?? 0
      )
      if (gapSec > TRIP.minGapSec) {
        const r = recover(carry, gapSec, i)
        carry = r.carry
        gaps.push({ index: i, ...r.change, fromKm: prevScenario?.context?.startKm, toKm: scenario.context?.startKm })
        tripSec += gapSec
      }
    }

    const run = grade(scenario, path, { ...context, carry })
    legs.push({ scenarioId: scenario.id, version: scenario.version, title: scenario.title, run })

    if (!run.ok) rejected.push(`«${scenario.title}»: ${run.rejected.join('; ')}`)

    const a = analyze(scenario)
    score += run.score
    maxScore += a.maxScore
    minScore += a.minScore
    tripSec += run.tripSec
    lostSec += run.lostSec
    stressPeak = Math.max(stressPeak, run.stressPeak)
    sopMatched += run.sopMatched
    sopTotal += run.sopTotal
    safeties.push(run.world.safety)
    for (const k of COMPETENCY_IDS) competency[k] += run.competency[k] ?? 0

    carry = {
      carMood: run.world.carMood,
      stress: run.world.stress,
      flags: [...run.world.flags]
    }
  }

  const finished = legs.length === (trip.legs ?? []).length && legs.every((l) => l.run.ok)
  const span = Math.max(1, maxScore - minScore)
  const scorePct = finished ? Math.round(clamp(((score - minScore) / span) * 100)) : 0

  // Компетенции по смене нормируются на сумму потолков пройденных инцидентов.
  const competencyPct = {}
  const ceilings = emptyCompetency()
  for (const l of legs) {
    const a = analyze(scenarios[l.scenarioId])
    for (const k of COMPETENCY_IDS) ceilings[k] += a.maxCompetency[k] ?? 0
  }
  for (const k of COMPETENCY_IDS) {
    if (ceilings[k] <= 0) continue
    competencyPct[k] = Math.round(clamp((competency[k] / ceilings[k]) * 100))
  }

  return {
    ok: finished && !rejected.length,
    tripId: trip.id,
    rejected,
    legs,
    gaps,
    score,
    maxScore,
    minScore,
    scorePct,
    competency,
    competencyPct,
    tripSec: Math.round(tripSec),
    lostSec,
    stressPeak,
    sopMatched,
    sopTotal,
    safetyAvg: safeties.length
      ? Math.round(safeties.reduce((s, v) => s + v, 0) / safeties.length)
      : 0,
    verdicts: legs.map((l) => l.run.verdict),
    achievements: finished ? tripAchievements(legs, stressPeak) : []
  }
}

/**
 * Достижения уровня смены.
 *
 * Их нельзя получить за один инцидент — только за то, как прошёл весь рейс.
 * Идентификаторы попадают в базу, менять их нельзя.
 */
export const TRIP_ACHIEVEMENTS = [
  {
    id: 'full-shift',
    title: 'Полная смена',
    condition: 'Пройти рейс целиком, от первого инцидента до прибытия',
    icon: 'repeat'
  },
  {
    id: 'clean-shift',
    title: 'Смена без замечаний',
    condition: 'Закрыть все инциденты рейса с хорошим исходом',
    icon: 'star'
  },
  {
    id: 'unshaken',
    title: 'Ровный пульс',
    condition: 'Провести всю смену, ни разу не подняв стресс выше 60',
    icon: 'snow'
  }
]

function tripAchievements(legs, stressPeak) {
  const out = ['full-shift']
  if (legs.every((l) => l.run.verdict === 'good')) out.push('clean-shift')
  if (stressPeak <= 60) out.push('unshaken')
  return out
}
