/**
 * Достижения.
 *
 * Два правила, из-за которых корпоративная геймификация обычно умирает,
 * и как они здесь закрыты:
 *
 *   — ничего «за участие». Каждое условие проверяется по фактическим числам
 *     прохождения, а не по факту нажатия кнопки «начать»;
 *   — условие видно до получения. Ачивка должна быть целью, а не сюрпризом,
 *     поэтому `condition` показывается в профиле рядом с незакрытыми.
 *
 * Идентификаторы попадают в базу и в рейтинг — менять их нельзя,
 * старые записи ссылаются на них по имени.
 */

/**
 * Что известно о прохождении на момент проверки.
 * @typedef {object} RunContext
 * @property {object} run       результат replay()
 * @property {object} scenario  сценарий, по которому шли
 * @property {number} runsTotal сколько рейсов у сотрудника всего, включая этот
 * @property {number} streakDays сколько дней подряд занимается
 * @property {number} duelsReviewed сколько разборов коллег он прокомментировал
 */

export const ACHIEVEMENTS = [
  {
    id: 'by-the-book',
    title: 'По регламенту',
    condition: 'Пройти рейс, ни разу не отклонившись от эталонного пути по СОП',
    icon: 'book',
    check: (c) => c.run.sopTotal > 0 && c.run.sopMatched === c.run.sopTotal
  },
  {
    id: 'deescalator',
    title: 'Деэскалатор',
    condition: 'Закрыть конфликтный сценарий, не уронив настроение вагона ниже стартового',
    icon: 'handshake',
    check: (c) =>
      c.scenario.competencies?.includes('deescalation') &&
      c.run.ok &&
      c.run.world.carMood >= (c.scenario.state?.carMood ?? 70)
  },
  {
    id: 'golden-hour',
    title: 'Золотой час',
    condition: 'Медицинский инцидент: уложиться в окно до ближайшей остановки',
    icon: 'pulse',
    check: (c) =>
      c.scenario.competencies?.includes('medical') && c.run.ok && !c.run.overdue
  },
  {
    id: 'tunnel',
    title: 'Тоннель',
    condition: 'Принять верное решение, когда связь уже пропала',
    icon: 'tunnel',
    check: (c) =>
      c.run.ok &&
      c.run.visited.some((v) => v.world && v.world.comms === false && !v.timeout) &&
      c.run.world.safety >= 70
  },
  {
    id: 'cold-head',
    title: 'Холодная голова',
    condition: 'Пройти рейс, ни разу не подняв стресс выше 40',
    icon: 'snow',
    check: (c) => c.run.ok && c.run.stressPeak <= 40
  },
  {
    id: 'price-of-second',
    title: 'Цена секунды',
    condition: 'Потерять за рейс меньше 30 секунд относительно эталона',
    icon: 'clock',
    check: (c) => c.run.ok && c.run.lostSec < 30
  },
  {
    id: 'polyglot',
    title: 'Полиглот',
    condition: 'Решить инцидент с иностранным пассажиром без переводчика',
    icon: 'globe',
    check: (c) =>
      c.scenario.competencies?.includes('foreign') &&
      c.run.ok &&
      !c.run.world.flags.includes('translator')
  },
  {
    id: 'no-timeouts',
    title: 'Ни одного пропуска',
    condition: 'Пройти рейс, ни разу не дав таймеру истечь',
    icon: 'check',
    check: (c) => c.run.ok && !c.run.visited.some((v) => v.timeout)
  },
  {
    id: 'full-house',
    title: 'Идеальный рейс',
    condition: 'Набрать не меньше 95 % от потолка сценария',
    icon: 'star',
    check: (c) => c.run.ok && c.run.scorePct >= 95
  },
  {
    id: 'veteran',
    title: 'Сменщик',
    condition: 'Пройти двадцать рейсов',
    icon: 'repeat',
    check: (c) => c.runsTotal >= 20
  },
  {
    id: 'streak-7',
    title: 'Неделя без пропусков',
    condition: 'Заниматься семь дней подряд',
    icon: 'calendar',
    check: (c) => c.streakDays >= 7
  },
  {
    id: 'mentor',
    title: 'Наставник',
    condition: 'Разобрать три чужих прохождения в дуэлях и оставить комментарий',
    icon: 'mentor',
    check: (c) => c.duelsReviewed >= 3
  }
]

export const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((a) => a.id))

export const achievementById = (id) => ACHIEVEMENTS.find((a) => a.id === id) ?? null

/** Что заработано этим прохождением. Порядок стабильный — по списку выше. */
export function earned(ctx) {
  const out = []
  for (const a of ACHIEVEMENTS) {
    try {
      if (a.check(ctx)) out.push(a.id)
    } catch {
      // Достижение не должно ронять начисление результата: пропускаем молча,
      // но не притворяемся, что оно получено.
    }
  }
  return out
}
