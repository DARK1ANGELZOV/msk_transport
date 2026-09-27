/**
 * Полный расчёт одного прохождения: путь → результат, проценты, достижения.
 *
 * Единственная функция, которую вызывает сервер, принимая инцидент.
 * Вынесена из index.js отдельным файлом, потому что ею пользуется и рейс
 * (engine/trip.js), а импортировать общий индекс из его же части —
 * верный способ получить кольцевую зависимость.
 */
import { replay } from './replay.js'
import { analyze, competencyPercent, scorePercent } from './scoring.js'
import { earned } from './achievements.js'

export function grade(scenario, path, context = {}) {
  const run = replay(scenario, path, {
    strict: context.strict !== false,
    // Состояние, перенесённое из предыдущего инцидента рейса.
    carry: context.carry ?? null
  })
  const analysis = analyze(scenario)
  run.maxScore = analysis.maxScore
  run.scorePct = run.ok ? scorePercent(scenario, run.score) : 0
  run.competencyPct = run.ok ? competencyPercent(scenario, run.competency) : {}
  run.achievements = run.ok
    ? earned({
        run,
        scenario,
        runsTotal: context.runsTotal ?? 1,
        streakDays: context.streakDays ?? 0,
        duelsReviewed: context.duelsReviewed ?? 0
      })
    : []
  return run
}
