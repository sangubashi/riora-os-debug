/**
 * birthDate.ts — 生年月日の入力パース・年齢計算・表示整形(2026-09-24ユーザー承認)。
 *
 * SalonBoard等からのコピペ入力(「1986/05/30」「1986年5月30日」等の表記ゆれ)を
 * 吸収してISO日付(YYYY-MM-DD)に正規化する。保存後の表示・年齢計算は常にこの
 * ISO形式を前提にする。
 */

const MIN_YEAR = 1900

/** 「1986/05/30」「1986-5-30」「1986.05.30」「1986年5月30日」等を"YYYY-MM-DD"へ正規化する。解釈できなければnull。 */
export function parseFlexibleBirthDateInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const jpMatch = trimmed.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/)
  const slashMatch = trimmed.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/)
  const m = jpMatch ?? slashMatch
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < MIN_YEAR || year > new Date().getFullYear()) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(year, month - 1, day)
  // Dateはオーバーフローを自動繰り上げる(例: 2/30→3/2)ため、往復チェックで無効日を弾く。
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  if (date.getTime() > Date.now()) return null // 未来日は不可

  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/** "YYYY-MM-DD"から満年齢を計算する(誕生日を迎えていなければ1引く)。不正な値はnull。 */
export function calculateAge(birthDate: string): number | null {
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  const birth = new Date(Number(y), Number(mo) - 1, Number(d))
  if (Number.isNaN(birth.getTime())) return null

  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate())
  if (!hasHadBirthdayThisYear) age -= 1
  return age
}

/** "YYYY-MM-DD" → "1986年5月30日"。不正な値はnull。 */
export function formatBirthDateJapanese(birthDate: string): string | null {
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  return `${y}年${Number(mo)}月${Number(d)}日`
}

/** "YYYY-MM-DD" → "1986/05/30"。不正な値はnull。 */
export function formatBirthDateSlash(birthDate: string): string | null {
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  return `${y}/${mo}/${d}`
}
