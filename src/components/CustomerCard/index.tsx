import type { CustomerProfile } from '../../types';
import styles from './CustomerCard.module.css';

interface Props {
  customer: CustomerProfile;
}

export default function CustomerCard({ customer }: Props) {
  const { name, visits, lastVisitDaysAgo, tags, aiPoints, ngAction } = customer;

  return (
    <div className={styles.card}>
      <div className={styles.name}>{name} 様</div>
      <div className={styles.visits}>
        来店 {visits}回目　｜　最終来店 {lastVisitDaysAgo}日前
      </div>

      <div className={styles.tagRow}>
        {tags.map((tag) => (
          <span key={tag} className={styles.tag}>{tag}</span>
        ))}
      </div>

      <div className={styles.aiSection}>
        <div className={styles.aiHeader}>
          <span className={styles.aiIcon}>✨</span>
          <span className={styles.aiTitle}>AI 接客ポイント</span>
        </div>
        {aiPoints.map((point, i) => (
          <div key={i} className={styles.aiPoint}>
            <div className={styles.aiDot} />
            {point.text}
          </div>
        ))}
      </div>

      <div className={styles.ngSection}>
        <div className={styles.ngTitle}>本日のNG行動</div>
        <div className={styles.ngText}>{ngAction}</div>
      </div>
    </div>
  );
}
