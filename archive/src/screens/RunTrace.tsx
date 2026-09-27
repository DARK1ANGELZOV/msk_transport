import { useMemo } from 'react'

import {
  leadBoundaryKm, type Line, type Scenario, type VisitedEntry
} from '../../engine/index.js'
import { km as kmText, mmss } from '../lib/format'
import { Label } from '../ui/kit'

/**
 * След рейса на линии.
 *
 * Разбор по шагам отвечает на вопрос «что вы сделали». Этот след отвечает
 * на другой: «где вы были, когда это делали». Расстояние между двумя
 * соседними точками — это километры, пройденные составом, пока решение
 * принималось. Именно они и есть цена секунды, увиденная глазами.
 *
 * Масштаб берётся по самим решениям, а не по расстоянию до станции: если
 * до остановки ещё двести километров, вытянутая до неё ось сплющила бы весь
 * эпизод в точку у левого края. Станция в таком случае показывается меткой
 * за правым обрезом с подписью, сколько до неё осталось.
 */
export function RunTrace({
  line, scenario, visited, onPick, selected
}: {
  line: Line
  scenario: Scenario
  visited: VisitedEntry[]
  onPick: (index: number) => void
  selected: number | null
}) {
  const service = scenario.context?.service ?? ''
  const back = line.services.find((s) => s.id === service)?.direction === 'back'

  const geo = useMemo(() => {
    const points = visited
      .map((v, i) => ({ i, km: v.world?.km, entry: v }))
      .filter((p): p is { i: number; km: number; entry: VisitedEntry } => typeof p.km === 'number')
    if (points.length < 2) return null

    const project = (km: number) => (back ? -km : km)
    const first = project(points[0].km)
    const last = project(points.at(-1)!.km)
    const pad = Math.max(0.6, (last - first) * 0.12)
    const start = first - pad
    const end = last + pad
    const span = Math.max(0.5, end - start)
    const at = (km: number) => ((project(km) - start) / span) * 100

    const stopName = visited.at(-1)?.world?.stopName ?? null
    const stop = line.stations.find((s) => s.name === stopName) ?? null
    const stopX = stop ? at(stop.km) : null
    const stopVisible = stopX !== null && stopX <= 100

    const boundary = stop
      ? leadBoundaryKm(line, service, stop.km, line.dispatch?.medicalLeadSec ?? 300)
      : null
    const boundaryX = boundary === null ? null : at(boundary)

    // Подписи километров ставим только там, где они не наедут друг на друга.
    let lastLabelX = -100
    const withLabels = points.map((p, idx) => {
      const x = at(p.km)
      const show = idx === 0 || idx === points.length - 1 || x - lastLabelX > 9
      if (show) lastLabelX = x
      return { ...p, x, label: show }
    })

    return {
      points: withLabels,
      stopX: stopVisible ? stopX : null,
      stopName,
      stopBeyondKm: stop && !stopVisible
        ? Math.abs(stop.km - points.at(-1)!.km)
        : null,
      boundaryX: boundaryX !== null && boundaryX <= 100 ? boundaryX : null,
      fromKm: points[0].km,
      toKm: points.at(-1)!.km
    }
  }, [line, visited, back, service])

  if (!geo) return null

  const travelled = Math.abs(geo.toKm - geo.fromKm)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Label>След на линии</Label>
        <span className="label">
          {geo.fromKm.toFixed(1).replace('.', ',')} → {geo.toKm.toFixed(1).replace('.', ',')} км
          {' · '}пройдено {kmText(travelled * 1000)}
          {geo.stopBeyondKm !== null && geo.stopName
            ? ` · ${geo.stopName} — ещё ${Math.round(geo.stopBeyondKm)} км`
            : ''}
        </span>
      </div>

      <div className="card px-5 pt-6 pb-7">
        <div className="relative h-12">
          <div className="absolute inset-x-0 top-4 h-px bg-line" />

          {geo.boundaryX !== null ? (
            <div
              className="absolute top-0 bottom-4 border-l border-warn/60 bg-warn/10"
              style={{ left: `${geo.boundaryX}%`, right: 0 }}
              title="За этой чертой заказ на ближайшую остановку диспетчер согласовать не успевает"
            />
          ) : null}

          {geo.stopX !== null ? (
            <div className="absolute top-0 h-8 w-px bg-ink" style={{ left: `${geo.stopX}%` }} />
          ) : null}

          {geo.points.map((p) => {
            const active = selected === p.i
            const tone = p.entry.timeout ? 'bg-danger' : active ? 'bg-accent' : 'bg-ink'
            return (
              <button
                key={p.i}
                className="absolute top-2 -ml-2.5 w-5 h-5 grid place-items-center group"
                style={{ left: `${Math.max(0, Math.min(100, p.x))}%` }}
                onClick={() => onPick(p.i)}
                aria-label={`Шаг ${p.i + 1}, ${p.km.toFixed(1)} км`}
                title={`${p.km.toFixed(1)} км · ${mmss(p.entry.atTripSec)} · ${
                  p.entry.timeout
                    ? 'решение не принято'
                    : p.entry.picked.map((x) => x.text).join(' · ')
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${tone} transition-transform ${
                    active ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''
                  } group-hover:scale-125`}
                />
              </button>
            )
          })}

          {geo.points.filter((p) => p.label).map((p) => (
            <span
              key={`l-${p.i}`}
              className="absolute top-8 -translate-x-1/2 num text-[0.6rem] text-faint whitespace-nowrap"
              style={{ left: `${Math.max(0, Math.min(100, p.x))}%` }}
            >
              {p.km.toFixed(1).replace('.', ',')}
            </span>
          ))}

          {geo.stopX !== null && geo.stopName ? (
            <span
              className="absolute top-8 num text-[0.6rem] text-ink -translate-x-full pr-1 whitespace-nowrap"
              style={{ left: `${geo.stopX}%` }}
            >
              {geo.stopName}
            </span>
          ) : null}

        </div>
      </div>

      <p className="text-sm text-faint max-w-[65ch]">
        Точки — ваши решения, подписи под ними — километровые отметки. Красная точка
        означает, что решение не было принято в отведённое время.
        {geo.boundaryX !== null
          ? ' Янтарная зона у станции — участок, на котором заказ медиков на эту остановку диспетчер уже не успевает согласовать.'
          : ''}
      </p>
    </div>
  )
}
