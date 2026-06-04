'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useStaffStore } from '@/store/useStaffStore';
import { Reservation } from '@/types';
import { Check, Save } from 'lucide-react';

export default function QuickServiceLog({ reservation }: { reservation: Reservation }) {
  const { currentStaffId } = useStaffStore();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  // チェック項目の状態管理
  const [status, setStatus] = useState({
    ai_adopted: false,
    next_reserved: false,
    option_sold: false,
    retail_sold: false,
  });

  const toggleStatus = (key: keyof typeof status) => {
    setStatus(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation(); // カード自体のクリックイベント（詳細表示）を防ぐ
    
    if (!currentStaffId) {
      alert('スタッフIDが設定されていません。');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('staff_logs').insert({
        reservation_id: reservation.id,
        customer_id: reservation.customer_id,
        staff_id: currentStaffId,
        ...status,
        service_completed: true,
      });

      if (error) throw error;
      
      setSaved(true);
      setTimeout(() => setSaved(false), 2000); 
    } catch (err) {
      console.error('Save Error:', err);
      alert('保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-dashed border-[#F0E6D9]">
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { id: 'ai_adopted', label: 'AI提案' },
          { id: 'next_reserved', label: '次予' },
          { id: 'option_sold', label: 'OP' },
          { id: 'retail_sold', label: '物販' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={(e) => { e.stopPropagation(); toggleStatus(item.id as keyof typeof status); }}
            className={`px-3 py-1.5 rounded-xl text-xs transition-all ${
              status[item.id as keyof typeof status]
                ? 'bg-[#5C4033] text-white'
                : 'bg-white text-[#9F7E6C] border border-[#F0E6D9]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={loading || saved}
        className={`w-full py-3 rounded-2xl flex items-center justify-center gap-2 transition-all ${
          saved ? 'bg-green-500 text-white' : 'bg-[#C8A58C] text-white active:scale-95'
        }`}
      >
        {loading ? (
          <span className="animate-spin text-lg">⌛</span>
        ) : saved ? (
          <><Check className="w-5 h-5" /> 保存完了</>
        ) : (
          <><Save className="w-5 h-5" /> この内容で保存</>
        )}
      </button>
    </div>
  );
}