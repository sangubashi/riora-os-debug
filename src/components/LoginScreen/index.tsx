'use client'
import { useState, useCallback } from 'react';
import type { StaffProfile } from '../../types';
import { STAFF_PROFILES } from '../../data/constants';
import { signIn } from '../../lib/auth';
import styles from './LoginScreen.module.css';

interface Props {
  onLogin: (profile: StaffProfile) => void;
}

type Step = 'select' | 'password';

export default function LoginScreen({ onLogin }: Props) {
  const [step,          setStep]         = useState<Step>('select');
  const [selected,      setSelected]     = useState<StaffProfile | null>(null);
  const [password,      setPassword]     = useState('');
  const [showPassword,  setShowPassword] = useState(false);
  const [loading,       setLoading]      = useState(false);
  const [error,         setError]        = useState<string | null>(null);

  const handleSelectStaff = useCallback((profile: StaffProfile) => {
    setSelected(profile);
    setPassword('');
    setError(null);
    setStep('password');
  }, []);

  const handleBack = useCallback(() => {
    setStep('select');
    setSelected(null);
    setError(null);
  }, []);

  const handleLogin = useCallback(async () => {
    if (!selected || !password) return;
    setLoading(true);
    setError(null);
    try {
      await signIn(selected.id, password);
      onLogin(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [selected, password, onLogin]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  }, [handleLogin]);

  return (
    <div className={styles.screen}>
      <div className={styles.logoWrap}>
        <img className={styles.logo} src="/images/logo-bg.jpg" alt="Salon Riora" />
      </div>

      <div className={styles.card}>
        {/* ── Step 1: スタッフ選択 ── */}
        {step === 'select' && (
          <>
            <div className={styles.welcome}>Welcome back</div>
            <div className={styles.desc}>あなたのプロフィールを選択してください</div>
            {STAFF_PROFILES.map((profile) => (
              <button
                key={profile.id}
                className={`${styles.btn} ${profile.role === 'admin' ? styles.btnAdmin : styles.btnStaff}`}
                onClick={() => handleSelectStaff(profile)}
              >
                {profile.name}
                <span className={styles.badge}>
                  {profile.role === 'admin' ? 'ADMIN' : 'STAFF'}
                </span>
              </button>
            ))}
          </>
        )}

        {/* ── Step 2: パスワード入力 ── */}
        {step === 'password' && selected && (
          <>
            <div className={styles.backRow}>
              <button className={styles.backBtn} onClick={handleBack} aria-label="戻る">
                ←
              </button>
              <div className={styles.selectedName}>{selected.name} さん</div>
            </div>

            <div className={styles.passwordLabel}>パスワードを入力してください</div>

            <div className={styles.passwordWrap}>
              <input
                className={styles.passwordInput}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="••••••••"
                autoComplete="current-password"
                autoFocus
              />
              <button
                className={styles.eyeBtn}
                onClick={() => setShowPassword(v => !v)}
                type="button"
                aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
              >
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>

            <button
              className={styles.loginBtn}
              onClick={handleLogin}
              disabled={loading || !password}
            >
              {loading
                ? <span className={styles.spinner} />
                : 'ログイン'}
            </button>

            {error && <div className={styles.error}>{error}</div>}
          </>
        )}
      </div>

      <div className={styles.note}>
        Salon Riora SKINLABO<br />
        株式会社martylabo
      </div>
    </div>
  );
}
