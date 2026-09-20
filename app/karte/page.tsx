'use client'
/**
 * /karte — iPad専用カルテホーム画面(PHASE IPAD-KARTE-ENTRY-1・2026-09-20ユーザー承認)。
 *
 * 認証は`app/ClientShell.tsx`のグローバルガードに一本化する(2026-09-20ユーザー承認・
 * redirectTo対応の追加に伴う修正)。当初はapp/customers/page.tsxに倣いこのページ単体でも
 * 独自にセッション確認していたが、その独自チェックは`redirectTo`を付与せず`/login`へ
 * 遷移させるため、ClientShell側の`redirectTo`付き遷移と競合し「未ログインで/karteへ
 * 直接アクセスした際にredirectToが失われる」不具合の原因になっていた。ClientShellの
 * グローバルガードのみで認証は十分に保護されるため、独自チェックは削除しシンプルにする。
 */
import KarteEntryScreen from '@/components/karte/KarteEntryScreen'

export default function KartePage() {
  return <KarteEntryScreen />
}
