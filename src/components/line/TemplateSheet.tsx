'use client'
import { motion, AnimatePresence } from 'framer-motion'
import { X, FileText } from 'lucide-react'
import { useLineCrmStore } from '@/store/useLineStore'

interface Props {
  onInsert: (body: string) => void
}

export default function TemplateSheet({ onInsert }: Props) {
  const { isTemplateOpen, templates, closeTemplate } = useLineCrmStore()

  return (
    <AnimatePresence>
      {isTemplateOpen && (
        <>
          <motion.div
            key="tmpl-bg"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={closeTemplate}
            className="fixed inset-0 z-[60]"
            style={{ background: 'rgba(92,64,51,0.15)', backdropFilter: 'blur(4px)' }}
          />

          <div className="fixed inset-x-0 bottom-0 z-[70] flex justify-center">
            <motion.div
              key="tmpl-sheet"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              drag="y" dragConstraints={{ top: 0 }} dragElastic={{ top: 0, bottom: 0.3 }}
              onDragEnd={(_, info) => { if (info.offset.y > 80) closeTemplate() }}
              className="w-full max-w-[430px] bg-white rounded-t-[28px] shadow-sheet"
              style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-[#E8D5D8]" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-[#F3E3E6]">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-[#D98292]" />
                  <span className="text-[14px] font-semibold text-[#5C4033]">テンプレート</span>
                </div>
                <button
                  onClick={closeTemplate}
                  className="w-7 h-7 rounded-full bg-[#F8F1F3] flex items-center justify-center"
                >
                  <X size={13} className="text-[#C8A58C]" />
                </button>
              </div>

              {/* List */}
              <div className="overflow-y-auto max-h-[60vh]">
                {templates.map((tmpl, i) => (
                  <motion.button
                    key={tmpl.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { onInsert(tmpl.body); closeTemplate() }}
                    className="w-full text-left px-5 py-4 border-b border-[#F3E3E6] last:border-0 active:bg-[#FFF8F7]"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-medium text-[#5C4033]">{tmpl.title}</span>
                      <div className="flex gap-1">
                        {tmpl.tags.map(tag => (
                          <span key={tag} className="text-[9px] bg-[#F5D6DB] text-[#D98292] px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="text-[11px] text-[#9F7E6C] leading-relaxed line-clamp-2">{tmpl.body}</p>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
