'use client'
import { useEffect, useState } from 'react';
import styles from './RioraCelebration.module.css';

interface Props {
  main: string;
  sub: string;
  onDone: () => void;
}

/** ふわっと出て自動で消えるリオラ応援ポップアップ */
export default function RioraCelebration({ main, sub, onDone }: Props) {
  const [phase, setPhase] = useState<'enter' | 'exit'>('enter');

  useEffect(() => {
    // 1.6 秒後にフェードアウト開始
    const fadeTimer = window.setTimeout(() => setPhase('exit'), 1600);
    // 1.9 秒後に完全に消去
    const doneTimer = window.setTimeout(() => onDone(), 1900);
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  return (
    <div className={styles.overlay}>
      <div className={`${styles.popup} ${phase === 'exit' ? styles.exit : styles.enter}`}>
        <img
          className={styles.rioraImg}
          src="/images/riora.jpg"
          alt="Riora"
        />
        <div className={styles.main}>{main}</div>
        <div className={styles.sub}>{sub}</div>
      </div>
    </div>
  );
}
