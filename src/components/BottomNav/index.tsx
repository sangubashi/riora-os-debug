import styles from './BottomNav.module.css';

interface NavAction {
  label: string;
  variant: 'outline' | 'primary';
  onClick: () => void;
}

interface Props {
  actions: NavAction[];
}

export default function BottomNav({ actions }: Props) {
  return (
    <nav className={styles.nav}>
      {actions.map((action) => (
        <button
          key={action.label}
          className={`${styles.btn} ${action.variant === 'primary' ? styles.primary : styles.outline}`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </nav>
  );
}
