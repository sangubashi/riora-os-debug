'use client'
/**
 * TemplateManagerTab.tsx — テンプレート管理(Pass G)
 */
import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { useLineAdminStore, type LineTemplateItem } from '@/store/useLineAdminStore'
import { LoadingRow, EmptyRow } from './LineScreen'

interface FormState { title: string; body: string }

export default function TemplateManagerTab() {
  const { templates, isLoadingTemplates, templatesError, fetchTemplates, createTemplate, updateTemplate, deleteTemplate } = useLineAdminStore()
  const [editing, setEditing] = useState<LineTemplateItem | 'new' | null>(null)
  const [form, setForm] = useState<FormState>({ title: '', body: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const openEdit = (t: LineTemplateItem | 'new') => {
    setEditing(t)
    setForm(t === 'new' ? { title: '', body: '' } : { title: t.title, body: t.body })
  }

  const close = () => setEditing(null)

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) return
    setSaving(true)
    const ok = editing === 'new'
      ? await createTemplate({ categoryId: null, title: form.title, body: form.body, tags: [] })
      : await updateTemplate((editing as LineTemplateItem).id, { title: form.title, body: form.body })
    setSaving(false)
    if (ok) close()
  }

  const remove = async (id: string) => {
    await deleteTemplate(id)
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', minHeight: '300px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px' }}>
        <button
          onClick={() => openEdit('new')}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700, color: '#fff', background: '#D98292', border: 'none', borderRadius: '10px', padding: '6px 12px', cursor: 'pointer' }}
        >
          <Plus size={13} /> 新規テンプレート
        </button>
      </div>

      {isLoadingTemplates && <LoadingRow />}
      {templatesError && <p style={{ padding: '16px', fontSize: '12px', color: '#D14F4F' }}>取得エラー: {templatesError}</p>}
      {!isLoadingTemplates && !templatesError && templates.length === 0 && <EmptyRow message="LINE履歴なし" />}

      {!isLoadingTemplates && templates.map((t) => (
        <div key={t.id} style={{ padding: '12px 16px', borderTop: '1px solid #FAF3F4' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033' }}>{t.title}</p>
              {t.categoryName && <p style={{ fontSize: '10px', color: '#C8A8B0' }}>{t.categoryName}</p>}
              <p style={{ fontSize: '12px', color: '#5C4033', marginTop: '4px', whiteSpace: 'pre-line' }}>{t.body}</p>
              <p style={{ fontSize: '10px', color: '#C8A8B0', marginTop: '4px' }}>使用回数: {t.useCount}回</p>
            </div>
            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
              <button onClick={() => openEdit(t)} style={{ background: '#FAF3F4', border: 'none', borderRadius: '8px', padding: '6px', cursor: 'pointer', color: '#9F7E6C' }}>
                <Pencil size={13} />
              </button>
              <button onClick={() => remove(t.id)} style={{ background: '#FAF3F4', border: 'none', borderRadius: '8px', padding: '6px', cursor: 'pointer', color: '#D14F4F' }}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(92,64,51,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={close}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px', padding: '20px', width: '90%', maxWidth: '420px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{editing === 'new' ? '新規テンプレート' : 'テンプレート編集'}</p>
              <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9F7E6C' }}><X size={18} /></button>
            </div>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="タイトル"
              style={{ width: '100%', fontSize: '13px', padding: '8px 10px', borderRadius: '8px', border: '1px solid #F0DEE2', marginBottom: '8px' }}
            />
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="本文"
              rows={5}
              style={{ width: '100%', fontSize: '13px', padding: '8px 10px', borderRadius: '8px', border: '1px solid #F0DEE2', resize: 'vertical' }}
            />
            <button
              onClick={save}
              disabled={saving}
              style={{ marginTop: '12px', width: '100%', fontSize: '13px', fontWeight: 700, color: '#fff', background: '#D98292', border: 'none', borderRadius: '10px', padding: '9px 0', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
