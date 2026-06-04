'use client'
import { useState, useEffect, useCallback } from 'react';
import type { CustomerProfile, TreatmentRecord } from '../../types';
import QuickServiceLog, { type ServiceLogData } from '../customer/QuickServiceLog';
import RioraCharacter from '../common/RioraCharacter';
import styles from './ServiceModeScreen.module.css';

interface Props {
  customer: CustomerProfile;
  staffId: string;
  onFinish: (record: TreatmentRecord) => void;
  onBack: () => void;
}

export default function ServiceModeScreen({ customer, staffId, onFinish, onBack }: Props) {
  const [seconds,   setSeconds]   = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // タイマー
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  // QuickServiceLog の保存完了 → TreatmentRecord に変換して親へ
  const handleLogSave = useCallback((data: ServiceLogData) => {
    onFinish({
      customerId:  customer.id,
      staffId,
      date:        new Date().toISOString(),
      proposed:    data.aiAdopted,
      sold:        data.optionSold || data.retailSold,
      nextBooked:  data.nextReserved,
    });
  }, [customer.id, staffId, onFinish]);

  return (
    <>
      <div className={styles.screen}>

        {/* ── ヘッダー ── */}
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={onBack} aria-label="戻る">←</button>

          <div className={styles.headerInfo}>
            <div className={styles.headerName}>{customer.name} 様の施術</div>
            <div className={styles.headerType}>{customer.customerType}</div>
          </div>

          <div className={styles.timerChip}>
            <span className={styles.timerTime}>{mm}:{ss}</span>
            <button
              className={styles.timerToggle}
              onClick={() => setIsRunning(r => !r)}
              aria-label={isRunning ? '一時停止' : '開始'}
            >
              {isRunning ? '⏸' : '▶'}
            </button>
          </div>
        </div>

        {/* ── スクロール領域 ── */}
        <div className={styles.scrollArea}>

          {/* AIガイド */}
          <div className={styles.rioraGuide}>
            <RioraCharacter mode="normal" size={118} />
          </div>

          {/* 接客ポイント */}
          <div className={styles.pointsCard}>
            <div className={styles.pointsTitle}>今日の接客ポイント</div>
            {customer.aiPoints.map((p, i) => (
              <div key={i} className={styles.point}>
                <div className={styles.pointDot} />
                {p.text}
              </div>
            ))}
          </div>

        </div>

        {/* ── 施術完了ボタン ── */}
        <div className={styles.footer}>
          <button className={styles.finishBtn} onClick={() => setModalOpen(true)}>
            施術完了を記録する
          </button>
        </div>

      </div>

      {/* ── 施術記録シート ── */}
      {modalOpen && (
        <div className={styles.logOverlay} onClick={() => setModalOpen(false)}>
          <div className={styles.logSheet} onClick={e => e.stopPropagation()}>
            <div className={styles.logHandle} />
            <div className={styles.logTitle}>施術記録</div>
            <div className={styles.logSub}>{customer.name} 様　｜　今日の結果</div>
            <QuickServiceLog
              reservation={
                /^[0-9a-f-]{36}$/i.test(customer.id)
                  ? { id: customer.id, customer_id: null, customer_hash_id: customer.hashId ?? null }
                  : null
              }
              onComplete={handleLogSave}
            />
          </div>
        </div>
      )}
    </>
  );
}
