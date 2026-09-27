/**
 * HTTP-слой «Смены 400».
 *
 * Здесь нет игровой логики — она вся в engine/. Задача этого файла: понять,
 * кто спрашивает, достать состояние из базы, передать ход движку, сохранить
 * результат и отдать клиенту то, что ему положено видеть.
 *
 * Главное правило: **любое действие, пришедшее от клиента, проверяется
 * заново**. Клиент присылает намерение, а не результат. Он не может сообщить
 * состояние, шкалы или переход — только «я выбираю вот это», и дальше решает
 * движок по состоянию из базы.
 *
 * Маршруты:
 *   GET  /api/health
 *   GET  /api/meta
 *   GET  /api/scenarios                 список ситуаций
 *   GET  /api/scenarios/:id             паспорт (без графа)
 *   POST /api/sessions                  начать прохождение
 *   GET  /api/sessions/:id              текущий экран
 *   POST /api/sessions/:id/actions      выбор действия / порядок / бездействие
 *   POST /api/sessions/:id/message      свободная реплика
 *   POST /api/sessions/:id/finish       прервать прохождение
 *   GET  /api/sessions/:id/debrief      разбор и сравнение с прошлой попыткой
 *   GET  /api/progress                  прогресс игрока
 */
import http from 'node:http'
import path from 'node:path'

import { availableActions, startSession, step } from '../engine/machine.js'
import { debrief, compareAttempts } from '../engine/feedback.js'
import { COMPETENCIES, SCALES } from '../engine/model.js'
import { INTENT_REASON } from '../engine/intent.js'

import { players, runs } from './lib/db.js'
import {
  bad, cookies, json, newId, ok, readBody, serveStatic, setCookie
} from './lib/http.js'
import {
  allScenarios, getScenario, loadScenarios, resultView,
  scenarioCard, scenarioPassport, screen
} from './lib/content.js'
import { aiEnabled, aiStatus, classifyFallback, paraphrase } from './lib/ai.js'

const PORT = Number(process.env.PORT || 5400)
const DIST = path.resolve('dist')
const COOKIE = 'smena400_player'

const loaded = loadScenarios()
if (!loaded.loaded) {
  console.error('[контент] не загружен ни один сценарий — играть будет не во что')
}

/**
 * Кэш переформулированных реплик.
 *
 * Текст состояния не имеет права измениться, пока игрок его читает: он
 * принимает решение по тому, что видит. Поэтому переформулировка делается
 * один раз на состояние в рамках сессии и дальше берётся отсюда.
 * Живёт в памяти: после перезапуска сервера просто вернутся исходные реплики.
 */
const lines = new Map()
const lineKey = (runId, stateId) => `${runId}:${stateId}`

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname

  if (!p.startsWith('/api/')) {
    if (serveStatic(DIST, p, res)) return
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('Клиент не собран. Выполните npm run build или npm run dev.')
  }

  try {
    // ------------------------------------------------------------ игрок
    const jar = cookies(req)
    let playerId = jar[COOKIE]
    if (!playerId || !/^p_[a-f0-9]{18}$/.test(playerId)) {
      playerId = newId('p')
      setCookie(res, COOKIE, playerId)
    }
    players.ensure(playerId)

    // ------------------------------------------------------------ общее
    if (p === '/api/health') return ok(res, { scenarios: allScenarios().length })

    if (p === '/api/meta') {
      return ok(res, {
        scales: SCALES,
        competencies: COMPETENCIES,
        ai: aiStatus()
      })
    }

    if (p === '/api/scenarios' && req.method === 'GET') {
      return ok(res, { scenarios: allScenarios().map(scenarioCard) })
    }

    const one = p.match(/^\/api\/scenarios\/([\w-]+)$/)
    if (one && req.method === 'GET') {
      const sc = getScenario(one[1])
      if (!sc) return bad(res, 'ситуация не найдена', 404)
      return ok(res, { scenario: scenarioPassport(sc) })
    }

    // --------------------------------------------------------- сессии
    if (p === '/api/sessions' && req.method === 'POST') {
      const body = await readBody(req)
      const sc = getScenario(String(body.scenarioId ?? ''))
      if (!sc) return bad(res, 'ситуация не найдена', 404)

      // Незакрытое прохождение той же ситуации помечается брошенным:
      // иначе у игрока копятся сессии, о которых он не помнит.
      const stale = runs.activeOf(playerId, sc.id)
      if (stale) runs.abandon(stale.id, stale.state)

      const state = startSession(sc)
      const id = newId('s')
      const { attempt } = runs.create({
        id, playerId, scenarioId: sc.id, scenarioVersion: sc.version ?? 1, state
      })
      const run = { id, attempt, state }
      return ok(res, { screen: await dress(sc, run) })
    }

    const sess = p.match(/^\/api\/sessions\/([\w-]+)(\/[a-z]+)?$/)
    if (sess) {
      const run = runs.byId(sess[1])
      if (!run) return bad(res, 'сессия не найдена', 404)
      if (run.playerId !== playerId) return bad(res, 'это не ваша сессия', 403)

      const sc = getScenario(run.scenarioId)
      if (!sc) return bad(res, 'ситуация больше не доступна', 410)
      const tail = sess[2] ?? ''

      // ---------------------------------------------------- текущий экран
      if (!tail && req.method === 'GET') {
        return ok(res, { screen: await dress(sc, run) })
      }

      // ---------------------------------------------------------- разбор
      if (tail === '/debrief' && req.method === 'GET') {
        if (run.status !== 'finished') return bad(res, 'прохождение ещё не закончено', 409)
        const report = run.debrief ?? debrief(sc, run.state)
        const previous = runs.finishedOf(playerId, sc.id)
          .filter((r) => r.attempt < run.attempt)
          .at(-1)
        return ok(res, {
          debrief: report,
          attempt: run.attempt,
          comparison: previous?.debrief
            ? compareAttempts(previous.debrief, report)
            : null,
          previousAttempt: previous?.attempt ?? null
        })
      }

      // ------------------------------------------------------- прерывание
      if (tail === '/finish' && req.method === 'POST') {
        if (run.status === 'active') runs.abandon(run.id, run.state)
        return ok(res, { status: 'abandoned' })
      }

      if (run.status !== 'active') return bad(res, 'прохождение уже завершено', 409)

      // ---------------------------------------------------------- ход
      if (tail === '/actions' && req.method === 'POST') {
        const body = await readBody(req)
        const input = body.timeout
          ? { timeout: true }
          : Array.isArray(body.order)
            ? { order: body.order.map(String) }
            : { actionId: String(body.actionId ?? '') }
        return play(res, sc, run, input)
      }

      // --------------------------------------------- свободная реплика
      if (tail === '/message' && req.method === 'POST') {
        const body = await readBody(req)
        const said = String(body.text ?? '').trim().slice(0, 400)
        if (!said) return bad(res, 'пустая реплика', 400)

        let out = step(sc, run.state, { said })

        /*
         * Собственный анализатор не уверен — и только в этот момент
         * подключается модель. Она возвращает кандидата из того же списка
         * разрешённых действий, после чего ход выполняется обычным путём
         * и проходит все те же проверки. Без ключа ветка просто не работает,
         * и игрок получает переспрос — как и было задумано.
         */
        if (!out.ok && out.code === 'unclear' && aiEnabled()) {
          const allowed = availableActions(sc, run.state)
          const candidate = await classifyFallback(allowed, said)
          if (candidate) {
            out = step(sc, run.state, { actionId: candidate, said, via: 'ai' })
          }
        }

        if (!out.ok && out.code === 'unclear') {
          // Не ошибка ввода, а реплика собеседника: пассажир переспрашивает.
          return json(res, 200, {
            ok: true,
            understood: false,
            reply: INTENT_REASON[out.error] ?? INTENT_REASON.unclear,
            said
          })
        }
        return finishTurn(res, sc, run, out)
      }
    }

    // ------------------------------------------------------------ прогресс
    if (p === '/api/progress' && req.method === 'GET') {
      const finished = runs.allFinished(playerId)
      const byScenario = allScenarios().map((sc) => {
        const mine = finished.filter((r) => r.scenarioId === sc.id)
        const last = mine[0] ?? null
        return {
          ...scenarioCard(sc),
          attempts: mine.length,
          lastVerdict: last?.verdict ?? null,
          lastLoyalty: last?.loyalty ?? null,
          lastSafety: last?.safety ?? null,
          best: mine.reduce((acc, r) => {
            const rank = { good: 3, mixed: 2, bad: 1 }
            return rank[r.verdict] > rank[acc] ? r.verdict : acc
          }, null)
        }
      })

      // Компетенции — из истории решений, а не из отдельного теста.
      const totals = Object.fromEntries(COMPETENCIES.map((c) => [c.id, { earned: 0, max: 0 }]))
      for (const r of finished) {
        for (const c of r.debrief?.competency ?? []) {
          if (!totals[c.id] || !c.touched) continue
          totals[c.id].earned += c.earned
          totals[c.id].max += c.max
        }
      }

      return ok(res, {
        scenarios: byScenario,
        runs: finished.length,
        competency: COMPETENCIES.map((c) => ({
          id: c.id,
          title: c.title,
          hint: c.hint,
          touched: totals[c.id].max > 0,
          pct: totals[c.id].max > 0
            ? Math.max(0, Math.min(100, Math.round((totals[c.id].earned / totals[c.id].max) * 100)))
            : null
        }))
      })
    }

    return bad(res, 'нет такого метода', 404)
  } catch (err) {
    console.error('[api]', p, err)
    return bad(res, 'внутренняя ошибка', 500)
  }
})

// ---------------------------------------------------------------------------

/** Выполнить ход и отдать новый экран. */
function play(res, sc, run, input) {
  const out = step(sc, run.state, input)
  return finishTurn(res, sc, run, out)
}

/**
 * Записать результат хода.
 *
 * Отказ движка — это не «ошибка сервера», а нормальный ответ: клиент попросил
 * то, чего нельзя. Возвращается 409 и причина, по которой нельзя.
 */
async function finishTurn(res, sc, run, out) {
  if (!out.ok) {
    return json(res, 409, {
      ok: false,
      code: out.code,
      error: out.error,
      intent: out.intent ?? null
    })
  }

  const next = { ...run, state: out.session }
  if (out.session.status === 'finished') {
    const report = debrief(sc, out.session)
    runs.finish(run.id, { state: out.session, debrief: report })
    next.debrief = report
  } else {
    runs.save(run.id, out.session)
  }

  return ok(res, {
    screen: await dress(sc, next, resultView(out.result)),
    finished: out.session.status === 'finished'
  })
}

/**
 * Экран плюс, если подключён AI, переформулированная реплика пассажира.
 *
 * Если модель недоступна, вернётся исходный текст сценария — и это
 * полноценный режим работы, а не деградация.
 */
async function dress(sc, run, lastResult = null) {
  const view = screen(sc, run, { lastResult })
  if (!aiEnabled() || !view.state || view.state.kind === 'final') return view

  const key = lineKey(run.id, view.state.id)
  if (!lines.has(key)) {
    lines.set(key, await paraphrase(view.state.text, {
      speaker: view.state.speaker,
      mood: sc.context?.urgency
    }))
  }
  return { ...view, state: { ...view.state, text: lines.get(key), rephrased: true } }
}

server.listen(PORT, () => {
  console.log(`СМЕНА 400 — сервер на http://localhost:${PORT}`)
  console.log(`Сценариев загружено: ${allScenarios().length}`)
  console.log(aiStatus().note)
})
