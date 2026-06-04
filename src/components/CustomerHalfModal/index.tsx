'use client'
import { useRef, useEffect, useCallback } from 'react';
import type { CustomerProfile, CustomerType } from '../../types';
import { KILLER_PHRASES } from '../../data/constants';
import styles from './CustomerHalfModal.module.css';

interface Props {
  customer: CustomerProfile;
  onClose: () => void;
  onStartService: () => void;
}

const TYPE_CLASS: Record<CustomerType, string> = {
  '慎重・不安型': styles['type-cautious'],
  '感情重視型':   styles['type-emotional'],
  '効果重視型':   styles['type-results'],
  '信頼構築型':   styles['type-trust'],
  'VIP型':       styles['type-vip'],
};

export default function CustomerHalfModal({ customer, onClose, onStartService }: Props) {
  const sheetRef  = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);
  const dragging  = useRef(false);

  const phrases = KILLER_PHRASES[customer.customerType];

  // 背景スクロールをロック（bodyのみ・sheetは別途 pan-y）
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── ドラッグエリアのスワイプ to Dismiss ──────────────────────────
  // touch-action: none は .dragArea CSS で定義済みのため JS のみ扱う
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragStart.current = e.touches[0].clientY;
    dragging.current  = true;
    const el = sheetRef.current;
    if (el) el.style.transition = 'none';
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current) return;
    const delta = Math.max(0, e.touches[0].clientY - dragStart.current);
    const el = sheetRef.current;
    if (el) el.style.transform = `translateY(${delta}px)`;
  }, []);

  const onTouchEnd = useCallback(() => {
    dragging.current = false;
    const el = sheetRef.current;
    if (!el) return;
    const currentY = new DOMMatrix(getComputedStyle(el).transform).m42;

    if (currentY > 110) {
      el.style.transition = 'transform 0.26s ease';
      el.style.transform  = 'translateY(110%)';
      setTimeout(onClose, 260);
    } else {
      el.style.transition = 'transform 0.35s cubic-bezier(0.32,0.72,0,1)';
      el.style.transform  = 'translateY(0)';
    }
  }, [onClose]);

  return (
    <>
      {/* ① オーバーレイ：モーダル以外タップで閉じる */}
      <div className={styles.overlay} onClick={onClose} />

      {/* ② シート：z-index 201 でオーバーレイより前面 */}
      <div
        ref={sheetRef}
        className={styles.sheet}
        onClick={(e) => e.stopPropagation()}
      >

        {/* ドラッグエリア（touch-action: none はここだけ）*/}
        <div
          className={styles.dragArea}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className={styles.handle} />

          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <div className={styles.customerName}>{customer.name} 様</div>
              <div className={styles.headerMeta}>
                <span className={styles.visitBadge}>{customer.visits}回目</span>
                <span className={`${styles.typeBadge} ${TYPE_CLASS[customer.customerType]}`}>
                  {customer.customerType}
                </span>
              </div>
            </div>
            <button className={styles.closeBtn} onClick={onClose} aria-label="閉じる">✕</button>
          </div>
        </div>

        {/* スクロール本文（touch-action: pan-y）*/}
        <div className={styles.body}>

          {/* 殺し文句 */}
          <div className={styles.killerSection}>
            <div className={styles.killerLabel}>今日の殺し文句</div>
            <div className={styles.killerMain}>
              <div className={styles.killerScene}>{phrases[0].scene}</div>
              <div className={styles.killerLine}>{phrases[0].line}</div>
            </div>
            <div className={styles.killerSubs}>
              {phrases.slice(1).map((p, i) => (
                <div key={i}>
                  <div className={styles.killerSubScene}>{p.scene}</div>
                  <div className={styles.killerSubLine}>{p.line}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 過去の懸念点 */}
          <div className={styles.concernSection}>
            <div className={styles.concernHeader}>
              <span className={styles.concernIcon}>🤖</span>
              <span className={styles.concernTitle}>前回のメモから AI が要約</span>
              <span className={styles.concernAiBadge}>AI Summary</span>
            </div>
            <div className={styles.concernList}>
              {customer.previousConcerns.map((c, i) => (
                <div key={i} className={styles.concernItem}>
                  <div className={styles.concernDot} />
                  {c}
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* 施術開始ボタン */}
        <div className={styles.footer}>
          <button className={styles.startBtn} onClick={onStartService}>
            施術を開始する
            <span className={styles.startArrow}>→</span>
          </button>
        </div>

      </div>
    </>
  );
}
