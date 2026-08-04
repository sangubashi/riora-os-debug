# スタッフ権限 本番前監査 (STAFF-PERMISSION-AUDIT-1)

実施日: 2026-08-04
対象: スタッフ role でのアクセス範囲全般（画面・API・データ範囲・編集権限・在籍/退職）

## 総括

- 画面ガード(admin配下)・主要API(admin配下・経営分析系)の`requireAdmin`適用は網羅的で、抜け穴は見つからなかった。
- 顧客データのアクセス範囲(担当のみ/共有)は `src/lib/auth/canAccessCustomer.ts` に一元化されており、`/api/customers/**` 系はほぼ全てこのルールに準拠済み。
- 一方で、**個別に見落とされていた権限チェック漏れを2件（customer-memories個別編集・visits作成）発見し、最小修正済み**。
- **`/api/admin/line/threads` が一般スタッフの未読バッジ機能から呼ばれており、店舗内全顧客のLINE直近メッセージ内容が担当外スタッフにも見える設計**になっていた（重大）→ **2026-08-04追記: 修正済み**(6章参照)。
- 退職済みスタッフはAPIレベルでは完全に締め出されるが、**ログイン画面自体は通過できてしまう**ギャップがあり、これは修正済み。

---

## 1. 画面アクセス(`/admin/**`)

**結果: 問題なし**

- `middleware.ts` は `/test`・`/phase1-debug` の本番404化のみが役割で、`/admin/**` には一切関与しない。
- `/admin/**` は全て `app/admin/layout.tsx` → `AdminAuthGuard`(`src/components/admin/AdminAuthGuard.tsx`) 配下。
  - `useAuthStore.session.user.email` が `isAdminEmail()`(`src/lib/auth/adminEmail.ts`、`admin@salon-riora.jp`固定)と一致しない限り、`GateScreen`（読み込み中表示のみ）を描画し続け、**管理画面のコンテンツ・サイドバーを一切マウントしない**。
  - 未ログイン → `/login`、非admin → `/phase1` へリダイレクト。
- 実機検証（本セッション中の別PHASEで実施済み）でも、一般スタッフ(suzuki@salon-riora.jp)で `/admin/staff-management` に直接遷移すると `/phase1` に弾かれることを確認済み。

## 2. API (`/api/admin/**` および経営・全スタッフ分析系)

**結果: 2件の見落としを確認。いずれも「設計上の意図的な一般公開」と判定し、コード修正は不要と判断**

`app/api/admin/**` 配下の route.ts 39ファイルのうち、`requireAdmin()` を呼んでいないのは以下の2件のみ:

| ファイル | 認証 | 判定 |
|---|---|---|
| `app/api/admin/menu/route.ts` | `extractStaffFromRequest`のみ(isAdmin不問) | **設計どおり**。`app/menu/page.tsx`(一般スタッフの「メニュー」タブ、5タブ構成の1つ)から呼ばれる店舗全体のメニュー閲覧API。パスに`admin`を含むが実体は一般スタッフ公開。 |
| `app/api/admin/line/threads/route.ts` | `extractStaffFromRequest`のみ(isAdmin不問) | **要判断・下記4章で詳述**。 |

それ以外の `requireAdmin` 適用ファイル(business-settings, churn-risk, csv/*, customer-assets, customer-merge/*, customer-type/classify, knowledge-import/*, line/templates/*, line/threads/[recipientId], line/history, menu-master/*, occupancy, proposal-feedback-analytics, proposals/*, staff/*, staff-aliases, staff-analytics, visits/reclassify-menus, blog-articles/*)は全て401(未認証)/403(非admin)を返す構成を確認。

経営分析系(`/api/dashboard`, `/api/dashboard/top`)も `requireAdmin` 適用済み。

`/api/kpi/summary` は非admin向けの個人成績APIで、`requireAdmin`ではなく `extractStaffFromRequest` + `staff.staffBrainId`によるフィルタ(`s.id === staff.staffBrainId`)、および店舗全体売上(`canViewStoreSales`)はadminのみ、という適切な粒度制御を確認。

### 未認証で到達可能な4ルート(意図的、問題なし)
`app/api/cron/dashboard-aggregator`(CRON_SECRET検証)・`app/api/invite/[token]`・`app/api/invite/[token]/complete`(招待トークン自体が認可)・`app/api/line/webhook`(X-Line-Signature HMAC検証)。いずれも認証方式が異なるだけで、無認可ではない。

## 3. データ範囲

### 3-1. 設計の定義場所

顧客アクセス範囲は **`src/lib/auth/canAccessCustomer.ts`** に一元化されている(設計根拠: `docs/AUTH1_V2_DESIGN.md`)。

- **Rule A'**: 直近来店(`brain_visits.visit_date`最新)の担当(`staff_id`)が自分 → 常時閲覧可
- **Rule B'**: 本日の予約担当(`reservations.staff_id`は`auth.users.id`空間のため`brain_staff.user_id`経由で変換して比較) → 当日のみ閲覧可
- **Rule C**: 来店履歴なし かつ 本日予約なし → 店舗内共有(全スタッフ閲覧可)
- 管理者(`isAdmin=true`) → 常時全件

`/api/customers/list`・`/api/customers/[id]`・`/api/customers/search-notes`・`/api/customers/brain-stats`・`/api/customers/[id]/{timeline, timeline-summary, skin-tags, visit-history, homecare-message, homecare-products, line-message, line-send-log, celebration-cards, conversation-starters}`・`/api/customer-memories`・`/api/voice/commit`・`/api/briefing`・`/api/proposals/by-name` の**全てがこのルールに準拠**していることをコード上で確認済み(個別に `canAccessCustomer` または `filterAccessibleCustomerIds` を呼んでいる)。

### 3-2. My Page(他スタッフの実績)

`/api/me/monthly-stats` は常に `staff.staffBrainId`(Bearerトークンから解決した本人)のみでクエリしており、クエリパラメータでの他スタッフID指定は受け付けない(IDOR不可)。

### 3-3. 重大な発見: LINE未読バッジ経由の全顧客会話露出

- `src/store/useLineUnreadStore.ts`(一般スタッフの「今日」タブのLINE未読バッジ・`src/components/phase1/Phase1Screen.tsx`・`LineUnreadSheet.tsx`から使用)が `GET /api/admin/line/threads` を叩いている。
- このAPIは店舗内**全顧客**のLINEスレッド一覧(`recipientId`・`customerName`・`lastMessage`本文・`lastAt`)を**フィルタなしで丸ごと返す**。
- クライアント側では受信済みのうち`lastDirection==='incoming'`のものだけを「未読」として画面表示しているが、これは表示上の絞り込みに過ぎず、**ネットワークレスポンス自体には担当外顧客を含む全顧客の直近LINEメッセージ内容が含まれている**。
- `canAccessCustomer`のRule A'/B'/C(担当顧客+当日予約+共有客のみ)が一切適用されていない。

**この設計は、監査項目3「他スタッフの横断閲覧がない」の受け入れ基準に抵触する疑いがある。**

**2026-08-04追記: 修正済み。詳細は6章「LINE露出の修正」を参照。**

### 3-4. 軽微な設計差異(通知API)

`/api/notifications` の担当スコープは `canAccessCustomer`(Rule A'/B'/C)ではなく、旧来の `brain_customers.assigned_staff_id` 一致で絞り込んでいる(誕生日/記念日/ホームケア通知)。この列は書き込み経路が乏しく約54%しか埋まっていない(既知の課題)ため、非adminスタッフの通知が本来より少なく表示される可能性がある。データが外部に漏れる方向のリスクではなく、機能的な過小表示のリスク。修正は本監査のスコープ外と判断し、次フェーズ課題として記録。

## 4. 編集権限

### 4-1. 修正済み: customer-memories 個別編集・削除の担当外操作

**発見**: `PATCH /api/customer-memories/[id]`・`DELETE /api/customer-memories/[id]`(`app/api/customer-memories/[id]/route.ts`)は、`extractStaffFromRequest`によるログイン確認と、メモがリクエストの`customer_id`に属するかの`verifyOwnership`のみを行っており、**「そのスタッフがその顧客にアクセスできる権限があるか」の判定(`canAccessCustomer`)が一切なかった**。ログイン済みであれば担当外顧客のメモも編集・削除できてしまう状態だった。

同じ機能の一覧取得・新規作成(`app/api/customer-memories/route.ts`)は既に`canAccessCustomer`を適用済みで、個別編集・削除だけが漏れていた。

**修正**: PATCH/DELETE双方に `canAccessCustomer(reqStaff.staffBrainId, customer_id, reqStaff.isAdmin)` チェックを追加(`app/api/customer-memories/[id]/route.ts`)。

### 4-2. 修正済み: visits作成でのスタッフなりすまし・担当外顧客への記録追加

**発見**: `POST /api/visits`(`app/api/visits/route.ts`)は
1. `staffId`をリクエストボディの**クライアント供給値をそのまま**`brain_visits.staff_id`に採用していた(`/api/visits/service-complete`が「client供給値は使わない」と明記して`extractStaffFromRequest`由来のIDを使っているのと対照的)。任意のスタッフが他スタッフのIDを詐称して接客記録を作成できる状態だった。
2. `canAccessCustomer`チェックが無く、担当外顧客にも記録を追加できた。

なお調査の結果、**このエンドポイントは現在どのフロントエンドコードからも呼ばれておらず(`grep`で呼び出し元なしを確認)、実際の接客記録UIは`/api/visits/service-complete`(安全な実装)のみを使用している**。ただしAPIとしては認証さえあれば誰でも到達可能であり、攻撃対象面として残っていたため修正した。

**修正**: `canAccessCustomer`チェックを追加。`staffId`は`staff.staffBrainId ?? input.staffId`(本人IDを優先し、admin(brain_staff行なし)の場合のみクライアント値へフォールバック)に変更。

### 4-3. 未修正・報告のみ: voice-pipeline のcustomerId/staffId信頼

`POST /api/voice-pipeline`(`app/api/voice-pipeline/route.ts`)も同様に、リクエストボディの`customerId`・`staffId`をそのまま使い、`canAccessCustomer`チェックがない。音声メモの解析結果(customer_notes/booking_prompt/handover_notes/contraindications)を担当外顧客に書き込める余地がある。

ただし、このファイルは進行中の音声メモ再実装(VM8等、未コミットの複数レポートが存在)と密接に関わっており、本監査のスコープで不用意に手を入れると既存の作業と衝突するリスクが高いと判断し、**コード修正はせず所見のみ記録**。対応する場合は、`voiceNoteId`が指す`voice_notes`行の`customer_id`/`staff_id`とリクエストボディの値が一致するかを検証する形が望ましい。

### 4-4. 管理者専用の更新がスタッフでできないこと

`brain_menus`(メニューマスタ)・`business-settings`・`customer-merge`・`knowledge-import`・`blog-articles`・`staff`(招待/退職)など、管理機能に属する書き込み系APIは全て`requireAdmin`配下で確認済み(2章参照)。スタッフ権限での到達は不可。

## 5. 在籍・退職

### 5-1. APIレベル: 問題なし

`src/lib/auth/extractStaffFromRequest.ts` が全APIの認証の基点であり、`brain_staff`を`user_id`+`is_active=true`で検索している。**退職済み(`is_active=false`)スタッフはbrain_staff行が見つからず、一般スタッフとしての認証は必ず失敗する**(admin以外は`null`を返し、呼び出し元は401/403)。これにより、退職後は顧客データ・My Page等の**全APIアクセスが遮断される**ことを確認。

### 5-2. 修正済み: ログイン画面自体は通過できてしまう問題

**発見**: `src/store/useAuthStore.ts`の`signIn()`は`supabase.auth.signInWithPassword()`の成否のみで判定しており、`brain_staff.is_active`は一切見ていなかった。退職処理は`brain_staff.is_active=false`にするだけで`auth.users`のパスワード自体は無効化されないため、**退職済みスタッフはSupabase Auth認証自体には成功し、ログイン画面を通過して`/phase1`等の画面が表示されてしまう**(その後の全API呼び出しは5-1により失敗するため、データは一切見えないが、UI上「ログインできてしまう」状態は受け入れ基準に反する)。

**修正**: `signIn()`内で、管理者以外はログイン成功直後に既存の`requireAdmin`配下API(`GET /api/admin/staff`)を1回呼び、`401`(=`extractStaffFromRequest`が`null`を返した=退職済み/無効)ならその場で`signOut()`しログイン失敗として扱うようにした。`403`(有効なスタッフがadmin専用リソースへ弾かれる、想定通りの挙動)はログイン成功として継続する。新規APIエンドポイントは追加せず、既存の軽量GETを流用した(検証API自体に到達できない場合はfail-openとし、既存のログイン成功フローを優先)。

### 5-3. セッション自体の失効について

Supabase AuthのJWTはトークン自体の有効期限内は技術的に有効なままだが(`auth.users`削除やパスワード変更を行っていないため)、5-1の通りAPI層で`is_active`を都度検証しているため、**発行済みJWTを使い回されても顧客データ等へは一切到達できない**。追加のセッション失効機構(トークンrevoke等)は今回のスコープでは不要と判断。

---

## 6. LINE露出の修正 (2026-08-04・STAFF-PERMISSION-AUDIT-2)

### 6-1. 呼び出し元の特定

- `GET /api/admin/line/threads`(`app/api/admin/line/threads/route.ts`)は2つの経路から呼ばれている:
  1. **管理者用**: `src/store/useLineAdminStore.ts` → `src/components/admin/line/ChatListTab.tsx`(`app/admin/line/**`配下、`AdminAuthGuard`経由でadmin以外到達不可)
  2. **一般スタッフ用**: `src/store/useLineUnreadStore.ts` → `src/components/phase1/LineUnreadSheet.tsx`(今日タブの「未返信LINE」シート)・`Phase1Screen.tsx`(バッジ件数表示)
- `LineUnreadSheet.tsx`は単なる「件数」ではなく、`item.lastMessage`(直近メッセージ本文のプレビュー)・`item.name`(顧客名)を含む一覧UIであることを確認。UIコンポーネント自体(表示するプレビュー機能)は変更せず、**APIが返すデータの範囲だけを担当外顧客について絞る**方針とした(「未読件数のみに完全分離」だと既存UIのプレビュー表示自体が壊れるため、UIデザイン変更を避ける本監査の方針とより整合する)。

### 6-2. ID空間の確認

`line_user_ids.customer_id`は`customers(id)`(legacy空間、`supabase/migrations/20260606_create_line_user_ids.sql`)を参照しており、`canAccessCustomer`が前提とする`brain_customers(id)`とは別テーブル・別UUIDプールである。ただし、`docs/`配下の既存調査記録により、**`brain_customers`への新規行作成時に稼働中のDBトリガーが`customers`側へ同一UUIDのミラー行を作成する仕組み**が確認されている(2026-07-20時点でactive brain_customers 140/140が100%ミラー保持)。このため、`line_user_ids.customer_id`(legacy値)を`brain_customers`前提の`filterAccessibleCustomerIds`にそのまま渡しても、ミラーが存在する限り正しく判定できる。ミラーが無い(legacyのみの)行は`brain_customers`側で該当なしとなり、非adminには自動的に除外される(安全側に倒れる)。

### 6-3. 修正内容

- **`src/lib/line/lineAdminQueries.ts`**: `listLineThreads()`に第2引数`scope?: { staffBrainId, isAdmin }`を追加。
  - 省略時(admin画面からの呼び出し)は従来どおり店舗全件を返す(**管理者動作は完全に維持**)。
  - `scope`指定かつ`isAdmin=false`の場合、`canAccessCustomer.ts`の`filterAccessibleCustomerIds()`(Rule A'/B'/C)で`customerId`を絞り込み、担当外顧客のスレッドを除外する。`customerId`が未紐付け(`null`)のLINEユーザーは担当判定不能なため、非adminには常に除外する。
- **`app/api/admin/line/threads/route.ts`**: `staff.isAdmin`/`staff.staffBrainId`を`listLineThreads()`に渡すよう変更。認証方式(`requireAdmin`を使わずisAdmin不問で一般スタッフも許可する設計)自体は維持し、コメントで意図を明記。

### 6-4. 受入基準との対応

- **スタッフが担当外顧客のLINE本文を取得できない**: `GET /api/admin/line/threads`のレスポンス自体から担当外スレッドが除外されるため、ネットワークレベルでも取得不可(表示を隠すだけのフロント側フィルタではない)。
- **今日タブの未読バッジが破綻しない(件数は出る)**: `unreadCount`は絞り込み後の`threads`配列から算出されるため、担当範囲内の未読数が正しく表示される。UIコンポーネント(`LineUnreadSheet.tsx`・`Phase1Screen.tsx`)は無変更。
- **管理者のLINE管理は維持**: `scope`省略時(admin画面)は挙動変更なし。`ChatListTab.tsx`・`DeliveryHistoryTab.tsx`・`TemplateManagerTab.tsx`への影響なし。

### 6-5. 変更しなかったもの

- `app/api/admin/line/threads/[recipientId]/route.ts`(個別スレッドの全メッセージ取得)は元々`requireAdmin`済みで、今回のスコープ外(担当スタッフであっても個別会話の全文取得はできない設計のまま)。この非対称性(一覧はscope付きで一般スタッフ可・詳細はadmin限定)は既存の意図的な設計と判断し、変更していない。
- `voice-pipeline`には触れていない(4-3で報告済みの通り、進行中の別作業との衝突を避けるため)。

---

## 修正ファイル一覧

| ファイル | 内容 |
|---|---|
| `src/store/useAuthStore.ts` | 退職済み/無効スタッフのログイン画面通過を防止(5-2) |
| `app/api/customer-memories/[id]/route.ts` | PATCH/DELETEに`canAccessCustomer`チェック追加(4-1) |
| `app/api/visits/route.ts` | staffIdなりすまし防止・`canAccessCustomer`チェック追加(4-2) |
| `src/lib/line/lineAdminQueries.ts` | `listLineThreads()`に担当範囲スコープ絞り込みを追加(6-3) |
| `app/api/admin/line/threads/route.ts` | スコープ引数を渡すよう変更(6-3) |

いずれもUIデザイン変更・新規の大きな機能追加・migrationは行っていない。無関係ファイルへの変更なし。

## 残課題(次フェーズ対応が必要)

1. `/api/voice-pipeline`のcustomerId/staffId信頼問題(4-3)。音声メモ再実装作業との調整が必要。
2. `/api/notifications`の担当スコープが`assigned_staff_id`ベースで`canAccessCustomer`と不整合(3-4)。過小表示の可能性、データ漏洩方向のリスクではない。
3. `line_user_ids.customer_id`(legacy空間)と`brain_customers.id`の同一性は「稼働中と推定されるDBトリガー」に依存した間接的な保証であり、正体不明のトリガーである点は既知のリスクとして残る(`docs/project_brain_customer_id_migration`系の既存調査記録を参照)。将来このトリガーが変更・削除された場合、LINE一覧の担当範囲フィルタは「該当なし=非表示」側に倒れる(過剰許可にはならない)ため、セキュリティ上のリグレッションにはならない設計だが、注意喚起として記録する。

## build / tsc

- `npx tsc --noEmit`: 修正5ファイルに起因するエラーは0件(既存のe2e/testsファイルの無関係なエラーのみ残存、本監査以前から存在)。
- `npm run build`: 成功(2回目の監査分も含め確認済み)。

## commit / push

- 作業1(4-1・4-2・5-2の3ファイル): commit `770cd87`(`fix(auth): close staff permission gaps on memories, visits, retired login`)。push未実施。
- 作業2(LINE露出修正・6章の2ファイル): commit未実施(ユーザー確認待ち)。push未実施。
