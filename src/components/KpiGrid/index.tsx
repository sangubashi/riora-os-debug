import type { KpiMetric } from '../../types';
import KpiCard from '../KpiCard';
import styles from './KpiGrid.module.css';

interface Props {
  title: string;
  topRow: KpiMetric[];
  bottomRow: KpiMetric[];
}

export default function KpiGrid({ title, topRow, bottomRow }: Props) {
  return (
    <>
      <div className={styles.sectionTitle}>{title}</div>
      <div className={styles.grid3}>
        {topRow.map((m) => (
          <KpiCard key={m.label} metric={m} />
        ))}
      </div>
      <div className={styles.grid2}>
        {bottomRow.map((m) => (
          <KpiCard key={m.label} metric={m} />
        ))}
      </div>
    </>
  );
}
