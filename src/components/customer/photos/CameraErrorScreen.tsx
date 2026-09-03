'use client'
/**
 * CameraErrorScreen.tsx — カメラ起動失敗時の画面(権限拒否・非対応・その他失敗)
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1-9節・1-10節。
 * 基本導線「カメラを使用できません」→「カメラ権限を確認」→「もう一度試す」を必須とし、
 * 「非対応」時のみ再試行が無意味なため両ボタンを出さない。
 * ファイル選択フォールバック(1-10節、Phase1必須)は状況によらず常に提示する
 * (権限拒否・その他失敗でも、ネイティブカメラアプリ経由なら記録を継続できる可能性があるため)。
 */
import { useRef } from 'react'
import type { CameraErrorKind } from '@/lib/photos/cameraError'

interface Props {
  kind:            CameraErrorKind
  onRetry:         () => void
  onSelectFile:    (file: File) => void
}

const MESSAGE: Record<CameraErrorKind, string> = {
  permission_denied: 'カメラの利用が許可されていません。設定からカメラへのアクセスを許可してください。',
  unsupported:        'この端末・ブラウザではカメラ機能を利用できません。',
  other:              'カメラを起動できませんでした。他のアプリがカメラを使用していないか確認してください。',
}

function pill(bg: string, color: string, borderColor?: string) {
  return {
    padding:      '11px',
    borderRadius: '999px',
    background:   bg,
    color,
    border:       borderColor ? `1.5px solid ${borderColor}` : 'none',
    fontSize:     '13px',
    fontWeight:   600,
    cursor:       'pointer',
    width:        '100%',
  } as const
}

export default function CameraErrorScreen({ kind, onRetry, onSelectFile }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 1-9節: 「非対応」だけ再試行ボタン群(権限確認・もう一度試す)を出さない
  const showRetryActions = kind !== 'unsupported'

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '16px', padding: '32px 20px',
        background: '#0B0F14', color: '#fff', minHeight: '360px', borderRadius: '18px',
      }}
    >
      <div style={{ fontSize: '40px' }}>📷✕</div>
      <p style={{ fontSize: '15px', fontWeight: 700 }}>カメラを使用できません</p>
      <p style={{ fontSize: '13px', color: '#B8C4D0', textAlign: 'center', lineHeight: 1.6 }}>
        {MESSAGE[kind]}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '280px' }}>
        {showRetryActions && (
          <>
            {/* 実際の設定画面遷移はOS/ブラウザ依存のため直接開けるとは限らない。
                Phase1では案内テキストの再掲に留める(9節の未決事項) */}
            <button type="button" onClick={onRetry} style={pill('#fff', '#0B0F14')}>
              カメラ権限を確認
            </button>
            <button type="button" onClick={onRetry} style={pill('transparent', '#fff', '#3A4552')}>
              もう一度試す
            </button>
          </>
        )}

        {/* 1-10節: ファイル選択フォールバック(Phase1必須) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={pill('transparent', '#8FB4E0', '#3A4552')}
        >
          写真を選択して記録する
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onSelectFile(file)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
