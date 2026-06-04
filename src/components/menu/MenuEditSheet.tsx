'use client'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Clock, DollarSign, Tag, Link2 } from 'lucide-react'
import { useMenuStore, type MenuCategory } from '@/store/useMenuStore'
import SubscriptionToggle from './SubscriptionToggle'
import OptionSelector     from './OptionSelector'

const CATEGORIES: { value: MenuCategory; label: string }[] = [
  { value: 'facial',       label: '施術メニュー' },
  { value: 'option',       label: 'オプション'   },
  { value: 'subscription', label: 'サブスク'      },
]

function FormLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[9px] tracking-[0.22em] font-medium block mb-1.5"
      style={{ color: '#9A7E74' }}
    >
      {children}
    </span>
  )
}

function LightInput({
  value, onChange, placeholder, type = 'text', multiline = false,
}: {
  value: string | number
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  multiline?: boolean
}) {
  const style: React.CSSProperties = {
    background: 'rgba(255,255,255,0.80)',
    border: '1px solid #F3E3E6',
    borderRadius: 16,
    padding: '12px 16px',
    fontSize: 13,
    color: '#5C4033',
    outline: 'none',
    width: '100%',
    fontFamily: 'inherit',
    lineHeight: 1.6,
  }

  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        style={{ ...style, resize: 'none' }}
        className="placeholder:text-[#C8A8B0]"
      />
    )
  }
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={style}
      className="placeholder:text-[#C8A8B0]"
    />
  )
}

export default function MenuEditSheet() {
  const {
    isEditOpen, isAddOpen, editingMenu, draft,
    updateDraft, saveEdit, closeEdit, closeAdd,
    openOptionSelector, options,
  } = useMenuStore()

  const isOpen  = isEditOpen || isAddOpen
  const isAdd   = isAddOpen && !isEditOpen
  const onClose = isEditOpen ? closeEdit : closeAdd

  const linkedOpts = options.filter(o => (draft.linkedOptionIds ?? []).includes(o.id))

  const handleSave = () => {
    if (isAdd) {
      useMenuStore.setState(s => ({
        menus: [...s.menus, {
          id: `menu-${Date.now()}`,
          name: draft.name ?? '新メニュー',
          category: draft.category ?? 'facial',
          price: Number(draft.price ?? 0),
          duration: Number(draft.duration ?? 60),
          isActive: draft.isActive ?? true,
          description: draft.description ?? '',
          rank: s.menus.length + 1,
          monthlyCount: 0,
          repeatRate: 0, profitMargin: 0, aiRecommendRate: 0,
          nextVisitRate: 0, upsellSuccessRate: 0, vipConversionRate: 0,
          trend: 'stable' as const,
          isSubscribable: draft.isSubscribable ?? false,
          linkedOptionIds: draft.linkedOptionIds ?? [],
          lineTags: draft.lineTags ?? [],
        }],
        isAddOpen: false,
        draft: {},
      }))
      return
    }
    saveEdit()
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="edit-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-50"
              style={{ background: 'rgba(92,64,51,0.25)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            />

            <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center">
              <motion.div
                key="edit-sheet"
                initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 280 }}
                drag="y" dragConstraints={{ top: 0 }} dragElastic={{ top: 0, bottom: 0.3 }}
                onDragEnd={(_, info) => { if (info.offset.y > 100) onClose() }}
                className="w-full max-w-[430px] rounded-t-[28px] flex flex-col"
                style={{
                  background: 'linear-gradient(180deg, #FFF9F8 0%, #FFF5F6 100%)',
                  border: '1px solid #F3E3E6',
                  borderBottom: 'none',
                  maxHeight: '92dvh',
                  paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
                  boxShadow: '0 -8px 40px rgba(232,145,166,0.14)',
                }}
              >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
                  <div className="w-10 h-1 rounded-full" style={{ background: '#F3E3E6' }} />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-5 pb-4 flex-shrink-0">
                  <div>
                    <h2 className="text-[17px] font-light" style={{ color: '#5C4033' }}>
                      {isAdd ? 'メニューを追加' : `${editingMenu?.name ?? 'メニュー'} を編集`}
                    </h2>
                    <p className="text-[11px] mt-0.5" style={{ color: '#9A7E74' }}>
                      {isAdd ? '新しいメニューを作成します' : 'メニュー情報を変更できます'}
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: '#FFF0F2', border: '1px solid #F3E3E6' }}
                  >
                    <X size={15} style={{ color: '#9A7E74' }} />
                  </button>
                </div>

                {/* Form */}
                <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-4" style={{ scrollbarWidth: 'none' }}>

                  {/* カテゴリ */}
                  <div>
                    <FormLabel>CATEGORY</FormLabel>
                    <div className="grid grid-cols-3 gap-2">
                      {CATEGORIES.map(cat => (
                        <button
                          key={cat.value}
                          onClick={() => updateDraft({ category: cat.value })}
                          className="py-2 rounded-xl text-[11px] font-medium border transition-colors"
                          style={
                            draft.category === cat.value
                              ? { background: 'rgba(234,145,166,0.12)', borderColor: 'rgba(234,145,166,0.30)', color: '#EA91A6' }
                              : { background: '#FFF5F6', borderColor: '#F3E3E6', color: '#9A7E74' }
                          }
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 名前 */}
                  <div>
                    <FormLabel>MENU NAME</FormLabel>
                    <LightInput
                      value={draft.name ?? ''}
                      onChange={v => updateDraft({ name: v })}
                      placeholder="メニュー名を入力"
                    />
                  </div>

                  {/* 説明 */}
                  <div>
                    <FormLabel>DESCRIPTION</FormLabel>
                    <LightInput
                      value={draft.description ?? ''}
                      onChange={v => updateDraft({ description: v })}
                      placeholder="このメニューの説明"
                      multiline
                    />
                  </div>

                  {/* 料金 + 時間 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FormLabel>
                        <span className="flex items-center gap-1">
                          <DollarSign size={8} />PRICE (¥)
                        </span>
                      </FormLabel>
                      <LightInput
                        value={draft.price ?? ''}
                        onChange={v => updateDraft({ price: Number(v) || 0 })}
                        placeholder="15000"
                        type="number"
                      />
                    </div>
                    <div>
                      <FormLabel>
                        <span className="flex items-center gap-1">
                          <Clock size={8} />DURATION (min)
                        </span>
                      </FormLabel>
                      <LightInput
                        value={draft.duration ?? ''}
                        onChange={v => updateDraft({ duration: Number(v) || 0 })}
                        placeholder="60"
                        type="number"
                      />
                    </div>
                  </div>

                  {/* ステータス + サブスク */}
                  <div className="flex items-center gap-3">
                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      onClick={() => updateDraft({ isActive: !(draft.isActive ?? true) })}
                      className="flex items-center gap-2 rounded-full px-3 py-1.5 border text-[11px] font-medium transition-colors"
                      style={
                        draft.isActive
                          ? { background: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.25)', color: '#34D399' }
                          : { background: '#FFF5F6', borderColor: '#F3E3E6', color: '#9A7E74' }
                      }
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: draft.isActive ? '#34D399' : '#E8D5D9' }}
                      />
                      {draft.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </motion.button>

                    <SubscriptionToggle
                      enabled={draft.isSubscribable ?? false}
                      onChange={v => updateDraft({ isSubscribable: v })}
                      compact
                    />
                  </div>

                  {/* オプション紐付け */}
                  <div>
                    <FormLabel>
                      <span className="flex items-center gap-1"><Link2 size={8} />OPTIONS</span>
                    </FormLabel>
                    <button
                      onClick={openOptionSelector}
                      className="w-full flex items-center justify-between rounded-2xl px-4 py-3"
                      style={{ background: 'rgba(255,255,255,0.80)', border: '1px solid #F3E3E6' }}
                    >
                      <div className="flex flex-wrap gap-1.5">
                        {linkedOpts.length === 0 ? (
                          <span className="text-[12px]" style={{ color: '#C8A8B0' }}>オプションを選択…</span>
                        ) : linkedOpts.map(o => (
                          <span
                            key={o.id}
                            className="text-[10px] px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(234,145,166,0.10)', border: '1px solid rgba(234,145,166,0.22)', color: '#EA91A6' }}
                          >
                            {o.name}
                          </span>
                        ))}
                      </div>
                      <span className="text-[11px] flex-shrink-0 ml-2" style={{ color: '#EA91A6' }}>変更 →</span>
                    </button>
                  </div>

                  {/* LINE タグ */}
                  <div>
                    <FormLabel>
                      <span className="flex items-center gap-1"><Tag size={8} />LINE TAGS</span>
                    </FormLabel>
                    <LightInput
                      value={(draft.lineTags ?? []).join(' ')}
                      onChange={v => updateDraft({ lineTags: v.split(/[\s,]+/).filter(Boolean) })}
                      placeholder="#エイジング #プレミアム"
                    />
                    <p className="text-[10px] mt-1" style={{ color: '#C8A8B0' }}>スペース区切りでタグを入力</p>
                  </div>

                </div>

                {/* Save button */}
                <div className="px-5 pt-3 flex-shrink-0 border-t" style={{ borderColor: '#F3E3E6' }}>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleSave}
                    disabled={!draft.name?.trim()}
                    className="w-full py-4 rounded-full text-[15px] font-medium text-white transition-opacity"
                    style={{
                      background: draft.name?.trim()
                        ? 'linear-gradient(135deg, #EA91A6, #F2B6C6)'
                        : '#F3E3E6',
                      color: draft.name?.trim() ? '#fff' : '#C8A8B0',
                      opacity: draft.name?.trim() ? 1 : 0.7,
                    }}
                  >
                    {isAdd ? 'メニューを追加' : '変更を保存'}
                  </motion.button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      <OptionSelector />
    </>
  )
}
