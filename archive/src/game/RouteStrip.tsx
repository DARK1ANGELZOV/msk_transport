import { useMemo } from 'react'

import { leadBoundaryKm, type Line, type World } from '../../engine/index.js'
import { mmss } from '../lib/format'

/**
 * Полоса маршрута: где состав, что впереди и где точка невозврата.
 *
 * Это главный прибор тренажёра. Пока проводник читает реплику пассажира,
 * метка ползёт вправо, тормозной путь тянется за ней, а заштрихованная зона
 * у станции приближается — и когда метка в неё войдёт, заказать медиков
 * на эту остановку будет уже нельзя. Ни одного таймера: только километры.
 *
 * Ось — расстояние, а не время: полоса показывает пространство, в котором
 * состав находится физически. Поэтому зона невозврата вычисляется через
 * профиль движения, а не откладывается «на глаз».
 */
export function RouteStrip({
  line, service, world, leadSec
}: {
  line: Line
  service: string
  world: World
  leadSec: number
}) {
  const stop = useMemo(
    () => line.stations.find((s) => s.name === world.stopName) ?? null,
    [line, world.stopName]
  )

  const geometry = useMemo(() => {
    if (!stop || typeof world.km !== 'number') return null
    const back = line.services.find((s) => s.id === service)?.direction === 'back'
    const boundary = leadBoundaryKm(line, service, stop.km, leadSec)

    // Ось всегда слева направо по ходу движения, независимо от направления.
    const project = (km: number) => (back ? -km : km)
    const now = project(world.km)
    const end = project(stop.km)
    // Немного места позади состава, чтобы метка не липла к краю.
    const start = now - Math.max(4, (end - now) * 0.12)
    const span = Math.max(1, end - start)

    const at = (km: number) => ((project(km) - start) / span) * 100
    const brakingKm = (world.brakingM ?? 0) / 1000

    return {
      trainAt: at(world.km),
      boundaryAt: boundary === null ? null : at(boundary),
      brakingAt: at(back ? world.km - brakingKm : world.km + brakingKm),
      boundaryKm: boundary
    }
  }, [line, service, stop, world.km, world.brakingM, leadSec])

  if (!stop || !geometry || typeof world.km !== 'number') return null

  const inside = geometry.boundaryAt !== null && geometry.trainAt >= geometry.boundaryAt
  const distanceKm = (world.stopDistanceM ?? 0) / 1000

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-7">
        {/* Полотно */}
        <div className="absolute inset-x-0 top-3.5 h-px bg-line" />

        {/* Зона, в которой заказ на эту станцию уже не согласуют */}
        {geometry.boundaryAt !== null ? (
          <div
            className={`absolute top-1 h-6 border-l ${
              inside ? 'border-danger bg-danger/15' : 'border-warn/60 bg-warn/10'
            }`}
            style={{
              left: `${Math.max(0, Math.min(100, geometry.boundaryAt))}%`,
              right: 0
            }}
            title={`После ${Math.round(geometry.boundaryKm ?? 0)} км заказ на ${stop.name} диспетчер не успеет согласовать`}
          />
        ) : null}

        {/* Тормозной путь: сколько состав проедет, если затормозить прямо сейчас */}
        <div
          className="absolute top-3 h-1.5 bg-accent/35"
          style={{
            left: `${Math.max(0, Math.min(100, geometry.trainAt))}%`,
            width: `${Math.max(0, Math.min(100, geometry.brakingAt - geometry.trainAt))}%`
          }}
          title={`Экстренное торможение — ${((world.brakingM ?? 0) / 1000).toFixed(1)} км`}
        />

        {/* Состав */}
        <div
          className="absolute top-1.5 -ml-1 w-2 h-5 bg-accent transition-[left] duration-500 ease-linear"
          style={{ left: `${Math.max(0, Math.min(100, geometry.trainAt))}%` }}
        />

        {/* Станция */}
        <div className="absolute right-0 top-1 w-px h-6 bg-ink" />
      </div>

      <div className="flex items-baseline justify-between gap-3 font-mono text-[0.68rem] tracking-[0.06em]">
        <span className="text-ink">
          <span className="tabular-nums">{world.km.toFixed(1).replace('.', ',')}</span> км
        </span>
        <span className={inside ? 'text-danger' : 'text-faint'}>
          {inside
            ? 'окно заказа закрыто'
            : `торможение ${((world.brakingM ?? 0) / 1000).toFixed(1)} км`}
        </span>
        <span className="text-ink text-right">
          {stop.name} · <span className="tabular-nums">{distanceKm.toFixed(0)}</span> км ·{' '}
          <span className="tabular-nums">{mmss(world.toStopSec ?? 0)}</span>
        </span>
      </div>
    </div>
  )
}
