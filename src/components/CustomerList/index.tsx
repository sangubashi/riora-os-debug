import type { CustomerProfile } from '../../types';
import BottomNav from '../BottomNav';
import styles from './CustomerList.module.css';

interface Props {
  staffName: string;
  customers: CustomerProfile[];
  onBack: () => void;
  onSelect: (customer: CustomerProfile) => void;
}

export default function CustomerList({
  staffName,
  customers,
  onBack,
  onSelect,
}: Props) {
  return (
    <div className={styles.screen}>
      <div className={styles.backHeader}>
        <button className={styles.backBtn} onClick={onBack} aria-label="戻る">
          ←
        </button>
        <div className={styles.backTitle}>今日の予約</div>
        <div className={styles.count}>{staffName} ／ {customers.length}件</div>
      </div>

      <div className={styles.list}>
        {customers.length === 0 ? (
          <div className={styles.empty}>
            今日の予約はありません🌸<br />
            ゆっくりお過ごしください
          </div>
        ) : (
          customers.map((customer, i) => (
            <CustomerListCard
              key={customer.id}
              customer={customer}
              index={i}
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      <BottomNav
        actions={[
          { label: '← 戻る', variant: 'outline', onClick: onBack },
        ]}
      />
    </div>
  );
}

interface CardProps {
  customer: CustomerProfile;
  index: number;
  onSelect: (customer: CustomerProfile) => void;
}

function CustomerListCard({ customer, index, onSelect }: CardProps) {
  const { name, visits, lastVisitDaysAgo, tags } = customer;
  const delayStyle = { animationDelay: `${index * 0.08}s` };

  return (
    <div
      className={styles.card}
      style={delayStyle}
      onClick={() => onSelect(customer)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(customer)}
    >
      <div className={styles.cardTop}>
        <div className={styles.customerName}>{name} 様</div>
        <span className={styles.visitBadge}>{visits}回目</span>
      </div>
      <div className={styles.lastVisit}>最終来店 {lastVisitDaysAgo}日前</div>

      <div className={styles.tagRow}>
        {tags.map((tag) => (
          <span key={tag} className={styles.tag}>{tag}</span>
        ))}
      </div>

      <button
        className={styles.actionBtn}
        onClick={(e) => { e.stopPropagation(); onSelect(customer); }}
      >
        接客ポイントを確認　→
      </button>
    </div>
  );
}
