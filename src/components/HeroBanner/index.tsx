import styles from './HeroBanner.module.css';

interface Props {
  week: string;
  period: string;
  staffName: string;
  onDashboardClick?: () => void;
}

export default function HeroBanner({ week, period, staffName, onDashboardClick }: Props) {
  return (
    <div className={styles.banner}>
      <div className={styles.company}>{staffName}</div>
      <div className={styles.period}>
        {week}　<span className={styles.periodSub}>（{period}）</span>
      </div>
      <button className={styles.dashboardBtn} onClick={onDashboardClick}>
        週次ダッシュボード　→
      </button>
      <img
        className={styles.bear}
        src="/images/hero-bear.jpg"
        alt=""
        aria-hidden="true"
      />
    </div>
  );
}
