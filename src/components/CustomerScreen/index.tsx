import type { CustomerProfile } from '../../types';
import RioraArea from '../RioraArea';
import CustomerCard from '../CustomerCard';
import BottomNav from '../BottomNav';
import styles from './CustomerScreen.module.css';

interface Props {
  customer: CustomerProfile;
  staffId: string;
  onBack: () => void;
  onRecordTreatment: () => void;
}

export default function CustomerScreen({
  customer,
  onBack,
  onRecordTreatment,
}: Props) {
  return (
    <div className={styles.screen}>
      <div className={styles.backHeader}>
        <button className={styles.backBtn} onClick={onBack} aria-label="戻る">
          ←
        </button>
        <div className={styles.backTitle}>今日の接客ポイント</div>
      </div>

      <RioraArea message={customer.rioraMessage} />
      <CustomerCard customer={customer} />

      <BottomNav
        actions={[
          { label: '← 戻る', variant: 'outline', onClick: onBack },
          { label: '施術完了を記録', variant: 'primary', onClick: onRecordTreatment },
        ]}
      />
    </div>
  );
}
