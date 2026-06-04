'use client'
/**
 * ErrorBoundary.tsx  — PHASE 7
 * 主要コンポーネントを保護。
 * BottomSheet / VoiceMemo / AI系 が落ちても接客フローを止めない。
 * UIデザイン変更禁止。既存 BottomSheet スタイルを踏襲。
 */
import { Component, type ReactNode, type ErrorInfo } from 'react'
import { prodLog } from '@/lib/stability'

// ─── Props / State ────────────────────────────────────────────────────────────

interface Props {
  children:    ReactNode
  /** フォールバック UI（省略時はデフォルト） */
  fallback?:   ReactNode
  /** エラー時のラベル（ログ用） */
  label?:      string
  /** エラー時にUIを完全非表示にする（セクション単位に使う） */
  silentFail?: boolean
}

interface State {
  hasError: boolean
  error:    Error | null
}

// ─── Error Boundary ────────────────────────────────────────────────────────────

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    prodLog('error', `[ErrorBoundary] ${this.props.label ?? 'component'} crashed`, {
      message:  error.message,
      stack:    error.stack?.slice(0, 500),
      component: info.componentStack?.slice(0, 300),
    })
  }

  reset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    // silent fail: セクションが消えるだけ（接客フローを止めない）
    if (this.props.silentFail) return null

    // カスタム fallback があれば使う
    if (this.props.fallback) return this.props.fallback

    // デフォルト fallback — 既存UIスタイル（#F8F1F3 背景・小テキスト）
    return (
      <div style={{
        background: '#F8F1F3', borderRadius: '22px',
        padding: '14px 16px', border: '1px solid #F5E6E8',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <p style={{ fontSize: '12px', color: '#C8A8B0', lineHeight: 1.5 }}>
          この機能を一時的に読み込めませんでした
        </p>
        <button
          onClick={this.reset}
          style={{ fontSize: '11px', color: '#C8A58C', background: '#fff', border: '1px solid #F5E6E8', borderRadius: '999px', padding: '4px 12px', cursor: 'pointer', flexShrink: 0, marginLeft: '12px' }}
        >
          再試行
        </button>
      </div>
    )
  }
}

// ─── 便利ラッパー（関数コンポーネント向け） ────────────────────────────────────

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: Omit<Props, 'children'> = {}
) {
  const displayName = WrappedComponent.displayName ?? WrappedComponent.name ?? 'Component'

  function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary {...options} label={options.label ?? displayName}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    )
  }

  WithErrorBoundaryWrapper.displayName = `WithErrorBoundary(${displayName})`
  return WithErrorBoundaryWrapper
}
