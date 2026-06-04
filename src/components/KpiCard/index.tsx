import type { KpiMetric } from '../../types';
import styles from './KpiCard.module.css';

interface Props {
  metric: KpiMetric;
}

export default function KpiCard({ metric }: Props) {
  const { label, value, diff, trend, wide } = metric;

  return (
    <div className={styles.card}>
      <span className={styles.paw}>🐾</span>
      <div className={styles.label}>{label}</div>
      <div className={`${styles.value} ${wide ? styles.valueWide : ''}`}>{value}</div>
      <div className={`${styles.diff} ${trend === 'down' ? styles.diffDown : styles.diffUp}`}>
        {diff}
      </div>
    </div>
  );
}
