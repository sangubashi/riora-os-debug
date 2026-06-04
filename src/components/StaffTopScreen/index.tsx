'use client'
import { useState } from 'react';
import type { CustomerProfile, StaffProfile } from '../../types';
import { getTimeGreeting } from '../../data/constants';

import Header from '../Header';
import RioraArea from '../RioraArea';
import AppointmentCard from '../AppointmentCard';
import CustomerHalfModal from '../CustomerHalfModal';
import styles from './StaffTopScreen.module.css';

interface Props {
  staff: StaffProfile;
  customers: CustomerProfile[];
  rioraMsg: string;
  onStartService: (customer: CustomerProfile) => void;
  onLogout: () => void;
  onLineAdmin?: () => void;
}

export default function StaffTopScreen({
  staff,
  customers,
  rioraMsg,
  onStartService,
  onLogout,
  onLineAdmin,
}: Props) {
  const greeting = getTimeGreeting();
  const [modalCustomer, setModalCustomer] = useState<CustomerProfile | null>(null);

  const isModalOpen = modalCustomer !== null;

  const handleCardTap = (c: CustomerProfile) => setModalCustomer(c);
  const handleClose   = () => setModalCustomer(null);
  const handleStart   = () => {
    if (!modalCustomer) return;
    const c = modalCustomer;
    setModalCustomer(null);
    onStartService(c);
  };

  return (
    <div className={styles.screen}>

      <div className={`${styles.bgContent} ${isModalOpen ? styles.bgBlurred : ''}`}>

        <Header
          greeting={greeting}
          staffFirstName={staff.firstName}
          onMenuClick={onLogout}
        />
<div className={styles.rioraWrap}>
          <RioraArea message={rioraMsg} />
        </div>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>今日の予約</h2>
            <span className={styles.sectionCount}>{customers.length}件</span>
          </div>

          <div className={styles.appointmentList}>
            {customers.length === 0 ? (
              <div className={styles.empty}>
                今日の予約はありません🌸<br />
                ゆっくりお過ごしください
              </div>
            ) : (
              customers.map((c, i) => (
                <AppointmentCard
                  key={c.id}
                  customer={c}
                  index={i}
                  onSelect={handleCardTap}
                />
              ))
            )}
          </div>
        </section>

        {staff.role === 'admin' && onLineAdmin && (
          <div className={styles.adminArea}>
            <button className={styles.lineAdminBtn} onClick={onLineAdmin}>
              LINE配信管理
            </button>
          </div>
        )}

        <div className={styles.logoutArea}>
          <button className={styles.logoutBtn} onClick={onLogout}>ログアウト</button>
        </div>

      </div>

      {isModalOpen && (
        <CustomerHalfModal
          customer={modalCustomer}
          onClose={handleClose}
          onStartService={handleStart}
        />
      )}

    </div>
  );
}
