import styles from './Header.module.css';

interface Props {
  greeting: string;        // "おはようございます"
  staffFirstName: string;  // "亀山"
  onNotificationClick?: () => void;
  onMenuClick?: () => void;
}

export default function Header({
  greeting,
  staffFirstName,
  onNotificationClick,
  onMenuClick,
}: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.topRow}>
        <img className={styles.logo} src="/images/logo.jpg" alt="Salon Riora" />
        <div className={styles.icons}>
          <button
            className={styles.icon}
            onClick={onNotificationClick ?? (() => {})}
            aria-label="通知"
          >
            🔔
          </button>
          <button
            className={styles.icon}
            onClick={onMenuClick}
            aria-label="メニュー"
          >
            ☰
          </button>
        </div>
      </div>
      <div className={styles.greeting}>
        {greeting}、<span className={styles.greetingName}>{staffFirstName}さん</span>
      </div>
    </header>
  );
}
