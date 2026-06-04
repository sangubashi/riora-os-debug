import type { CustomerProfile, CustomerType } from '../../types';
import styles from './AppointmentCard.module.css';

interface Props {
  customer: CustomerProfile;
  index: number;
  onSelect: (customer: CustomerProfile) => void;
}

/** タイプ別：バッジの CSS クラス */
const TYPE_CLASS: Record<CustomerType, string> = {
  '慎重・不安型': styles['type-cautious'],
  '感情重視型':   styles['type-emotional'],
  '効果重視型':   styles['type-results'],
  '信頼構築型':   styles['type-trust'],
  'VIP型':       styles['type-vip'],
};

/** タイプ別：左アクセントバーの色 */
const ACCENT_COLOR: Record<CustomerType, string> = {
  '慎重・不安型': '#D98292',  // ピンク
  '感情重視型':   '#C9A055',  // ゴールド
  '効果重視型':   '#6A9A64',  // グリーン
  '信頼構築型':   '#A07060',  // ウォームブラウン
  'VIP型':       '#E7C68B',  // ライトゴールド
};

export default function AppointmentCard({ customer, index, onSelect }: Props) {
  const { name, customerType, visits, aiOneLiner } = customer;

  const cardStyle = {
    animationDelay: `${index * 0.09}s`,
    '--accent-color': ACCENT_COLOR[customerType],
  } as React.CSSProperties;

  return (
    <div
      className={styles.card}
      style={cardStyle}
      onClick={() => onSelect(customer)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(customer)}
    >
      {/* 名前 + 来店回数 */}
      <div className={styles.topRow}>
        <div className={styles.name}>{name} 様</div>
        <span className={styles.visitBadge}>{visits}回目</span>
      </div>

      {/* 顧客タイプバッジ */}
      <span className={`${styles.typeBadge} ${TYPE_CLASS[customerType]}`}>
        {customerType}
      </span>

      <div className={styles.divider} />

      {/* AI 一行提案 */}
      <div className={styles.aiRow}>
        <span className={styles.aiIcon}>✨</span>
        <span className={styles.aiText}>{aiOneLiner}</span>
      </div>

      {/* CTA ボタン */}
      <button
        className={styles.ctaBtn}
        onClick={(e) => { e.stopPropagation(); onSelect(customer); }}
      >
        接客ポイントを確認
        <span className={styles.ctaArrow}>→</span>
      </button>
    </div>
  );
}
