/** Мелкие форматтеры. Русская запятая в дробях и человеческие секунды. */

export const seconds = (ms: number) => {
  const s = ms / 1000
  return s < 10 ? `${s.toFixed(1).replace('.', ',')} с` : `${Math.round(s)} с`
}

export const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`.replace('-', '−'))

export const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
