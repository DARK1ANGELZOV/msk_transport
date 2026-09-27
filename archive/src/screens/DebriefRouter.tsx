import { useEffect, useState } from 'react'

import { registerLine } from '../../engine/index.js'
import { api, type DebriefResponse, type TripDebriefResponse } from '../lib/api'
import { errorText } from '../App'
import { ErrorNote, Spinner } from '../ui/kit'

import { Debrief } from './Debrief'
import { TripDebrief } from './TripDebrief'

/**
 * Какой разбор открывать.
 *
 * Ссылка на разбор одна и та же — `/debrief/:id`, — потому что для сотрудника
 * это одна вещь: «посмотреть, как я прошёл». Отдельный инцидент и смена
 * различаются только подачей, и решать это должен код, а не человек,
 * которому пришлось бы помнить, куда он кликал.
 *
 * Загрузка здесь одна на оба случая: экраны разбора ничего не запрашивают
 * сами и остаются чистым отображением. Заодно это единственное место,
 * где регистрируется линия, — без неё повтор пути показал бы не те километры.
 */
export function DebriefRouter({ runId }: { runId: string }) {
  const [data, setData] = useState<DebriefResponse | TripDebriefResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setData(null)
    setError('')
    api.anyRun(runId)
      .then((r) => {
        if (r.line) registerLine(r.line)
        setData(r)
      })
      .catch((e) => setError(errorText(e)))
  }, [runId])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) return <Spinner text="Поднимаем запись" />

  return data.run.mode === 'trip'
    ? <TripDebrief data={data as TripDebriefResponse} />
    : <Debrief data={data as DebriefResponse} />
}
