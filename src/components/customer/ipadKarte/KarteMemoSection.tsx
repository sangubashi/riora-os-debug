'use client'
/**
 * KarteMemoSection.tsx — 「📝 カルテメモ」(PHASE IPAD-3・2026-09-11)。
 *
 * customer_karte_memos(長文自由記述・時系列・編集可・スタッフ記録付き)のCRUD UI。
 * IpadStaffKarteViewの左カラムに追加する自己完結セクション。
 *
 * 見た目の操作パターン(カード一覧→編集ボタン→テキストエリア+保存/キャンセル→削除)は
 * CustomerMemoryTab.tsxを踏襲しているが、配色はIpadStaffKarteViewに合わせて
 * PhotoCompareKit.tsxのPALETTE(アイボリー×ゴールド)に統一している。
 *
 * 絶対ルール: このファイルをProposalOrchestrator/FireScore/PatternEngine/LINE提案/
 * TodayFocusCardのいずれにもimportしないこと。content参照禁止
 * (src/types/customerKarteMemo.tsの絶対ルールに準拠)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, Check, X, ClipboardPaste } from 'lucide-react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, Card } from '@/components/customer/shared/PhotoCompareKit'
import type { CustomerKarteMemo } from '@/types/customerKarteMemo'

interface Props {
  customerId: string
  /**
   * 「前回メモをワンタップ参照」機能(PHASE IPAD-PREV-MEMO-1・2026-09-20ユーザー承認)用:
   * ipadKarteData.tsで算出済みの「前回」(本日のvisitを除いた直近の来店)の来店日・
   * メニュー名・施術メモ。いずれも前回来店が無ければnull。
   */
  previousVisitDate?: string | null
  previousMenuName?: string | null
  previousTreatmentMemo?: string | null
  /**
   * 店舗共通ログイン+担当者タグ選択機能(PHASE IPAD-SHARED-LOGIN-1・2026-09-20ユーザー承認)用:
   * 選択済みの担当者(brain_staff.id)。個人ログイン時は常にnull(サーバー側でJWTから
   * 解決した本人のstaff_idがそのまま使われ、この値は無視される)。
   */
  staffIdOverride?: string | null
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDateOnly(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
}

function isSameLocalDate(iso: string, other: Date): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d.getFullYear() === other.getFullYear()
    && d.getMonth() === other.getMonth()
    && d.getDate() === other.getDate()
}

export default function KarteMemoSection({
  customerId, previousVisitDate = null, previousMenuName = null, previousTreatmentMemo = null,
  staffIdOverride = null,
}: Props) {
  const [memos, setMemos] = useState<CustomerKarteMemo[]>([])
  const [loading, setLoading] = useState(true)
  // 「前回の記録を見る」折りたたみ(デフォルト展開状態・PHASE IPAD-KARTE-DETAIL-UI-1
  // UI刷新・2026-09-20ユーザー承認で変更。以前はデフォルト閉じていたが、カルテメモを
  // 画面上部へ移動したことに伴い初期表示から見えるようにした。開閉ボタン自体は無変更)。
  const [previousOpen, setPreviousOpen] = useState(true)

  // 追加欄は常時展開(2026-09-24ユーザー承認: 「＋カルテメモを追加」ボタンを押さないと
  // 入力欄が出ない仕様だと一手間かかるため、初期状態から入力欄を表示する)。
  const [adding, setAdding] = useState(true)
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [updating, setUpdating] = useState(false)

  const newContentRef = useRef<HTMLTextAreaElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/customer-karte-memos?customer_id=${encodeURIComponent(customerId)}`)
      if (res.ok) {
        const json = await res.json() as { memos: CustomerKarteMemo[] }
        setMemos(json.memos ?? [])
      }
    } catch { /* 取得失敗時は前回の表示を維持する */ }
    finally { setLoading(false) }
  }, [customerId])

  useEffect(() => { void load() }, [load])

  async function handleAdd() {
    if (!newContent.trim() || saving) return
    setSaving(true)
    try {
      const res = await authedFetch('/api/customer-karte-memos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          content: newContent.trim(),
          ...(staffIdOverride ? { staff_id: staffIdOverride } : {}),
        }),
      })
      if (!res.ok) throw new Error()
      setNewContent('')
      // 追加欄は常時展開のため、保存後もsetAdding(false)で閉じない(連続で書き込める)。
      await load()
    } catch { /* 失敗時は入力内容を保持したままにする */ }
    finally { setSaving(false) }
  }

  function startEdit(m: CustomerKarteMemo) {
    setEditingId(m.id)
    setEditContent(m.content)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditContent('')
  }

  async function handleUpdate() {
    if (!editingId || !editContent.trim() || updating) return
    setUpdating(true)
    try {
      const res = await authedFetch(`/api/customer-karte-memos/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, content: editContent.trim() }),
      })
      if (!res.ok) throw new Error()
      cancelEdit()
      await load()
    } catch { /* 失敗時は編集状態を維持する */ }
    finally { setUpdating(false) }
  }

  /**
   * サロンボード等の過去メモ貼り付け機能(2026-09-25ユーザー承認・仕様変更):
   * 移行期でアプリ内に過去メモがまだ存在しないため、当初実装した「アプリ内の過去メモを
   * 引用する」ボタンは廃止し、スタッフがホットペッパービューティー(サロンボード)側で
   * コピーしたテキストをクリップボードから直接貼り付けられる方式に置き換えた。
   * 追記先は「今回のカルテメモ」入力欄(newContent)。すでに入力中のテキストがある場合は
   * 上書きせず末尾に改行して追記する安全設計。保存処理・DB構造には触れない
   * (フロントエンドの入力欄操作のみ)。
   */
  function appendToNewContent(text: string) {
    setAdding(true)
    setNewContent(prev => {
      const trimmed = prev.trimEnd()
      return trimmed.length > 0 ? `${trimmed}\n${text}` : text
    })
    // setNewContentの反映(再描画)後にフォーカス・カーソルを末尾へ移動する。
    requestAnimationFrame(() => {
      const el = newContentRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  }

  async function handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error('クリップボードにテキストがありません')
        return
      }
      appendToNewContent(text)
      toast.success('クリップボードから貼り付けました', { duration: 1500 })
    } catch {
      // iPad Safari等でクリップボード読み取り権限が無い場合はここに到達する。
      // 入力欄自体はネイティブのペースト(長押し→貼り付け)にそのまま対応しているため、
      // その操作を促す(onPaste等の横取りは一切行っていない)。
      toast.error('自動貼り付けができませんでした。入力欄を長押しして貼り付けてください')
      setAdding(true)
      requestAnimationFrame(() => newContentRef.current?.focus())
    }
  }

  async function handleDelete(id: string) {
    const res = await authedFetch(`/api/customer-karte-memos/${id}?customer_id=${encodeURIComponent(customerId)}`, {
      method: 'DELETE',
    })
    if (!res.ok) return
    setMemos(prev => prev.filter(m => m.id !== id))
    if (editingId === id) cancelEdit()
  }

  // 「前回のカルテメモ」= 今日すでに書いた分(あれば)を除いた直近1件(2026-09-20ユーザー承認:
  // 施術中に今日のメモを書き込んでも、参照データが常に「前回来店時のメモ」であり続けるように
  // するため)。memosはcreated_at DESCで取得済み(load()参照)。
  const today = new Date()
  const previousMemo = memos.find(m => !isSameLocalDate(m.created_at, today)) ?? null
  const hasPreviousRecord = previousVisitDate !== null || previousMemo !== null || (previousTreatmentMemo?.trim().length ?? 0) > 0

  return (
    <Card title="📝 カルテメモ">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {loading && (
          <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>読み込み中…</p>
        )}

        {!loading && memos.length === 0 && !adding && (
          <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>まだ記録されていません</p>
        )}

        {!loading && memos.map(m => {
          const isEditing = editingId === m.id
          const edited = m.updated_at !== m.created_at

          if (isEditing) {
            return (
              <div
                key={m.id}
                style={{
                  border: `1.5px solid ${PALETTE.gold}`, borderRadius: '12px',
                  padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px',
                  background: PALETTE.card,
                }}
              >
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={14}
                  autoFocus
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '340px',
                    fontSize: '15px', color: PALETTE.text, lineHeight: 1.8,
                    border: `1px solid ${PALETTE.border}`, borderRadius: '8px', padding: '10px',
                    outline: 'none', fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      fontSize: '11px', padding: '6px 12px', borderRadius: '999px',
                      border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.muted,
                      cursor: 'pointer',
                    }}
                  >
                    <X size={11} />キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUpdate()}
                    disabled={updating}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      fontSize: '11px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px',
                      border: 'none', background: updating ? PALETTE.border : PALETTE.gold, color: '#fff',
                      cursor: updating ? 'default' : 'pointer',
                    }}
                  >
                    <Check size={11} />{updating ? '更新中…' : '更新する'}
                  </button>
                </div>
              </div>
            )
          }

          return (
            <div
              key={m.id}
              style={{
                border: `1px solid ${PALETTE.border}`, borderRadius: '12px', padding: '12px',
                background: PALETTE.card, display: 'flex', flexDirection: 'column', gap: '6px',
              }}
            >
              <p style={{ margin: 0, fontSize: '15px', color: PALETTE.text, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.content}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <p style={{ margin: 0, fontSize: '10px', color: PALETTE.muted }}>
                  {formatDateTime(m.created_at)}
                  {m.staffName ? ` ・ ${m.staffName}` : ''}
                  {edited ? '(編集済み)' : ''}
                </p>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => startEdit(m)}
                    aria-label="編集"
                    style={{
                      width: '30px', height: '30px', borderRadius: '50%', border: `1px solid ${PALETTE.border}`,
                      background: PALETTE.bg, color: PALETTE.gold, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', cursor: 'pointer',
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(m.id)}
                    aria-label="削除"
                    style={{
                      width: '30px', height: '30px', borderRadius: '50%', border: '1px solid rgba(196,90,90,0.3)',
                      background: 'rgba(196,90,90,0.08)', color: '#B85050', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {/* 前回メモをワンタップ参照(PHASE IPAD-PREV-MEMO-1・2026-09-20ユーザー承認)。
            デフォルト閉じた状態・タップで展開。前回の施術メモ・前回のカルテメモをそのまま
            表示する(注意点等は独立項目を設けず、これらの自由記述文にすでに含まれている
            前提)。前回来店・前回メモ・前回施術メモのいずれも無ければボタン自体を出さない。 */}
        {!loading && hasPreviousRecord && (
          <div style={{ border: `1px solid ${PALETTE.border}`, borderRadius: '10px', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setPreviousOpen(v => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 12px', border: 'none', background: PALETTE.card,
                color: PALETTE.gold, fontSize: '12px', fontWeight: 700, cursor: 'pointer',
              }}
            >
              {previousOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              前回の記録を見る
              {previousVisitDate && (
                <span style={{ fontWeight: 400, color: PALETTE.muted }}>
                  ({formatDateOnly(previousVisitDate)}{previousMenuName ? `・${previousMenuName}` : ''})
                </span>
              )}
            </button>
            {previousOpen && (
              <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: `1px solid ${PALETTE.border}` }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 700, color: PALETTE.muted }}>前回の施術メモ</p>
                  <p style={{ margin: 0, fontSize: '15px', color: PALETTE.text, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {previousTreatmentMemo?.trim() ? previousTreatmentMemo : '記録がありません'}
                  </p>
                </div>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 700, color: PALETTE.muted }}>前回のカルテメモ</p>
                  {previousMemo ? (
                    <>
                      <p style={{ margin: 0, fontSize: '15px', color: PALETTE.text, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {previousMemo.content}
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '10px', color: PALETTE.muted }}>
                        {formatDateTime(previousMemo.created_at)}
                        {previousMemo.staffName ? ` ・ ${previousMemo.staffName}` : ''}
                      </p>
                    </>
                  ) : (
                    <p style={{ margin: 0, fontSize: '15px', color: PALETTE.text }}>記録がありません</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {adding ? (
          <div style={{ border: `1.5px solid ${PALETTE.gold}`, borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* サロンボード等の過去メモ貼り付け(2026-09-25ユーザー承認)。押しやすいよう
                入力欄のすぐ上、幅いっぱいに配置する(iPadタッチ操作を考慮しpaddingを広めに)。 */}
            <button
              type="button"
              onClick={() => void handlePasteFromClipboard()}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                fontSize: '13px', fontWeight: 700, padding: '10px', borderRadius: '10px',
                border: `1.5px dashed ${PALETTE.gold}`, background: 'transparent', color: PALETTE.gold,
                cursor: 'pointer',
              }}
            >
              <ClipboardPaste size={15} />サロンボードのメモを貼り付け
            </button>
            <textarea
              ref={newContentRef}
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={14}
              autoFocus
              placeholder="今日の接客で気づいたこと、施術中の様子など自由に記録してください(上のボタンでクリップボードから貼り付け、または直接長押しして貼り付けできます)"
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '340px',
                fontSize: '15px', color: PALETTE.text, lineHeight: 1.8,
                border: `1px solid ${PALETTE.border}`, borderRadius: '8px', padding: '10px',
                outline: 'none', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setAdding(false); setNewContent('') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  fontSize: '11px', padding: '6px 12px', borderRadius: '999px',
                  border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.muted,
                  cursor: 'pointer',
                }}
              >
                <X size={11} />キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={saving}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  fontSize: '11px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px',
                  border: 'none', background: saving ? PALETTE.border : PALETTE.gold, color: '#fff',
                  cursor: saving ? 'default' : 'pointer',
                }}
              >
                <Check size={11} />{saving ? '保存中…' : '保存する'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              fontSize: '12px', fontWeight: 700, padding: '10px', borderRadius: '10px',
              border: `1.5px dashed ${PALETTE.border}`, background: 'transparent', color: PALETTE.gold,
              cursor: 'pointer',
            }}
          >
            <Plus size={13} strokeWidth={2.4} />カルテメモを追加
          </button>
        )}
      </div>
    </Card>
  )
}
