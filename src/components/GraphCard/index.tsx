import type { BarDatum } from '../../types';
import styles from './GraphCard.module.css';

interface Props {
  title: string;
  data: BarDatum[];
  axisLabels?: string[];
}

const DEFAULT_AXES = ['200', '150', '100', '50', '0'];

export default function GraphCard({
  title,
  data,
  axisLabels = DEFAULT_AXES,
}: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>{title}</div>
      <div className={styles.chartWrapper}>
        <div className={styles.axes}>
          {axisLabels.map((v) => (
            <div key={v} className={styles.axisVal}>{v}</div>
          ))}
        </div>
        <div className={styles.barChart}>
          {data.map((bar) => (
            <div key={bar.label} className={styles.barCol}>
              <div
                className={styles.barFill}
                style={{
                  height: `${bar.heightPct}%`,
                  background: bar.highlight
                    ? 'linear-gradient(180deg, var(--graph-gold) 0%, var(--gold2) 100%)'
                    : 'var(--graph-pink)',
                }}
              />
              <div className={styles.barLbl}>{bar.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
