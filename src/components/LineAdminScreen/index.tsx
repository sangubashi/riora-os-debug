'use client'
import { useState, useEffect, useCallback } from 'react';
import type { LineCampaign, CampaignStatus } from '../../types';
import { fetchCampaigns, approveCampaign, updateCampaignMessage, deleteCampaign } from '../../lib/lineAdmin';
import styles from './LineAdminScreen.module.css';

interface Props {
  staffId: string;
  onBack: () => void;
}

const TABS: { label: string; value: CampaignStatus | 'all' }[] = [
  { label: 'ドラフト', value: 'draft' },
  { label: '承認済', value: 'approved' },
  { label: '送信済', value: 'sent' },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function LineAdminScreen({ staffId: _staffId, onBack }: Props) {
  const [activeTab, setActiveTab]     = useState<CampaignStatus>('draft');
  const [campaigns, setCampaigns]     = useState<LineCampaign[]>([]);
  const [loading, setLoading]         = useState(true);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editText, setEditText]       = useState('');
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);

  const load = useCallback(async (status: CampaignStatus) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCampaigns(status);
      setCampaigns(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(activeTab); }, [activeTab, load]);

  const handleTabChange = (tab: CampaignStatus) => {
    setActiveTab(tab);
    setEditingId(null);
    setExpandedId(null);
  };

  const handleApprove = async (id: string) => {
    try {
      await approveCampaign(id);
      await load(activeTab);
    } catch (e) {
      setError(e instanceof Error ? e.message : '承認に失敗しました');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('このドラフトを削除しますか？')) return;
    try {
      await deleteCampaign(id);
      await load(activeTab);
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  const handleEditStart = (c: LineCampaign) => {
    setEditingId(c.id);
    setEditText(c.body);
  };

  const handleEditSave = async (id: string) => {
    if (!editText.trim()) return;
    try {
      await updateCampaignMessage(id, editText.trim());
      setEditingId(null);
      await load(activeTab);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    }
  };

  return (
    <div className={styles.screen}>

      {/* ヘッダー */}
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} aria-label="戻る">←</button>
        <div className={styles.headerTitle}>
          <div className={styles.titleMain}>LINE配信管理</div>
          <div className={styles.titleSub}>AI 半自動配信システム</div>
        </div>
      </header>

      {/* CLIヒント */}
      <div className={styles.cliHint}>
        <span className={styles.cliIcon}>⌘</span>
        <code className={styles.cliCode}>
          ts-node scripts/line/generateCampaign.ts --theme 乾燥
        </code>
      </div>

      {/* タブ */}
      <div className={styles.tabs}>
        {TABS.map(tab => (
          <button
            key={tab.value}
            className={`${styles.tab} ${activeTab === tab.value ? styles.tabActive : ''}`}
            onClick={() => handleTabChange(tab.value as CampaignStatus)}
          >
            {tab.label}
            {activeTab === tab.value && campaigns.length > 0 && (
              <span className={styles.tabBadge}>{campaigns.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* エラー */}
      {error && <div className={styles.error}>{error}</div>}

      {/* コンテンツ */}
      <div className={styles.content}>
        {loading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.dots}>
              <div className={styles.dot} />
              <div className={styles.dot} />
              <div className={styles.dot} />
            </div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>🌸</div>
            <div className={styles.emptyText}>
              {activeTab === 'draft'
                ? 'ドラフトがありません\nCLIから生成してください'
                : 'データがありません'}
            </div>
          </div>
        ) : (
          <div className={styles.list}>
            {campaigns.map(c => (
              <div key={c.id} className={styles.card}>

                {/* カードヘッダー */}
                <div className={styles.cardTop}>
                  <div className={styles.themeChip}>{c.title}</div>
                  <div className={styles.cardDate}>{formatDate(c.created_at)}</div>
                </div>

                {/* ターゲットタグ */}
                {c.target_tags.length > 0 && (
                  <div className={styles.tags}>
                    {c.target_tags.map(tag => (
                      <span key={tag} className={styles.tag}>#{tag}</span>
                    ))}
                  </div>
                )}

                <div className={styles.divider} />

                {/* メッセージ本文 */}
                {editingId === c.id ? (
                  <div className={styles.editWrap}>
                    <textarea
                      className={styles.editArea}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      rows={6}
                    />
                    <div className={styles.editCount}>{editText.length}字</div>
                    <div className={styles.editActions}>
                      <button className={styles.btnSecondary} onClick={() => setEditingId(null)}>キャンセル</button>
                      <button className={styles.btnPrimary} onClick={() => handleEditSave(c.id)}>保存</button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`${styles.messageText} ${expandedId === c.id ? styles.messageExpanded : ''}`}
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  >
                    {c.body}
                    {expandedId !== c.id && <div className={styles.messageFade} />}
                  </div>
                )}

                {/* アクションボタン（ドラフトのみ） */}
                {activeTab === 'draft' && editingId !== c.id && (
                  <div className={styles.actions}>
                    <button
                      className={styles.btnApprove}
                      onClick={() => handleApprove(c.id)}
                    >
                      承認
                    </button>
                    <button
                      className={styles.btnEdit}
                      onClick={() => handleEditStart(c)}
                    >
                      編集
                    </button>
                    <button
                      className={styles.btnDelete}
                      onClick={() => handleDelete(c.id)}
                    >
                      削除
                    </button>
                  </div>
                )}

                {/* 承認済ステータス表示 */}
                {c.status === 'approved' && (
                  <div className={styles.approvedBadge}>
                    承認済 — {c.approved_by}
                  </div>
                )}

              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
