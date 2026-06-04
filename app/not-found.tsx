import Link from 'next/link'
import styles from './shared/PageShell.module.css'

export default function NotFoundPage() {
  return (
    <div className={styles.screen}>
      <div className={styles.pageTitle}>ページが見つかりません</div>
      <div className={styles.pageSubtitle}>
        ご指定のページは存在しないか、移動された可能性があります。
      </div>
      <div className={styles.emptyState}>
        URLを確認するか、ホームに戻ってください。
      </div>
      <div className={styles.actionArea}>
        <Link href="/phase1" className={styles.actionButton}>
          ホームに戻る
        </Link>
      </div>
    </div>
  )
}
