import styles from './RioraArea.module.css';

interface Props {
  message: string;
}

export default function RioraArea({ message }: Props) {
  return (
    <div className={styles.area}>
      <img
        className={styles.img}
        src="/images/riora.jpg"
        alt="Riora"
      />
      <div className={styles.bubble}>
        <div className={styles.name}>Riora</div>
        <div className={styles.msg}>{message}</div>
      </div>
    </div>
  );
}
