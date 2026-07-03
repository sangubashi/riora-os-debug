# Riora OS スタッフアプリ v1.0 凍結宣言

**宣言日**: 2026-07-03
**対象**: スタッフアプリ v1.0（今日／顧客／メモ／わたし／設定 の5タブ構成）
**対象外**: 管理者アプリ（`app/admin/**`）、LINE領域（`src/components/line/**` ほか。詳細は
`docs/V1_FREEZE_SAFETY_RULES.md` を参照）

## 宣言内容

Riora OS スタッフアプリ v1.0 を、以下の条件のもとで**正式に凍結**する。

- 既知バグ **A（LINE反応率固定値）** および **B（音声メモ許可タイムアウトのタイマーリーク）** は
  既知バグとして記録し、**v1.0のスコープには含めない**。修正は **v1.0.1以降**で対応する
  （詳細は `docs/V1_0_KNOWN_ISSUES.md`）。
- v1.0の完成状態は `docs/V1_0_SNAPSHOT.md` に記録された内容をもって正とする。

## 凍結ルール（v1.0.1リリースまで有効）

| ルール | 内容 |
|---|---|
| 機能追加禁止 | v1.0に存在しない新規機能・新規画面・新規タブを追加しない |
| 仕様変更禁止 | 5タブ構成・今日タブのブリーフィング仕様・TL-5構成・AI提案の会話トーン等、
今回合意した設計を変更しない |
| スコープ外修正禁止 | `docs/V1_0_SNAPSHOT.md` に記載のv1.0スコープ外ファイルを、バグ修正・
リファクタ含め一切変更しない |
| LINE領域変更禁止 | `src/components/line/**`、`app/line/**`、`app/api/line/**`、
`app/api/line-queue/**`、`src/lib/line/**` を一切変更しない |

これらは `CLAUDE.md`（Claude Code運用ルール）にも反映済みで、次回以降のセッションでも
自動的に適用される。

## v1.0.1以降で対応する事項

- 既知バグA・Bの修正（`docs/V1_0_KNOWN_ISSUES.md` 参照）
- 前回レビューで指摘した設計判断待ちの項目（`TagFilterBar`の`risk`/`vip`フィルタの扱い）
- LINE領域（`LineApprovalScreen.tsx`／`ChatWindow.tsx`）のスコア/VIP候補/離脱リスク表示の
  是正（ユーザー承認が別途必要）

## 解消済み事項

`src/components/line/LineApprovalScreen.tsx` に残っていた未承認差分は、2026-07-03に
ユーザー承認のうえ `git checkout` によりロールバック済み。LINE領域は現在完全にクリーン
（無変更）な状態であり、「LINE領域変更禁止」ルールを満たしている。

また、設定タブに残っていた「VIP管理」ボタン（`src/components/menu/MenuDashboard.tsx`）も
ユーザー承認のうえ削除済み。
