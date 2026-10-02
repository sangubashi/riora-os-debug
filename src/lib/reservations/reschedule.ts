/**
 * reschedule.ts — 「別日に予約」(/karte、2026-10-02)の日時の組み立て・検証・重なり判定(純粋関数)。
 *
 * 日付(YYYY-MM-DD)と時刻(HH:mm)は常に日本時間(JST、+09:00固定)として扱う。端末のタイムゾーンや
 * サーバーのタイムゾーンには依存しない。
 */

export const RESCHEDULE_MINUTE_STEP = 5

/** "YYYY-MM-DD" と "HH:mm"(JST)から、+09:00付きのISO文字列を作る。不正ならnull。 */
export function buildScheduledAtJst(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [h, mi] = [Number(t[1]), Number(t[2])]
  if (h > 23 || mi > 59 || mi % RESCHEDULE_MINUTE_STEP !== 0) return null
  const probe = new Date(Date.UTC(y, mo - 1, da))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d[1]}-${p(mo)}-${p(da)}T${p(h)}:${p(mi)}:00+09:00`
}

/** 開始時刻(ISO)と所要時間(分)から [start, end) をミリ秒で返す。 */
function range(startIso: string, durationMinutes: number): [number, number] {
  const s = new Date(startIso).getTime()
  return [s, s + Math.max(1, durationMinutes) * 60_000]
}

/** 2つの予約の時間帯が重なるか(隣り合う=終了と開始が同時刻は重ならない)。 */
export function reservationsOverlap(
  aStartIso: string, aDurationMinutes: number, bStartIso: string, bDurationMinutes: number,
): boolean {
  const [as, ae] = range(aStartIso, aDurationMinutes)
  const [bs, be] = range(bStartIso, bDurationMinutes)
  return as < be && bs < ae
}

/** 過去の日時か(現在時刻より前)。 */
export function isPastDateTime(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() < now.getTime()
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** JSTで "10/5(日) 14:00" 形式。表示専用。 */
export function formatJstMonthDayTime(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}(${WEEKDAYS[jst.getUTCDay()]}) ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`
}

/** JSTの "YYYY-MM-DD" と "HH:mm" に分解する(ダイアログの初期値用)。 */
export function splitJstDateTime(iso: string): { date: string; time: string } {
  const jst = new Date(new Date(iso).getTime() + 9 * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}`,
    time: `${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`,
  }
}

export function todayJstDate(now: Date = new Date()): string {
  return splitJstDateTime(now.toISOString()).date
}
