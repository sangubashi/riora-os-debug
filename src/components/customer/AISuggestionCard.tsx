import type { CustomerProfile, AiSuggestion } from '../../types';
import RioraCharacter from '../common/RioraCharacter';
import styles from './AISuggestionCard.module.css';

interface Props {
  customer: CustomerProfile;
  suggestion?: AiSuggestion | null;
}

export default function AISuggestionCard({ customer, suggestion }: Props) {
  const logic    = suggestion?.strategy_logic;
  const oneliner = logic?.nextVisitMessage ?? customer.aiOneLiner;

  // RioraCharacter に渡すメッセージ：DB提案があれば優先
  const characterMsg = logic?.adviceMessage ?? customer.rioraMessage;

  return (
    <div className={styles.card}>
      {/* RioraCharacter がモード自動判定 + 吹き出し表示 */}
      <div className={styles.characterWrap}>
        <RioraCharacter
          mode={logic?.vipCandidate ? 'happy' : 'normal'}
          size={92}
        />
      </div>

      {/* AI ワンライナー */}
      <div className={styles.oneliner}>
        <span className={styles.aiIcon}>✨</span>
        <span>{oneliner}</span>
      </div>

      {/* 接客ポイント（先頭 2 件）*/}
      {customer.aiPoints.slice(0, 2).map((p, i) => (
        <div key={i} className={styles.point}>
          <div className={styles.pointDot} />
          <span>{p.text}</span>
        </div>
      ))}

      {/* 推奨メニュー（DB 提案がある場合のみ）*/}
      {suggestion?.suggested_menu && (
        <div className={styles.menuChip}>
          <span className={styles.menuIcon}>💆</span>
          おすすめ：{suggestion.suggested_menu}
        </div>
      )}
    </div>
  );
}
