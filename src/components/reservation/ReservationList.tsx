'use client';

import type { Reservation } from '@/types';
import ReservationCard from './ReservationCard';

export default function ReservationList({ reservations }: { reservations: Reservation[] }) {
  return (
    <div style={{ padding: '8px 20px 32px' }}>
      {reservations.map(r => (
        <ReservationCard key={r.id} reservation={r} />
      ))}
    </div>
  );
}
