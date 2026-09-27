/**
 * Распознавание свободной реплики: что проводник сказал своими словами
 * и к какому варианту графа это относится.
 *
 * Зачем это нужно. Четыре кнопки не тренируют речь. Настоящий проводник
 * не выбирает формулировку из списка — он её произносит, и половина работы
 * в том, чтобы найти нужные слова за восемь секунд. Но как только ответ
 * становится свободным, обычно теряется главное: воспроизводимость оценки.
 *
 * Здесь свободный ответ есть, а оценка остаётся детерминированной, потому что
 * распознаватель **написан нами и работает офлайн**. Никакой языковой модели:
 * нормализация, лёгкий морфологический разбор, взвешивание по редкости слова
 * внутри узла и явный порог уверенности. Каждое решение объяснимо построчно —
 * в разборе видно, какие именно слова сработали и почему.
 *
 * Следствие, ради которого всё и сделано: сервер прогоняет ту же реплику
 * через тот же код и обязан получить то же ребро графа. Если не получил —
 * прохождение отклоняется. Свободная речь не создаёт дыры в античите.
 */

/** Служебные слова: они есть в любой реплике и ничего не различают. */
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
 * Отсечение окончаний.
 *
 * Не полноценный морфологический анализатор, а список окончаний от длинных
 * к коротким — этого достаточно, чтобы «доложу», «доложить» и «доложил»
 * сошлись в одну основу. Полноценная морфология здесь была бы разработкой
 * ради разработки: словарь ключевых слов узла закрытый, и путать основы
 * внутри него не с чем.
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

/** Основа слова. Слишком короткие слова не режем: от них ничего не останется. */
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

/** Реплика → набор основ. Служебные слова и цифры выбрасываются. */
export function stems(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^а-яa-z0-9]+/i)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
}

export const ENGINE_INTENT = {
  /** Ниже этого совпадение считается случайным. */
  MIN_SCORE: 1.2,
  /** Во сколько раз лучший вариант должен обойти второй, чтобы считаться понятым. */
  MARGIN: 1.35,
  /** Меньше двух значимых слов — это не реплика, а обрывок. */
  MIN_WORDS: 2,
  /** Вес слова, взятого из текста варианта, против слова из ключей методиста. */
  TEXT_WEIGHT: 0.55,
  KEYWORD_WEIGHT: 1,
  /** Штраф за слово из «чего говорить не надо». */
  AVOID_PENALTY: 1.4,
  /**
   * Совпадение по общему началу основы.
   *
   * «Подойти» и «подойду» дают разные основы: список окончаний не покрывает
   * всю русскую морфологию и не должен — это была бы разработка ради
   * разработки. Вместо этого основы считаются родственными, если одна
   * начинается с другой и общее начало достаточно длинное. Вес такого
   * совпадения ниже точного: родство — это догадка, пусть и обоснованная.
   */
  PREFIX_MIN: 5,
  PREFIX_WEIGHT: 0.8
}

/**
 * Словарь узла: какие основы за каким вариантом закреплены и насколько
 * каждая из них показательна.
 *
 * Показательность считается по редкости внутри узла: слово, которое есть
 * у всех вариантов, не различает ничего и получает вес около нуля. Именно
 * поэтому не нужен ни корпус, ни обучение — контекст задаёт сам узел.
 */
export function buildIndex(node) {
  const options = node.choices ?? []
  const entries = options.map((c) => {
    const weights = new Map()
    const add = (list, weight) => {
      for (const raw of list ?? []) {
        for (const s of stems(raw)) {
          weights.set(s, Math.max(weights.get(s) ?? 0, weight))
        }
      }
    }
    add([c.text], ENGINE_INTENT.TEXT_WEIGHT)
    add(c.keywords, ENGINE_INTENT.KEYWORD_WEIGHT)
    return {
      id: c.id,
      weights,
      keys: [...weights.keys()],
      avoid: new Set((c.avoid ?? []).flatMap(stems))
    }
  })

  // Насколько слово редкое внутри этого узла.
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
 * Относит реплику к одному из вариантов узла.
 *
 * Возвращает не только ответ, но и его обоснование: какие слова сработали
 * и с каким весом. Разбор рейса показывает это дословно — распознаватель,
 * который нельзя проверить глазами, в тренажёре для допуска не нужен.
 *
 * `available` — варианты, доступные в текущем состоянии мира. Реплику нельзя
 * отнести к тому, чего в этот момент не существует: связь занята — значит,
 * «доложу начальнику поезда» не пройдёт, и это правильный ответ, а не ошибка.
 */
export function classify(node, said, available) {
  const words = stems(said)
  const allowed = available
    ? new Set(available.map((c) => c.id))
    : new Set((node.choices ?? []).map((c) => c.id))

  if (words.length < ENGINE_INTENT.MIN_WORDS) {
    return { choice: null, reason: 'short', words, scores: [] }
  }

  const { entries, idf } = buildIndex(node)
  const counted = new Set(words)

  const scores = entries
    .filter((e) => allowed.has(e.id))
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
            weight = e.weights.get(kin) * ENGINE_INTENT.PREFIX_WEIGHT
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
      for (const w of counted) if (e.avoid.has(w)) penalty += ENGINE_INTENT.AVOID_PENALTY
      return {
        id: e.id,
        score: Math.round((score - penalty) * 100) / 100,
        hits: hits.sort((a, b) => b.value - a.value)
      }
    })
    .sort((a, b) => b.score - a.score)

  const best = scores[0]
  const second = scores[1]

  if (!best || best.score < ENGINE_INTENT.MIN_SCORE) {
    return { choice: null, reason: 'unclear', words, scores }
  }
  if (second && second.score > 0 && best.score < second.score * ENGINE_INTENT.MARGIN) {
    return { choice: null, reason: 'ambiguous', words, scores }
  }
  return { choice: best.id, reason: 'ok', words, scores }
}

/** Родственная основа из словаря узла: общее начало не короче порога. */
function nearest(keys, word) {
  let best = null
  for (const k of keys) {
    const shared = Math.min(k.length, word.length)
    if (shared < ENGINE_INTENT.PREFIX_MIN) continue
    if (!k.startsWith(word.slice(0, shared)) || !word.startsWith(k.slice(0, shared))) continue
    if (!best || k.length > best.length) best = k
  }
  return best
}

/** Почему реплику не поняли — словами, которые видит проводник. */
export const INTENT_REASON = {
  short: 'Слишком коротко. Скажите фразой, как сказали бы пассажиру.',
  unclear: 'Не понял, о чём вы. Назовите действие прямо.',
  ambiguous: 'Так можно понять двояко. Уточните, что именно вы делаете.'
}
