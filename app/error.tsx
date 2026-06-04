'use client'

import Link from 'next/link'
import styles from './shared/PageShell.module.css'

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className={styles.screen}>
      <div className={styles.pageTitle}>予期せぬエラーが発生しました</div>
      <div className={styles.pageSubtitle}>
        問題の原因を調査しています。しばらくしてから再読み込みしてください。
      </div>
      <div className={styles.card}>
        <div className={styles.cardHeading}>エラー詳細</div>
        <div className={styles.cardText}>{error.message}</div>
      </div>
      <div className={styles.actionArea}>
        <button className={styles.actionButton} onClick={() => reset()}>
          再試行
        </button>
        <Link href="/phase1" className={styles.actionButton}>
          ホームへ戻る
        </Link>
      </div>
    </div>
  )
}
