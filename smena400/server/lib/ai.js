/**
 * AI-слой: дополнительный, необязательный, бесправный.
 *
 * Правило, от которого здесь ничего не отклоняется: **модель ничего
 * не решает**. Она может предложить, какое из уже разрешённых действий
 * имел в виду человек, и может переформулировать реплику пассажира.
 * Состояние, эффекты, переходы и допустимость действий остаются
 * за Scenario Engine.
 *
 * Технически это выражено так: единственное, что модель может вернуть, —
 * идентификатор из списка, который мы ей дали. Любой другой ответ
 * отбрасывается. Даже если модель придумает новое действие или решит,
 * что игрок прав, дальше этой функции её мнение не уйдёт.
 *
 * Без ключа продукт работает полностью: свободную речь разбирает
 * собственный анализатор, пассажир говорит написанными заранее фразами.
 * Проверить это можно, просто не заполнив .env.
 */

const PROVIDER = process.env.AI_PROVIDER?.trim() || ''
const KEY = process.env.AI_API_KEY?.trim() || ''
const MODEL = process.env.AI_MODEL?.trim() || 'gpt-4o-mini'
const BASE = (process.env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')

/** Медленная модель не имеет права задерживать ход: у игрока идёт таймер. */
const TIMEOUT_MS = 6000

export const aiEnabled = () => Boolean(PROVIDER && KEY)

export const aiStatus = () => ({
  enabled: aiEnabled(),
  provider: aiEnabled() ? PROVIDER : null,
  model: aiEnabled() ? MODEL : null,
  note: aiEnabled()
    ? 'AI подключён: перефразирование реплик и запасной разбор свободного ответа. Состояние сценария AI не меняет.'
    : 'AI отключён. Свободную речь разбирает собственный анализатор, реплики берутся из сценария. Ничего не потеряно, кроме вариативности формулировок.'
})

/** Один запрос к совместимому с OpenAI /chat/completions. Без SDK. */
async function chat(messages, { maxTokens = 120, temperature = 0 } = {}) {
  if (!aiEnabled()) return null
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        max_tokens: maxTokens
      })
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.choices?.[0]?.message?.content?.trim() ?? null
  } catch {
    // Любая проблема с внешним сервисом — это отсутствие подсказки,
    // а не ошибка игры. Молча возвращаемся к детерминированному пути.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Запасной разбор свободной реплики.
 *
 * Вызывается только тогда, когда собственный анализатор не уверен. Модель
 * получает список разрешённых действий и обязана выбрать один из них или
 * ответить «нет». Возвращённый идентификатор всё равно проходит полную
 * проверку движком — здесь он только кандидат.
 */
export async function classifyFallback(actions, said) {
  if (!aiEnabled() || !actions.length) return null

  const list = actions.map((a, i) => `${i + 1}. [${a.id}] ${a.label}`).join('\n')
  const answer = await chat([
    {
      role: 'system',
      content:
        'Ты помогаешь тренажёру для проводников поезда понять, какое из действий ' +
        'имел в виду человек. Выбери РОВНО ОДИН идентификатор из списка или ответь ' +
        'словом НЕТ, если реплика не соответствует ни одному действию или подходит ' +
        'сразу к нескольким. Отвечай только идентификатором или словом НЕТ, ' +
        'без пояснений.'
    },
    {
      role: 'user',
      content: `Доступные действия:\n${list}\n\nРеплика проводника: «${said}»`
    }
  ], { maxTokens: 24 })

  if (!answer) return null
  const cleaned = answer.replace(/[^\w\-]/g, ' ').trim()
  // Принимаем только то, что действительно есть в списке.
  const hit = actions.find((a) => cleaned.split(/\s+/).includes(a.id))
  return hit ? hit.id : null
}

/**
 * Переформулировка реплики пассажира.
 *
 * Смысл и факты задаёт сценарий, модель меняет только форму — чтобы при
 * повторном прохождении человек не встречал дословно ту же фразу и реагировал
 * на ситуацию, а не на заученный текст. Если модель недоступна или ответила
 * странно, показывается исходная реплика из сценария.
 */
export async function paraphrase(text, { speaker, mood } = {}) {
  if (!aiEnabled() || !text) return text
  const answer = await chat([
    {
      role: 'system',
      content:
        'Перепиши реплику пассажира поезда другими словами, сохранив смысл, все ' +
        'факты, числа и степень эмоции. Не добавляй новых фактов и не смягчай ' +
        'требования. Ответь только новой репликой, одной-двумя фразами, по-русски.'
    },
    {
      role: 'user',
      content: `Говорит: ${speaker ?? 'пассажир'}${mood ? ` (${mood})` : ''}\nРеплика: «${text}»`
    }
  ], { maxTokens: 160, temperature: 0.8 })

  if (!answer) return text
  const out = answer.replace(/^[«"']|[»"']$/g, '').trim()
  // Слишком короткий или подозрительно длинный ответ — признак того,
  // что модель сделала не то, о чём просили.
  if (out.length < 12 || out.length > text.length * 2.5) return text
  return out
}
