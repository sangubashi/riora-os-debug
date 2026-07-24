# Phase 2-B 最終確認 & Phase 2-C 実装チェックリスト

作成日: 2026-07-24 / 種別: 確認作業のみ（コード変更なし）

---

## 確認1: `brain_blog_articles`テーブル作成後の管理画面動作

**本番DB実測結果（読み取り専用クエリで再確認）**: `brain_blog_articles`は依然として本番に**未作成**
（`PGRST205: Could not find the table 'public.brain_blog_articles'`）。そのため実データでの
エンドツーエンド確認は今回も実施不可。以下はコードレベルでの確認結果。

| 操作 | 実装箇所 | 確認方法 | 結果 |
|---|---|---|---|
| 記事登録 | `POST /api/admin/blog-articles` | `tests/api/blog-articles.test.ts` | ✅ 型・バリデーション・repo呼び出しまでテスト済みgreen |
| 一覧取得 | `GET /api/admin/blog-articles` | 同上 | ✅ 403(非admin)・500(repo例外)含め確認済み |
| 編集 | `PATCH /api/admin/blog-articles/[id]` | `tests/api/blog-articles-id.test.ts` | ✅ `isCustomerSafe`→`status`自動同期ロジック含め確認済み |
| 承認 | 同上（`isCustomerSafe:true`送信で`status:'approved'`に同期） | 同上 | ✅ true/false双方向の同期テストあり |
| CSV取込 | `POST /api/admin/knowledge-import/preview`→`commit` | `npx tsc --noEmit`のみ（新規テスト未作成） | ⚠️ 型は通るがテスト未整備。Phase2-Bで意図的にスコープ外とした部分 |

**結論**: コード・型・ビジネスロジックは`e71ca1f`時点で健全（`npm run build`成功・38テストgreen）。
残る不確実性は「migration適用後に実データでSupabase側の列制約・RLSが想定通り動くか」のみで、
これはmigration未適用の間は原理的に検証不能。CSV取込側のテスト空白も残課題。

---

## 確認2: CustomerBottomSheetとの接続ポイント

`src/components/customer/CustomerBottomSheet.tsx`に実装済み（コード変更なし、現状を再読して確認）:

- L298-301: `relatedArticles`状態（`{id, title}`のみ保持）
- L498-515: 既存のHC-2B（`homecareProducts`取得）完了後に発火する独立useEffect。
  `GET /api/blog-articles/related?products=...`を呼び出し
- L1489-1511: 🏠ホームケア使用商品ブロックの直下に「📰 関連記事」を**タイトルのみ**表示
  （`source_url`はAPIレスポンスにも含まれないため、クライアントに一切渡らない設計）
- L1512-1518: 「💬 接客ヒント」は現状**固定3行の静的文言**（AI・キーワード連携なし）

**結論**: 配線は正しく機能する状態。ただし`brain_blog_articles`に`is_customer_safe=true`かつ
`status='approved'`の記事が1件も無い（テーブル自体が存在しない）ため、本番では現状
「📰 関連記事」ブロックは常に非表示（`relatedArticles.length === 0`）。接客ヒントの固定文言も
ブログ内容とは無関係のプレースホルダーのまま。

---

## 確認3: AI提案（NextActionPanel）との接続ポイント

`src/lib/nextAction/generateNextActions.ts`・`src/lib/nextAction/actionRules.ts`を確認した結果、
**`blogArticle`/`BlogArticle`/`keywords`への参照は一切なし**。AI提案パイプラインは現状ブログ機能と
完全に無接続。

**結論**: これはPhase2-A/2-Bのスコープ外として認識していた通りで、退行ではなく「まだ着手していない」
状態。接続の設計自体は`docs/KNOWLEDGE_AI_INTEGRATION_AUDIT_1.md`にPhaseA/B案として存在するが未実装。

---

## 確認4: LINE文面生成に必要なデータ構造の充足状況

LINE文面生成が使う想定の6要素について、既存コードでの取得可否を確認:

| 要素 | データソース | 現状 |
|---|---|---|
| 肌悩み | `Customer.skinTags`（`src/types/index.ts`、`SkinTagKey`） | ✅ 既存の顧客データで取得可能 |
| 施術履歴 | `VisitRepo` / `brain_visits` | ✅ 既存repoで取得可能 |
| 購入商品 | `homecare-products` API（HC-2B、`CustomerBottomSheet`が既に利用） | ✅ 既存APIで取得可能 |
| ホームケア状況 | 同上（使用中商品リスト） | ✅ 既存APIで取得可能 |
| 関連記事（ブログ） | `BlogArticle.keywords`/`category`/`summary`/`products` | ✅ Phase2-Bでフィールド確定済み（migration適用後） |
| 接客メモ | `src/lib/customerNotes.ts`（5カテゴリAI自動生成メモ） | ✅ 既存機構で取得可能 |

**結論**: 6要素すべて、個別には既存のrepo/APIから取得可能なデータ構造が揃っている。
ただし**これら6要素を1つの「LINE文面生成用インプット」にまとめて集約する処理・API・UIは
現状どこにも存在しない**。Phase2-Cで新規に作る必要がある部分。

`summary`フィールドの扱いに注意: `KNOWLEDGE_AI_INTEGRATION_AUDIT_1.md`の設計通り、
`summary`はAIのマッチング用内部シグナルであり、生成された文面にせよ他画面にせよ**顧客に見える形で
そのまま転記してはならない**（薬機法・事実誤認リスク）。LINE文面生成でも同じ制約を引き継ぐ必要がある。

---

## 確認5: Phase 2-C 実装チェックリスト

Phase2-Bで配線済みの基盤の上に、Phase2-Cで新規に実装が必要な項目のみを整理。
**LINE自動送信・Webhook送信は対象外**（スタッフがLINEアプリから手動送信する前提は不変）。

### C-1. migration適用 & 実データ確認（前提作業）
- [ ] ユーザーがSupabase SQL Editorで以下を**この順序で**適用
      1. `supabase/migrations/20260717180000_blog_content_phase1_articles.sql`
      2. `supabase/migrations/20260717190000_knowledge_import_phase1_columns.sql`
- [ ] 適用後、`/admin/blog-content`で記事登録→承認→`/admin/knowledge-import`でCSV取込の
      一連の操作を実データで動作確認（確認1で残った唯一の未検証部分）
- [ ] `knowledge-import`側4ルートのテスト追加（Phase2-Bで意図的に空白のまま残した部分）

### C-2. AI提案（NextActionPanel）とのキーワード一致連携
- [ ] `KNOWLEDGE_TAG_STANDARD_AUDIT_1.md`の統一タグ語彙（`SkinTagKey` 9語＋補助6語、
      商品カテゴリ10語）を`keywords`/`category`の入力候補としてCSV取込・手動登録画面に反映
- [ ] `KNOWLEDGE_AI_INTEGRATION_AUDIT_1.md`のPhaseA設計（`overlaps`によるタグ一致）を
      `actionRules.ts`または`generateNextActions.ts`に接続し、顧客の`skinTags`と一致する
      承認済み記事を1件、既存のAI提案枠に追加
- [ ] 表示文言は`homecareConversationHints.ts`と同様、固定テンプレート経由のみ
      （`summary`原文の直接表示は禁止）

### C-3. CustomerBottomSheetの「💬 接客ヒント」動的化
- [ ] 現状の固定3行を、関連記事の`category`/`keywords`に応じた候補文からの選択に置き換え
      （C-2と同じマッチングロジックを再利用）
- [ ] 「📰 関連記事」ブロックが実データで表示されることを確認（C-1完了が前提）

### C-4. LINE文面生成機能（新規UI・新規ロジック）
- [ ] 6要素（肌悩み・施術履歴・購入商品・ホームケア状況・関連記事・接客メモ）を1顧客分
      集約する新規関数（例: `buildLineMessageContext(customerId)`）を追加
- [ ] AIによる文面生成ロジックを追加（生成のみ。送信APIは一切呼ばない）
- [ ] スタッフ画面に生成文面を表示する新規UI（`CustomerBottomSheet`内、既存ブロックとは別枠を想定）
- [ ] 生成文面の「自由編集」機能（テキストエリア等）
- [ ] 「コピー」ボタンのみ実装（`navigator.clipboard.writeText`程度。送信ボタン・送信APIは実装しない）
- [ ] 生成文面に`summary`原文が漏れていないことをレビュー時に確認（確認4の制約）

### 非対象（Phase2-Cでも実装しない）
- LINE自動送信・Webhook送信・予約後自動送信
- `StaffInvite`/`InviteRepo.ts`の配線修正（別機能、依然スコープ外）
- `brain_blog_articles`への新規列追加（`target_menu_roles`/`image_url`、未確定のPhase2-A提案）
