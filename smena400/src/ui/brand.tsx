/**
 * Фирменные элементы: логотип и набор иконок.
 *
 * Иконки здесь не украшение. У каждого показателя состояния свой знак,
 * и он один и тот же во всех ситуациях: сердце — отношение человека,
 * щит — безопасность. Под таймером их различают боковым зрением,
 * и переучиваться при переходе между ситуациями не приходится.
 *
 * Всё нарисовано инлайновым SVG: набор маленький, а внешний пакет иконок
 * потянул бы зависимость ради восьми фигур.
 */

/**
 * Логотип.
 *
 * «СМЕНА» белым, «400» красным, справа — штрихи скорости. Отсылка
 * к ВСМ-400 читается сразу, и это единственное место в продукте,
 * где допущена декоративная деталь.
 */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const type = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl sm:text-5xl'
  }[size]
  const streak = { sm: 14, md: 20, lg: 34 }[size]

  return (
    <span className="inline-flex items-center gap-2 select-none" aria-label="Смена 400">
      <span className={`font-display font-bold tracking-tight leading-none ${type}`}>
        <span className="text-ink">СМЕНА</span>
        <span className="text-accent ml-1.5" style={{ fontStyle: 'italic' }}>400</span>
      </span>
      <svg
        width={streak}
        height={streak * 0.62}
        viewBox="0 0 34 21"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M6 4h26" stroke="rgb(var(--c-accent))" strokeWidth="3" strokeLinecap="round" />
        <path d="M0 10.5h22" stroke="rgb(var(--c-accent))" strokeWidth="3" strokeLinecap="round" opacity=".75" />
        <path d="M9 17h16" stroke="rgb(var(--c-accent))" strokeWidth="3" strokeLinecap="round" opacity=".45" />
      </svg>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Иконки
// ---------------------------------------------------------------------------

type IconProps = { size?: number; className?: string }

const svg = (size: number, className: string, children: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
)

/** Лояльность пассажира: отношение конкретного человека. */
export const IconHeart = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <path d="M12 20.5s-7.5-4.6-7.5-9.8A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 3.3c0 5.2-7.5 9.8-7.5 9.8Z" />
  ))

/** Безопасность: соответствие требованиям безопасного поведения. */
export const IconShield = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M12 3 5 6v5.5c0 4.3 2.9 7.7 7 9.5 4.1-1.8 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ))

/** Порядок в вагоне: как ситуацию воспринимают остальные. */
export const IconPeople = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 11a3 3 0 1 0-1.5-5.6M17 19c0-2 .6-3.5 1.7-4.5" />
    </>
  ))

/** Доверие к бригаде. */
export const IconHandshake = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <path d="m3 12 3-3 4 3.5 2-1.5 2 1.5L18 9l3 3" />
      <path d="M6 9V7h5l1 1 1-1h5v2" />
      <path d="M8 15.5 10.5 18l2-2 2 2 2.5-2.5" />
    </>
  ))

export const IconClock = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ))

export const IconCheck = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, <path d="m4.5 12.5 5 5 10-11" />)

export const IconAlert = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M12 4.5 2.8 20h18.4L12 4.5Z" />
      <path d="M12 10v4M12 17.2v.1" />
    </>
  ))

export const IconRadio = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <rect x="3" y="10" width="14" height="10" rx="2" />
      <path d="M7 10V6.5M7 14.5h4M14.5 4.5a6 6 0 0 1 5 5M14.5 7.5a3 3 0 0 1 2.2 2.2" />
    </>
  ))

export const IconTrain = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <rect x="5" y="3.5" width="14" height="13" rx="4" />
      <path d="M5 10h14M8.5 20l-2 2M15.5 20l2 2M9 13.5h.1M15 13.5h.1" />
    </>
  ))

export const IconReplay = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V10H9" />
    </>
  ))

export const IconTarget = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </>
  ))

export const IconBook = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M5 4.5h9a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H5V4.5Z" />
      <path d="M17 7.5h2v12.2a2.5 2.5 0 0 0-2.5-2.2" />
    </>
  ))

export const IconChart = ({ size = 16, className = '' }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M20.5 20H3.5" />
    </>
  ))

/** Иконка показателя по его идентификатору. */
export function ScaleIcon({
  id, size = 16, className = ''
}: { id: string; size?: number; className?: string }) {
  const map: Record<string, (p: IconProps) => JSX.Element> = {
    loyalty: IconHeart,
    safety: IconShield,
    order: IconPeople,
    trust: IconHandshake
  }
  const Cmp = map[id] ?? IconTarget
  return <Cmp size={size} className={className} />
}
