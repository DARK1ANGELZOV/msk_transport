/**
 * Детерминированный разбор свободной реплики.
 *
 * Задача сформулирована в задании как обязательный слой перед AI: нормализация,
 * ключевые слова, регулярные выражения для очевидных намерений, сопоставление
 * с разрешёнными действиями и проверка через Scenario Engine. AI подключается
 * только если уверенного совпадения нет — и даже тогда он лишь предлагает
 * кандидата, а решает всё равно движок.
 *
 * Почему это сделано своим кодом, а не языковой моделью:
 *
 *   — продукт обязан полностью работать без внешнего API (требование задания);
 *   — одна и та же реплика должна давать один и тот же результат всегда,
 *     иначе разбор нельзя объяснить пользователю;
 *   — решение должно быть проверяемым глазами: в разборе видно, какие именно
 *     слова сработали и с каким весом.
 *
 * Важно, чего здесь нет. Это не понимание русского языка. Это ответ на узкий
 * вопрос: какое из трёх-четырёх заранее известных действий имел в виду
 * человек. Контекст задан состоянием сценария, вариантов мало, и они разные
 * по смыслу — для этого не нужен корпус, нужен аккуратный счёт.
 */

/** Служебные слова: есть в любой реплике и не различают ничего. */
const STOP = new Set([
  'и', 'а', 'но', 'да', 'не', 'ни', 'же', 'ли', 'бы', 'то', 'это', 'вот',
  'в', 'во', 'на', 'по', 'к', 'ко', 'с', 'со', 'у', 'о', 'об', 'от', 'до',
  'за', 'из', 'для', 'при', 'над', 'под', 'про', 'без', 'через',
  'я', 'ты', 'мы', 'вы', 'он', 'она', 'оно', 'они', 'его', 'её', 'их',
  'мне', 'меня', 'нам', 'вам', 'вас', 'нас', 'ему', 'ей', 'им',
  'него', 'нему', 'ним', 'нём', 'нем', 'неё', 'нее', 'ней', 'них', 'ими',
  'тебя', 'тебе', 'кто', 'кого', 'кому', 'чем', 'чём',
  'мой', 'моя', 'моё', 'наш', 'ваш', 'свой', 'весь', 'все', 'всё',
  'что', 'чтобы', 'как', 'так', 'там', 'тут', 'здесь', 'если', 'или',
  'быть', 'есть', 'нет', 'ну', 'уже', 'ещё', 'еще', 'очень', 'сейчас',
  'буду', 'будет', 'будем', 'будут', 'был', 'была', 'были', 'было',
  'надо', 'нужно', 'давай', 'давайте', 'пожалуйста'
])

/**
 * Отсечение окончаний — список от длинных к коротким.
 *
 * Не морфологический анализатор и не должен им быть: словарь действия
 * закрытый, путать основы внутри него не с чем. Полноценная морфология
 * была бы разработкой ради разработки.
 */
const SUFFIXES = [
  'ившись', 'ывшись', 'вшись', 'ающий', 'ующий', 'ившие', 'ывать', 'ивать',
  'аются', 'ается', 'ались', 'ился', 'илась', 'ение', 'ения', 'ению',
  'ать', 'ять', 'еть', 'ить', 'уть', 'ешь', 'ишь', 'ете', 'ите',
  'ают', 'яют', 'еют', 'уют', 'ует', 'ами', 'ями', 'ого', 'его',
  'ому', 'ему', 'ыми', 'ими', 'ыва', 'ива',
  'ой', 'ей', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий',
  'ым', 'им', 'ом', 'ем', 'ах', 'ях', 'ов', 'ев', 'ью', 'ья', 'ье',
  'ла', 'ло', 'ли', 'на', 'но', 'ны', 'ть', 'ся', 'сь',
  'ил', 'ыл', 'ал', 'ял', 'ел',
  'а', 'я', 'ы', 'и', 'о', 'е', 'у', 'ю', 'ь', 'й', 'л'
]

const MIN_STEM = 3

/** Основа слова. Короткие слова не режем: от них ничего не останется. */
export function stem(word) {
  const w = word.toLowerCase().replace(/ё/g, 'е')
  if (w.length <= 4) return w
  for (const suffix of SUFFIXES) {
    if (w.length - suffix.length >= MIN_STEM && w.endsWith(suffix)) {
      return w.slice(0, -suffix.length)
    }
  }
  return w
}

/** Реплика → набор основ. Служебные слова выбрасываются. */
export function stems(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^а-яa-z0-9]+/i)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
}

export const INTENT = {
  /** Ниже этого совпадение считается случайным. */
  MIN_SCORE: 1.2,
  /** Во сколько раз лучший вариант должен обойти второй. */
  MARGIN: 1.35,
  /** Меньше двух значимых слов — это обрывок, а не реплика. */
  MIN_WORDS: 2,
  /** Вес слова из названия действия против слова из словаря автора. */
  LABEL_WEIGHT: 0.55,
  KEYWORD_WEIGHT: 1,
  /** Штраф за слово, прямо говорящее против этого действия. */
  AVOID_PENALTY: 1.4,
  /** Совпадение по общему началу основы: «подойти» и «подхожу». */
  PREFIX_MIN: 5,
  PREFIX_WEIGHT: 0.8
}

/**
 * Словарь состояния: какие основы за каким действием закреплены и насколько
 * каждая показательна.
 *
 * Показательность считается по редкости внутри одного состояния: слово,
 * которое есть у всех действий, не различает ничего и весит около нуля.
 * Поэтому не нужен ни корпус, ни обучение — контекст задаёт само состояние.
 */
export function buildIndex(actions) {
  const entries = actions.map((a) => {
    const weights = new Map()
    const add = (list, weight) => {
      for (const raw of list ?? []) {
        for (const s of stems(raw)) {
          weights.set(s, Math.max(weights.get(s) ?? 0, weight))
        }
      }
    }
    add([a.label], INTENT.LABEL_WEIGHT)
    add(a.keywords, INTENT.KEYWORD_WEIGHT)
    return {
      id: a.id,
      weights,
      keys: [...weights.keys()],
      avoid: new Set((a.avoid ?? []).flatMap(stems)),
      patterns: a.patterns ?? []
    }
  })

  const df = new Map()
  for (const e of entries) {
    for (const s of e.weights.keys()) df.set(s, (df.get(s) ?? 0) + 1)
  }
  const total = Math.max(1, entries.length)
  const idf = new Map()
  for (const [s, n] of df) idf.set(s, Math.log(1 + total / n))

  return { entries, idf }
}

/**
 * Очевидные намерения — регулярные выражения.
 *
 * Слой из задания: если формулировка однозначна («вызову начальника поезда»),
 * незачем гонять её через взвешивание. Регулярка выигрывает у счёта, но
 * только если сработала ровно одна — иначе это не очевидный случай.
 */
function byPattern(entries, said) {
  const text = String(said ?? '').toLowerCase().replace(/ё/g, 'е')
  const hit = []
  for (const e of entries) {
    for (const p of e.patterns) {
      let re
      try {
        re = new RegExp(p, 'i')
      } catch {
        continue // Сломанная регулярка в сценарии не должна ронять разбор.
      }
      if (re.test(text)) {
        hit.push({ id: e.id, pattern: p })
        break
      }
    }
  }
  return hit.length === 1 ? hit[0] : null
}

/** Родственная основа из словаря: общее начало не короче порога. */
function nearest(keys, word) {
  let best = null
  for (const k of keys) {
    const short = Math.min(k.length, word.length)
    if (short < INTENT.PREFIX_MIN) continue
    if (k.startsWith(word) || word.startsWith(k)) {
      if (!best || short > Math.min(best.length, word.length)) best = k
    }
  }
  return best
}

/**
 * Относит реплику к одному из разрешённых действий.
 *
 * `actions` — уже отфильтрованный движком список: то, что в этот момент
 * действительно можно сделать. Реплику нельзя отнести к действию, которого
 * в этот момент не существует, и это правильный ответ, а не ошибка.
 *
 * Возвращает не только решение, но и его обоснование: какие слова сработали
 * и с каким весом. Разбор показывает это дословно — анализатор, который
 * нельзя проверить глазами, в тренажёре не нужен.
 */
export function classify(actions, said) {
  const words = stems(said)
  const list = actions ?? []

  if (!list.length) {
    return { actionId: null, reason: 'no-actions', words, scores: [], via: null }
  }

  const { entries, idf } = buildIndex(list)

  // Очевидное намерение проверяется до счёта.
  const direct = byPattern(entries, said)
  if (direct) {
    return {
      actionId: direct.id,
      reason: 'ok',
      via: 'pattern',
      pattern: direct.pattern,
      words,
      scores: []
    }
  }

  if (words.length < INTENT.MIN_WORDS) {
    return { actionId: null, reason: 'short', words, scores: [], via: null }
  }

  const counted = new Set(words)
  const scores = entries
    .map((e) => {
      const hits = []
      let score = 0
      for (const w of counted) {
        let weight = e.weights.get(w)
        let key = w
        let exact = true
        if (!weight) {
          const kin = nearest(e.keys, w)
          if (kin) {
            weight = e.weights.get(kin) * INTENT.PREFIX_WEIGHT
            key = kin
            exact = false
          }
        }
        if (!weight) continue
        const value = weight * (idf.get(key) ?? 0)
        if (value <= 0) continue
        score += value
        hits.push({ stem: w, matched: key, exact, value: Math.round(value * 100) / 100 })
      }
      let penalty = 0
      for (const w of counted) if (e.avoid.has(w)) penalty += INTENT.AVOID_PENALTY
      return {
        id: e.id,
        score: Math.round((score - penalty) * 100) / 100,
        hits: hits.sort((a, b) => b.value - a.value)
      }
    })
    .sort((a, b) => b.score - a.score)

  const best = scores[0]
  const second = scores[1]

  if (!best || best.score < INTENT.MIN_SCORE) {
    return { actionId: null, reason: 'unclear', words, scores, via: null }
  }
  if (second && second.score > 0 && best.score < second.score * INTENT.MARGIN) {
    return { actionId: null, reason: 'ambiguous', words, scores, via: null }
  }
  return { actionId: best.id, reason: 'ok', via: 'score', words, scores }
}

/**
 * Что сказать пассажиру, когда реплика не распозналась.
 *
 * Принципиально: тренажёр не молчит и не пишет «ошибка ввода». Он ведёт себя
 * как живой собеседник — переспрашивает. Непонятая формулировка в реальной
 * работе стоит ровно того же: собеседник переспрашивает, время идёт.
 */
export const INTENT_REASON = {
  short: 'Скажите чуть подробнее — из этих слов непонятно, что вы делаете.',
  unclear: 'Не понял, о чём вы. Назовите действие прямо.',
  ambiguous: 'Это можно понять двояко. Скажите точнее, что именно вы делаете.',
  'no-actions': 'Сейчас сказать нечего.'
}
