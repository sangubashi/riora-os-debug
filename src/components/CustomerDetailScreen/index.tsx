'use client'
import { useState, useCallback } from 'react';
import type { CustomerProfile, CustomerType, TreatmentRecord } from '../../types';
import { KILLER_PHRASES } from '../../data/constants';
import RioraCelebration from '../RioraCelebration';
import styles from './CustomerDetailScreen.module.css';

interface Props {
  customer: CustomerProfile;
  staffId: string;
  onBack: () => void;
  onSave: (record: TreatmentRecord) => void;
}

/** タイプ → バッジ CSS クラス */
const TYPE_CLASS: Record<CustomerType, string> = {
  '慎重・不安型': styles['type-cautious'],
  '感情重視型':   styles['type-emotional'],
  '効果重視型':   styles['type-results'],
  '信頼構築型':   styles['type-trust'],
  'VIP型':       styles['type-vip'],
};

/** YES/NO × アクション別 応援メッセージ */
const CELEB: Record<string, Record<string, { main: string; sub: string }>> = {
  proposed: {
    yes: { main: 'ナイス提案！',  sub: '勇気ある一歩でした🌸' },
    no:  { main: 'それも大事！',  sub: 'タイミングを見極めて✨' },
  },
  sold: {
    yes: { main: 'さすがです！',  sub: 'お客様も喜んでいます🌸' },
    no:  { main: 'ありがとう！',  sub: '次回に繋げましょう✨' },
  },
  nextBooked: {
    yes: { main: '完璧な締め！',  sub: '次回も楽しみですね🌸' },
    no:  { main: 'OK！',         sub: '来店習慣化が鍵ですよ✨' },
  },
};

export default function CustomerDetailScreen({ customer, staffId, onBack, onSave }: Props) {
  const { name, customerType, visits, lastVisitDaysAgo, tags,
          aiPoints, ngAction, rioraMessage, rejectionPatterns } = customer;
  const phrases = KILLER_PHRASES[customerType];

  // クイック入力の状態
  const [proposed,   setProposed]   = useState<boolean | null>(null);
  const [sold,       setSold]       = useState<boolean | null>(null);
  const [nextBooked, setNextBooked] = useState<boolean | null>(null);

  // リオラ応援ポップアップ
  const [celeb, setCeleb] = useState<{ main: string; sub: string } | null>(null);

  const celebrate = useCallback((action: string, value: boolean) => {
    setCeleb(CELEB[action][value ? 'yes' : 'no']);
  }, []);

  const handleSave = () => {
    onSave({
      customerId:  customer.id,
      staffId,
      date:        new Date().toISOString(),
      proposed:    proposed    ?? false,
      sold:        sold        ?? false,
      nextBooked:  nextBooked  ?? false,
    });
  };

  return (
    <>
      <div className={styles.screen}>

        {/* ── ヘッダー ── */}
        <div className={styles.backHeader}>
          <button className={styles.backBtn} onClick={onBack} aria-label="戻る">←</button>
          <div className={styles.headerTitle}>接客カルテ</div>
        </div>

        <div className={styles.scrollContent}>

          {/* ── ① 顧客ヒーロー ── */}
          <div className={styles.hero}>
            <div className={styles.heroTop}>
              <div className={styles.heroName}>{name} 様</div>
              <div className={styles.heroRight}>
                <span className={styles.visitBadge}>{visits}回目</span>
                <span className={`${styles.typeBadge} ${TYPE_CLASS[customerType]}`}>
                  {customerType}
                </span>
              </div>
            </div>
            <div className={styles.heroMeta}>
              最終来店 {lastVisitDaysAgo}日前
            </div>
            <div className={styles.tagRow}>
              {tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
            </div>
          </div>

          {/* ── ② 殺し文句 ── */}
          <div className={styles.killerSection}>
            <div className={styles.killerHeader}>
              <span className={styles.killerLabel}>今日の殺し文句</span>
              <span className={styles.killerTypeBadge}>{customerType}</span>
            </div>

            {/* メインフレーズ（大きく） */}
            <div className={styles.killerMain}>
              <div className={styles.killerScene}>{phrases[0].scene}</div>
              <div className={styles.killerLine}>{phrases[0].line}</div>
            </div>

            {/* サブフレーズ（2・3番目） */}
            <div className={styles.killerSubs}>
              {phrases.slice(1).map((p, i) => (
                <div key={i} className={styles.killerSub}>
                  <div className={styles.killerSubScene}>{p.scene}</div>
                  <div className={styles.killerSubLine}>{p.line}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── ③ 断るパターン予測 ── */}
          <div className={styles.rejectionSection}>
            <div className={styles.rejectionHeader}>
              <span className={styles.rejectionIcon}>⚠️</span>
              <span className={styles.rejectionTitle}>過去のパターン予測</span>
            </div>
            <div className={styles.patternList}>
              {rejectionPatterns.map((p, i) => (
                <div key={i} className={styles.patternCard}>
                  <div className={styles.patternTrigger}>{p.trigger}</div>
                  <div className={styles.patternMeaning}>💡 {p.meaning}</div>
                  <div className={styles.patternCounter}>{p.counter}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── ④ AI 接客ポイント ── */}
          <div className={styles.aiSection}>
            <div className={styles.aiHeader}>
              <span>✨</span>
              <span className={styles.aiTitle}>AI 接客ポイント</span>
            </div>
            <div className={styles.rioraBubble}>{rioraMessage}</div>
            {aiPoints.map((p, i) => (
              <div key={i} className={styles.aiPoint}>
                <div className={styles.aiDot} />
                {p.text}
              </div>
            ))}
          </div>

          {/* NG */}
          <div className={styles.ngSection}>
            <div className={styles.ngTitle}>本日のNG行動</div>
            <div className={styles.ngText}>{ngAction}</div>
          </div>

        </div>{/* /scrollContent */}

        {/* ── ⑤ 固定クイック入力 ── */}
        <div className={styles.quickInput}>
          <div className={styles.quickRow}>
            <QuickGroup
              label="提案した"
              value={proposed}
              onChange={(v) => { setProposed(v); celebrate('proposed', v); }}
            />
            <QuickGroup
              label="売れた"
              value={sold}
              onChange={(v) => { setSold(v); celebrate('sold', v); }}
            />
            <QuickGroup
              label="次回予約"
              value={nextBooked}
              onChange={(v) => { setNextBooked(v); celebrate('nextBooked', v); }}
            />
          </div>
          <button className={styles.quickSaveBtn} onClick={handleSave}>
            保存して完了
          </button>
        </div>

      </div>

      {/* リオラ応援ポップアップ */}
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

/* ── YES / NO トグルグループ ── */
interface QuickGroupProps {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}

function QuickGroup({ label, value, onChange }: QuickGroupProps) {
  return (
    <div className={styles.quickGroup}>
      <span className={styles.quickLabel}>{label}</span>
      <div className={styles.quickToggles}>
        <button
          className={`${styles.quickToggle} ${value === true ? styles.selectedYes : ''}`}
          onClick={() => onChange(true)}
        >
          YES
        </button>
        <button
          className={`${styles.quickToggle} ${value === false ? styles.selectedNo : ''}`}
          onClick={() => onChange(false)}
        >
          NO
        </button>
      </div>
    </div>
  );
}
