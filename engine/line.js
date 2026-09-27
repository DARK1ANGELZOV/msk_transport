/**
 * Физика линии: где поезд, с какой скоростью и сколько ему до остановки.
 *
 * Зачем это в тренажёре. «Цена секунды» перестаёт быть метафорой, когда
 * секунда — это сто одиннадцать метров пути, а окно, в которое ещё можно
 * заказать медиков на станцию, закрывается не по таймеру, а потому что
 * состав прошёл нужный километр. Проводнику важно чувствовать именно это:
 * решение принимается не «за 15 секунд», а «за 1,7 километра».
 *
 * Модель намеренно простая и проверяемая:
 *
 *   — линия описана ограничениями скорости по километрам и остановками;
 *   — поезд разгоняется с постоянным ускорением и тормозит с постоянным
 *     замедлением, заранее снижая скорость под следующее ограничение;
 *   — профиль считается один раз на маршрут и запоминается: дальше
 *     положение и время берутся из таблицы.
 *
 * Чего здесь нет и почему: уклонов, кривых, сцепления колеса с рельсом,
 * сопротивления воздуха. Они изменили бы числа на проценты и не изменили бы
 * ни одного решения проводника — а сложность добавили бы существенную.
 * Границы модели названы в docs/SCENARIO-DSL.md.
 */

const KMH = 1 / 3.6 // км/ч → м/с
const MS = 3.6      // м/с → км/ч

const profiles = new Map()

/**
 * Реестр линий.
 *
 * Ядро не умеет ходить в сеть и в файловую систему — оно исполняется и в Node,
 * и в браузере. Поэтому описание инфраструктуры регистрируют снаружи: сервер
 * при старте читает `content/lines/*.json`, клиент получает линию вместе
 * со сценарием, тесты подкладывают её из файла. Сценарий ссылается на линию
 * по идентификатору и ничего о ней не знает.
 */
const registry = new Map()

export function registerLine(doc) {
  if (!doc?.id) return null
  registry.set(doc.id, doc)
  // Профиль мог быть построен по прежней редакции линии.
  for (const key of [...profiles.keys()]) {
    if (key.startsWith(`${doc.id}/`)) profiles.delete(key)
  }
  return doc
}

export const getLine = (id) => registry.get(id) ?? null
export const knownLines = () => [...registry.values()]

/** Ограничение скорости в данной точке, м/с. */
function limitAt(line, m) {
  const km = m / 1000
  for (const l of line.limits) if (km < l.toKm) return l.kmh * KMH
  return line.limits.at(-1).kmh * KMH
}

/** Ближайшее впереди снижение ограничения: расстояние и допустимая скорость. */
function nextRestriction(line, m) {
  const km = m / 1000
  let current = limitAt(line, m)
  for (const l of line.limits) {
    if (l.toKm <= km) continue
    const speed = l.kmh * KMH
    if (speed < current) return { atM: l.toKm * 1000, speed }
    current = Math.max(current, speed)
  }
  return null
}

/** Остановки рейса по расписанию сервиса, в метрах от начала линии. */
function serviceStops(line, service) {
  const names = new Set(service.stops)
  return line.stations
    .filter((s) => names.has(s.name))
    .map((s) => ({ ...s, m: s.km * 1000 }))
    .sort((a, b) => a.m - b.m)
}

/**
 * Отражение линии для рейса «обратно».
 *
 * Километраж линии всегда считается от Москвы — так его называют
 * и в расписании, и в разговоре. Но поезд, идущий в Москву, движется
 * по нему в обратную сторону, поэтому внутри профиля линия зеркалится,
 * а наружу километр возвращается в исходных координатах. Иначе пришлось бы
 * заводить вторую линию с теми же станциями и вручную держать их согласованными.
 */
function mirrorLine(line) {
  const L = line.lengthKm
  const segments = []
  let from = 0
  for (const l of line.limits) {
    segments.push({ from, to: l.toKm, kmh: l.kmh, why: l.why })
    from = l.toKm
  }
  const limits = segments
    .map((s) => ({ from: L - s.to, to: L - s.from, kmh: s.kmh, why: s.why }))
    .sort((a, b) => a.from - b.from)
    .map((s) => ({ toKm: s.to, kmh: s.kmh, why: s.why }))

  return {
    ...line,
    limits,
    stations: line.stations
      .map((s) => ({ ...s, km: L - s.km }))
      .sort((a, b) => a.km - b.km)
  }
}

/**
 * Профиль движения: массив отсчётов по секундам от отправления до прибытия.
 *
 * Считается прямым интегрированием с шагом в секунду. Маршрут — около семи
 * тысяч секунд, поэтому весь профиль строится за миллисекунды и кешируется
 * по паре «линия + сервис».
 */
export function profile(line, serviceId) {
  const key = `${line.id}/${serviceId}`
  const hit = profiles.get(key)
  if (hit) return hit

  const service = line.services.find((s) => s.id === serviceId) ?? line.services[0]
  const back = service.direction === 'back'
  const geo = back ? mirrorLine(line) : line
  const stops = serviceStops(geo, service)
  const { accelMs2: a, serviceDecelMs2: d, dwellSec } = line.physics
  const endM = geo.lengthKm * 1000

  const samples = [] // [t] → { m, v, dwelling }
  let m = stops[0]?.m ?? 0
  let v = 0
  let t = 0
  let stopIndex = 1
  const startM = m

  const push = (dwelling) => samples.push({ m, v, dwelling })

  push(false)
  // Пятичасовой предохранитель: если модель разойдётся, цикл не повиснет.
  while (m < endM && t < 20_000) {
    const stop = stops[stopIndex]
    let target = limitAt(geo, m)

    // Тормозим заранее под ближайшее снижение ограничения.
    const restriction = nextRestriction(geo, m)
    if (restriction) {
      const gap = Math.max(0, restriction.atM - m)
      target = Math.min(target, Math.sqrt(restriction.speed ** 2 + 2 * d * gap))
    }
    // И под остановку — до нуля.
    if (stop) {
      const gap = Math.max(0, stop.m - m)
      target = Math.min(target, Math.sqrt(2 * d * gap))
    }

    v = v < target ? Math.min(target, v + a) : Math.max(target, v - d)
    m += v
    t += 1

    if (stop && m >= stop.m - 0.5 && v < 0.6) {
      // Приехали: стоянка, затем разгон дальше.
      m = stop.m
      v = 0
      for (let i = 0; i < dwellSec; i += 1) {
        push(true)
        t += 1
      }
      stopIndex += 1
      continue
    }
    push(false)
  }

  const result = {
    line, geo, service, back, stops, startM, endM,
    samples,
    totalSec: samples.length - 1,
    /** Кумулятивная таблица «метр → секунда» для обратного поиска. */
    secondAtM: buildIndex(samples)
  }
  profiles.set(key, result)
  return result
}

function buildIndex(samples) {
  // Индекс по километрам: для каждого целого километра — первая секунда,
  // когда состав его прошёл. Точности до километра достаточно: сценарии
  // стартуют с километровой отметки.
  const index = []
  let km = 0
  for (let t = 0; t < samples.length; t += 1) {
    while (samples[t].m >= km * 1000) {
      index[km] = t
      km += 1
    }
  }
  return index
}

/** Внешний километр (всегда от Москвы) → внутренний, по ходу движения. */
export const toInner = (prof, km) => (prof.back ? prof.line.lengthKm - km : km)
export const toOuter = (prof, km) => (prof.back ? prof.line.lengthKm - km : km)

/** Секунда рейса, на которой состав находится на данном километре. */
export function secondAtKm(prof, km) {
  const inner = toInner(prof, km)
  const i = Math.max(0, Math.min(prof.secondAtM.length - 1, Math.round(inner)))
  return prof.secondAtM[i] ?? 0
}

/** Километр, на котором состав окажется на данной секунде рейса. */
export function kmAtSecond(prof, sec) {
  const t = Math.max(0, Math.min(prof.totalSec, Math.round(sec)))
  return toOuter(prof, prof.samples[t].m / 1000)
}

/**
 * Километр, после которого до остановки остаётся меньше `leadSec`.
 *
 * Это и есть точка невозврата, нарисованная на полосе маршрута: за ней
 * заказывать медиков на эту станцию бессмысленно — диспетчер не успеет.
 */
export function leadBoundaryKm(line, serviceId, stopKm, leadSec) {
  const prof = profile(line, serviceId)
  const atStop = prof.secondAtM[Math.round(toInner(prof, stopKm))]
  if (typeof atStop !== 'number') return null
  return kmAtSecond(prof, atStop - leadSec)
}

export const clearProfileCache = () => profiles.clear()

/**
 * Состояние поезда через `tripSec` секунд после начала сценария.
 *
 * Сценарий задаёт километр, на котором он начинается; остальное —
 * следствие профиля движения, а не отдельные поля в контенте.
 * Так контент не может разойтись с физикой: в нём просто нечему расходиться.
 */
export function trainState(line, serviceId, startKm, tripSec, options = {}) {
  const prof = profile(line, serviceId)
  const moving = options.moving !== false
  const t0 = secondAtKm(prof, startKm)
  const t = moving ? Math.min(prof.totalSec, t0 + Math.max(0, Math.round(tripSec))) : t0
  const s = prof.samples[t] ?? prof.samples.at(-1)

  const km = toOuter(prof, s.m / 1000)
  const speedKmh = Math.round(s.v * MS)
  const next = nextStop(prof, s.m)

  return {
    km: Math.round(km * 10) / 10,
    speedKmh,
    dwelling: s.dwelling,
    /** Сколько метров пройдено с начала сценария. */
    travelledM: Math.round(s.m - prof.samples[t0].m),
    direction: prof.back ? 'back' : 'forward',
    clock: clockAt(prof.service.departure, t),
    elapsedSec: t,
    remainingSec: prof.totalSec - t,
    nextStop: next
      ? {
          name: next.name,
          code: next.code,
          km: toOuter(prof, next.km),
          distanceM: Math.round(next.m - s.m),
          etaSec: Math.max(0, prof.secondAtM[Math.round(next.km)] - t)
        }
      : null,
    brakingM: {
      service: brakingDistanceM(speedKmh, line, 'service'),
      emergency: brakingDistanceM(speedKmh, line, 'emergency')
    }
  }
}

function nextStop(prof, m) {
  return prof.stops.find((s) => s.m > m + 1) ?? null
}

/**
 * Тормозной путь, метров.
 *
 * Формула школьная: v²/2a. Замедление при экстренном торможении подобрано
 * так, чтобы с четырёхсот километров в час получалось около шести с половиной
 * километров — это опубликованный ориентир для составов такого класса.
 */
export function brakingDistanceM(speedKmh, line, mode = 'emergency') {
  const v = speedKmh * KMH
  const a = mode === 'emergency'
    ? line.physics.emergencyDecelMs2
    : line.physics.serviceDecelMs2
  return Math.round((v * v) / (2 * a))
}

/** Сколько метров проходит состав за столько-то секунд на текущей скорости. */
export const metresIn = (speedKmh, sec) => Math.round(speedKmh * KMH * sec)

/** Время суток на секунде рейса. */
export function clockAt(departure, sec) {
  const [h = 0, m = 0] = String(departure ?? '00:00').split(':').map(Number)
  const total = h * 3600 + m * 60 + Math.max(0, Math.round(sec))
  const pad = (n) => String(Math.floor(n)).padStart(2, '0')
  return `${pad((total / 3600) % 24)}:${pad((total / 60) % 60)}:${pad(total % 60)}`
}

/** Станция линии по имени — для сценариев, которые ссылаются на неё словом. */
export const stationByName = (line, name) =>
  line.stations.find((s) => s.name === name) ?? null
