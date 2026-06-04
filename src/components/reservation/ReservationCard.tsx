'use client';

import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useStaffStore } from '@/store/useStaffStore';
import type { CustomerType, Reservation } from '@/types';

const TYPE_COLOR: Record<CustomerType, { text: string; bg: string }> = {
  '慎重・不安型': { text: '#B05070', bg: '#FCEEF2' },
  '感情重視型':   { text: '#9A7020', bg: '#FFF8EC' },
  '効果重視型':   { text: '#3E7040', bg: '#EFF5ED' },
  '信頼構築型':   { text: '#7A5040', bg: '#F5EEE8' },
  'VIP型':       { text: '#9A7020', bg: '#FFF3DC' },
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

export default function ReservationCard({ reservation: r }: { reservation: Reservation }) {
  const { setSelectedReservation, setSelectedCustomer } = useStaffStore();

  const isDanger = r.churn_risk > 70 || r.days_since_last_visit >= 60;
  const typeColor = TYPE_COLOR[r.customer_type];

  const handlePress = () => {
    setSelectedReservation(r);
    setSelectedCustomer(
      r.customer ?? {
        id: r.customer_id ?? '',
        name: r.customer_name,
        visits: 0, visit_count: 0,
        total_sales: 0, avg_price: 0,
        last_visit: '',
        customer_type: r.customer_type,
        vip_rank: r.is_vip ? 3 : 0,
        churn_risk: r.churn_risk,
        line_response_rate: 0,
        next_visit_prediction: '未算出',
      }
    );
  };

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={handlePress}
      className="w-full text-left mb-4 rounded-[40px] overflow-hidden"
      style={{
        background: '#FFFFFF',
        border: '1px solid #F5E6E8',
        boxShadow: '0 8px 32px rgba(92,64,51,0.07)',
      }}
    >
      {/* ── 3ブロック横並び ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

        {/* ① 左端 — Time */}
        <div style={{
          flexShrink: 0,
          padding: '22px 12px 22px 22px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          minWidth: '76px',
        }}>
          <span style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '28px',
            fontWeight: 700,
            color: '#5C4033',
            lineHeight: 1,
            letterSpacing: '-0.02em',
          }}>
            {formatTime(r.scheduled_at)}
          </span>
          <span style={{ fontSize: '10px', color: '#C8A58C', letterSpacing: '0.04em' }}>
            {r.days_since_last_visit}日前来店
          </span>
        </div>

        {/* 区切り線 */}
        <div style={{ width: '1px', alignSelf: 'stretch', background: '#F5E6E8', flexShrink: 0 }} />

        {/* ② 中央 — Info (flex-1) */}
        <div style={{ flex: 1, minWidth: 0, padding: '18px 14px' }}>

          {/* 名前 + タグ横並び */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '5px' }}>
            <span style={{
              fontSize: '17px',
              fontWeight: 700,
              color: '#5C4033',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}>
              {r.customer_name} 様
            </span>

            {r.is_vip && (
              <span style={{
                fontSize: '10px', fontWeight: 600,
                padding: '2px 10px', borderRadius: '999px',
                background: '#FFF3DC', color: '#C8A58C',
                letterSpacing: '0.08em', flexShrink: 0,
              }}>
                VIP
              </span>
            )}

            <span style={{
              fontSize: '10px', fontWeight: 500,
              padding: '2px 9px', borderRadius: '999px',
              background: typeColor.bg, color: typeColor.text,
              flexShrink: 0,
            }}>
              {r.customer_type}
            </span>

            {isDanger && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                fontSize: '10px', fontWeight: 600,
                padding: '2px 9px', borderRadius: '999px',
                background: '#FCEEF2', color: '#C05060',
                flexShrink: 0,
              }}>
                <AlertTriangle size={9} strokeWidth={2.5} />
                失客注意
              </span>
            )}
          </div>

          {/* メニュー */}
          <p style={{
            fontSize: '13px',
            color: '#9F7E6C',
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {r.menu}
          </p>
        </div>

        {/* ③ 右端 — リオくまアイコン */}
        <div style={{
          flexShrink: 0,
          width: '76px',
          alignSelf: 'stretch',
          background: 'linear-gradient(170deg, #FFF0F3 0%, #F8E6EC 100%)',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <img
            src="/riora-os/rio-kuma.png"
            alt="リオくま"
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              objectFit: 'contain',
              objectPosition: 'bottom center',
            }}
          />
        </div>

      </div>
    </motion.button>
  );
}
