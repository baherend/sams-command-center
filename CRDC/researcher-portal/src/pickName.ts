import { translateDbText } from './i18n'

type Named = { name_ar?: string | null; name_en?: string | null }

/** English name from the database when present, else the Arabic name through the translation map. */
export function pickName(row: Named | null | undefined, lang: 'ar' | 'en'): string {
  if (!row) return ''
  const en = row.name_en?.trim()
  if (lang === 'en' && en) return en
  return translateDbText(row.name_ar ?? undefined, lang === 'en') ?? ''
}