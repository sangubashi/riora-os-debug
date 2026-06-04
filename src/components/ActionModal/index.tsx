'use client'
import { useState, useCallback } from 'react';
import type { TreatmentRecord } from '../../types';
import RioraCelebration from '../RioraCelebration';
import styles from './ActionModal.module.css';

interface Props {
  customerName: string;
  customerId: string;
  staffId: string;
  onClose: () => void;
  onSave: (record: TreatmentRecord) => void;
}

type ToggleValue = boolean | null;

interface CelebMsg { main: string; sub: string; }

/** YES/NO × アクション別のリオラ応援メッセージ */
const CELEB: Record<string, Record<string, CelebMsg>> = {
  proposed: {
    yes: { main: 'ナイス提案！',   sub: '勇気ある一歩でした🌸' },
    no:  { main: 'それも大事！',   sub: 'タイミングを見極めて✨' },
  },
  sold: {
    yes: { main: 'さすがです！',   sub: 'お客様も喜んでいます🌸' },
    no:  { main: 'ありがとう！',   sub: '次回に繋げましょう✨' },
  },
  nextBooked: {
    yes: { main: '完璧な締め！',   sub: '次回も楽しみですね🌸' },
    no:  { main: 'OK！',          sub: '来店習慣化が鍵ですよ✨' },
  },
};

export default function ActionModal({
  customerName,
  customerId,
  staffId,
  onClose,
  onSave,
}: Props) {
  const [proposed,    setProposed]    = useState<ToggleValue>(null);
  const [sold,        setSold]        = useState<ToggleValue>(null);
  const [nextBooked,  setNextBooked]  = useState<ToggleValue>(null);

  // 応援ポップアップ
  const [celeb, setCeleb] = useState<CelebMsg | null>(null);

  const showCeleb = useCallback((action: string, value: boolean) => {
    setCeleb(CELEB[action][value ? 'yes' : 'no']);
  }, []);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSave = () => {
    onSave({
      customerId,
      staffId,
      date: new Date().toISOString(),
      proposed:    proposed    ?? false,
      sold:        sold        ?? false,
      nextBooked:  nextBooked  ?? false,
    });
  };

  return (
    <>
      <div className={styles.overlay} onClick={handleOverlayClick}>
        <div className={styles.sheet}>
          <div className={styles.handle} />
          <div className={styles.title}>施術記録</div>
          <div className={styles.sub}>{customerName} 様　｜　今日の結果を入力</div>

          <Question
            label="提案しましたか？"
            value={proposed}
            onChange={(v) => { setProposed(v); showCeleb('proposed', v); }}
          />
          <Question
            label="商品は売れましたか？"
            value={sold}
            onChange={(v) => { setSold(v); showCeleb('sold', v); }}
          />
          <Question
            label="次回予約は取れましたか？"
            value={nextBooked}
            onChange={(v) => { setNextBooked(v); showCeleb('nextBooked', v); }}
          />

          <button className={styles.saveBtn} onClick={handleSave}>
            保存する
          </button>
        </div>
      </div>

      {/* リオラ応援ポップアップ（ActionModal の上、z-index 250） */}
      {celeb && (
        <RioraCelebration
          key={`${celeb.main}-${Date.now()}`}
          main={celeb.main}
          sub={celeb.sub}
          onDone={() => setCeleb(null)}
        />
      )}
    </>
  );
}

/* ── 質問 + YES/NO トグル ── */
interface QuestionProps {
  label: string;
  value: ToggleValue;
  onChange: (v: boolean) => void;
}

function Question({ label, value, onChange }: QuestionProps) {
  return (
    <>
      <div className={styles.question}>{label}</div>
      <div className={styles.toggleRow}>
        <button
          className={`${styles.toggleBtn} ${value === true ? styles.selected : ''}`}
          onClick={() => onChange(true)}
        >
          YES
        </button>
        <button
          className={`${styles.toggleBtn} ${value === false ? styles.selected : ''}`}
          onClick={() => onChange(false)}
        >
          NO
        </button>
      </div>
    </>
  );
}
