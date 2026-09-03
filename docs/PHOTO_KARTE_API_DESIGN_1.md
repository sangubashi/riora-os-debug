# 写真カルテ機能 API設計書 (PHOTO_KARTE_API_DESIGN_1)

作成日: 2026-09-02
前提: [[PHOTO_KARTE_DB_DESIGN_1]](DB設計レビュー)
ステータス: 設計書のみ。コード変更・migration作成・DB変更・Storage変更・本番操作・
commit/pushは一切行っていない。

本書は既存コード(`src/lib/auth/*`, `app/api/voice/commit/route.ts`,
`src/lib/voice/commitVoiceMemo.ts`, `app/api/customers/[id]/*`,
`app/api/customer-memories/[id]/route.ts`等)を実際に読み込んだ上で、
新しい独自方式を作らず既存パターンへの追従を優先して設計している。

---

## 0. 既存コード調査で確認した再利用パターン(要約)

| パターン | 出典 | 内容 |
|---|---|---|
| 認証 | `src/lib/auth/extractStaffFromRequest.ts` | `Authorization: Bearer`→`auth.getUser()`→`brain_staff.user_id`引き当て。戻り値`{authUserId, staffBrainId, email, isAdmin}` |
| 認可 | `src/lib/auth/canAccessCustomer.ts` | Rule A'/B'/C + `is_internal_user`共通ゲート。`(staffBrainId, customerId, isAdmin)`を取る純関数 |
| adminのみ | `src/lib/auth/requireAdmin.ts` | 今回は不要(写真アップロード等はスタッフ全員が対象の操作) |
| バリデーション | `app/api/_schemas/common.ts` | `idSchema`(zod, 非空文字列)+`toValidationErrorResponse` |
| DBクライアント | `src/lib/repos.ts`の`getServiceClient()` | service roleクライアント生成の共通関数 |
| multipart処理 | `app/api/voice/commit/route.ts` | `req.formData()`→型ガード→400系エラー |
| 冪等アップロード | `src/lib/voice/commitVoiceMemo.ts` + `commitVoiceMemoRepo.supabase.ts` | `clientRequestId`から決定的storage_pathを導出→既存行チェック→`upsert:false`アップロード→競合時再チェック→DB insert、という「Single Write Path」設計 |
| 所有権確認(IDOR防止) | `app/api/customer-memories/[id]/route.ts`の`verifyOwnership()` | 操作対象レコードの`customer_id`が、リクエストの`customer_id`と一致するかを確認してから操作 |
| ファイルサイズ制限 | `app/api/admin/csv/reservation-import/route.ts` | `MAX_UPLOAD_BYTES`定数、`form.get()`後に`file.size`チェック、`400 file_too_large`で返す(413は使っていない) |
| レート制限 | `app/api/customers/[id]/karte-import/analyze/route.ts`等 | `@/lib/rateLimit`の`claudeLimiter`。**LLM呼び出しを伴うエンドポイントにのみ適用**されており、単純なCRUD系エンドポイントには使われていない |
| signed URL発行 | `src/lib/voiceNote.ts`(クライアント側) | **サーバーAPI経由の発行は現状ゼロ件**(grep確認済み)。今回が最初の実装になる |

---

## 1. 顧客の写真カルテ取得

### `GET /api/customers/[id]/photos`

```
Query:
  visitId?:   string  (brain_visits.id、指定時はその来店に紐づく写真のみ)
  bodyPart?:  string  (指定時はその部位のみ)
  photoType?: 'before' | 'after' | 'progress'
  limit?:     number  (デフォルト60、最大200)
  cursor?:    string  (taken_atのISO文字列、これより古い写真を取得。無限スクロール用)
```

- 認証: `extractStaffFromRequest`必須(401)。
- 認可: `canAccessCustomer(staffBrainId, customerId, isAdmin)`必須(403)。
- `id`パラメータは`idSchema`でバリデーション(既存`visit-history`/`karte-import`ルートと同一パターン)。
- 取得元テーブルは`brain_customer_photos`。`visit_id`が付与されている行は`brain_visits`と
  JOINして`visit_date`/`visit_count_at`をレスポンスに含める([[PHOTO_KARTE_DB_DESIGN_1]]5節、
  「初回|3回目|6回目|現在」の経過比較に使うため)。

### 並び順

- デフォルト: `taken_at DESC`(新しい順、一覧表示のデフォルト)。
- `visitId`指定時(Before/After比較目的の取得): `photo_type`昇順(`before`→`after`→`progress`)
  で返し、UI側は左右に並べるだけで済むようにする。
- 経過比較目的(`bodyPart`指定・複数visit横断)の場合はレスポンス内の`visitCountAt`昇順で
  クライアント側が並べ替える(APIは`taken_at DESC`のまま返し、ソートキーだけ提供する。
  比較軸をAPI側で決め打ちしないことで、将来「日付順」「回数順」両方のUIに対応できる)。

### signed URLの生成方法

一覧APIのレスポンスには**signed URLを含めない**(`storage_path`とメタデータのみ返す)。
理由は4節で詳述するが、一覧は数十件になり得るため、signed URL発行(Storageへの都度リクエスト)を
一覧取得のたびに全件分行うのはコストが高く、キャッシュ効率も悪い。**表示直前に4節のバッチ
signed URL APIを呼ぶ2段階方式**とする。

### レスポンス例

```json
{
  "success": true,
  "photos": [
    {
      "id": "uuid",
      "visitId": "uuid | null",
      "visitDate": "2026-08-20 | null",
      "visitCountAt": 3,
      "bodyPart": "cheek_left",
      "photoType": "after",
      "storagePath": "00000000.../customerUuid/photoUuid.webp",
      "takenAt": "2026-08-20T10:30:00Z",
      "createdBy": "staffUuid | null",
      "createdAt": "2026-08-20T10:31:00Z"
    }
  ],
  "nextCursor": "2026-08-01T00:00:00Z | null"
}
```

---

## 2. 写真アップロード

### `POST /api/customers/[id]/photos`

`multipart/form-data`(`app/api/voice/commit/route.ts`と同じ形式)。

```
file:            image/webp の Blob(必須、クライアント側で圧縮・変換済みの前提)
visitId:         string | ''  (任意)
bodyPart:        string       (必須)
photoType:       'before' | 'after' | 'progress' (必須)
takenAt:         string(ISO8601, 任意。省略時はサーバーでnow()を使用)
clientRequestId: string       (必須、冪等性キー)
```

### 処理フロー(commitVoiceMemoパターンを踏襲)

1. `extractStaffFromRequest` → 401
2. `req.formData()`パース失敗 → 400 `invalid_form_data`
3. 必須フィールド欠落・型不正 → 400 `missing_fields`
4. `photoType`が3値以外 → 400 `invalid_photo_type`
5. `file.type !== 'image/webp'` → **415** `unsupported_media_type`
   (voice/csvは400で返しているが、写真は「形式そのものが受理不能」という性質が明確なため、
   本書では意図的に415を採用する。8-2節で既存慣行との差異として明記する)
6. `file.size > MAX_PHOTO_UPLOAD_BYTES`(5MB、[[PHOTO_KARTE_DB_DESIGN_1]]8-1節) → 400
   `file_too_large`(既存の`reservation-import`と同じステータス・コード体系に揃える。
   ファイルサイズは「形式」ではなく「量」の問題であり、既存慣行を優先する)
7. `visitId`が指定されている場合、`brain_visits`に存在し`customer_id`が一致するか確認
   → 不一致・存在しない場合は400 `invalid_visit_id`
8. `canAccessCustomer(staffBrainId, customerId, isAdmin)` → 403
9. **冪等性チェック**: `clientRequestId`から決定的`storage_path`
   (`{store_id}/{customerId}/{clientRequestId}.webp`)を導出し、`brain_customer_photos`に
   同一`storage_path`の行が既にあれば、その行の情報をそのまま返す(`idempotent: true`)。
   commitVoiceMemoと同じ「レコードのstorage_pathを検索キーにする」方式を採用し、
   専用の冪等性カラムを新設しない([[PHOTO_KARTE_DB_DESIGN_1]]のスキーマ変更を増やさないため)。
10. Storageへ`upsert:false`でアップロード。パス衝突時(競合レース) → 再度storage_path検索
    → 見つかれば冪等応答、見つからなければ409 `upload_conflict`
11. `brain_customer_photos`へINSERT(store_id/customer_id/visit_id/body_part/photo_type/
    storage_path/taken_at/created_by)
12. 成功レスポンス

### なぜclientRequestIdをファイル名に使うか(voiceと同じ設計理由)

`brain_customer_photos.id`はDB側で`gen_random_uuid()`により生成されるため、アップロード前には
確定しない。しかし冪等性を担保するにはアップロード前に決定的なパスが必要であり、
`commitVoiceMemo.ts`と同様に**クライアントが発行する`clientRequestId`をファイル名(の一部)に
使うことで、DB行が存在する前でも決定的なStorageパスを算出できる**。

これにより[[PHOTO_KARTE_DB_DESIGN_1]]8-2節で提案した
`{store_id}/{customer_id}/{photo_id}.webp`というパス案は、**`photo_id`ではなく
`clientRequestId`をファイル名に使う形に修正する**必要がある(6節で矛盾点として明記)。

### 二重登録・途中失敗時の扱い

| 失敗パターン | 挙動 |
|---|---|
| ネットワーク切断でクライアントが同じ`clientRequestId`で再送 | 9節の冪等性チェックによりStorageアップロード・INSERTともにスキップされ、既存レコードを返す |
| Storageアップロード成功後、DB INSERT失敗 | **孤児オブジェクト**がStorageに残る(voice-notesと同じ許容設計、[[PHOTO_KARTE_AUDIT_1]]で確認済みの既存挙動を踏襲)。次に同じ`clientRequestId`で再送された場合、Storageの`upsert:false`アップロードは失敗するが、DB行が無いため冪等性チェックはヒットしない → **無限ループになるリスクがある**。これは既存の`commitVoiceMemo`にも内在する未解決の設計上の穴であり、本書では対策案を提示する(6節参照) |
| 同時に同じ`clientRequestId`で2リクエストが競合 | 10節のStorage側`upsert:false`競合検出→再チェックで後着リクエストが冪等応答を返す |

---

## 3. 写真削除

### `DELETE /api/customers/[id]/photos/[photoId]`

- 認証: `extractStaffFromRequest` → 401
- `id`(customerId)を`idSchema`でバリデーション → 400
- `canAccessCustomer(staffBrainId, customerId, isAdmin)` → 403
- **所有権確認**(`customer-memories`の`verifyOwnership()`と同一パターン):
  `brain_customer_photos`から`photoId`で1件取得し、`customer_id`がURLの`id`と一致するか確認。
  不一致・存在しない場合は**403**(既存の`customer-memories`が403を返す慣行に合わせる。
  404にすると「存在するが他人のもの」と「そもそも存在しない」を区別できてしまい情報漏洩に
  なるため、既存慣行通り403に統一する。6節で本設計判断の妥当性を再掲する)
- 削除は**論理削除のみ**(`deleted_at = now()`のUPDATE、[[PHOTO_KARTE_DB_DESIGN_1]]8-6節)。
  Storage側の物理削除はこのAPIでは行わない。

### DB削除とStorage削除の順序

**Phase1ではStorage削除を行わない**(DB論理削除のみ)ため、順序の問題自体が発生しない。
これは[[PHOTO_KARTE_DB_DESIGN_1]]8-6節の方針(即時物理削除を避け、復旧価値を優先する)と
整合している。

将来、物理削除(完全削除)機能を追加する場合は、`voiceNote.ts`の`deleteVoiceNote()`と
同様に「DB論理削除 → 成功を確認 → Storage物理削除」の順序を推奨する
(逆順にすると、Storage削除が先に成功しDB更新が失敗した場合、DBレコードは残るのに
実体ファイルが消えて再生不能な「壊れたレコード」になる。DB更新を先に行い、それが成功した
場合のみStorageを削除すれば、最悪でも「孤児ファイルが残る」だけで済み、レコード自体は
一貫性を保てる)。

### 他顧客の写真を指定できない設計

上記「所有権確認」ステップがこれに相当する。URLパスは`/customers/[id]/photos/[photoId]`と
`customerId`と`photoId`の両方を含む構造にし、**`photoId`だけでなく`id`(customerId)も
一致することを必ずDBクエリで確認する**。`canAccessCustomer(customerId)`だけを見て
`photoId`の所属確認を省略すると、「アクセス可能な顧客Aの下に、実は顧客Bの写真IDを
指定して削除できてしまう」というIDOR脆弱性になるため、この2段階チェックは必須とする。

---

## 4. signed URL

### 誰が生成するか

**必ずサーバーAPI(Next.js API Route、service roleクライアント)が生成する。**
ブラウザから`supabase.storage.from('customer-photos').createSignedUrl()`を直接呼び出す
コードは書かない([[PHOTO_KARTE_DB_DESIGN_1]]1-4節・8-3節の設計を実装レベルで徹底する)。

これは`voiceNote.ts`(クライアント側で直接`createSignedUrl`を呼ぶ)とは意図的に異なる方式であり、
本書6節で既存パターンからの逸脱として明記する。

### エンドポイント設計(1件 + バッチの2種類)

既存パターンには「1件ずつ」しか前例がないが、写真一覧(数十件)を表示する際に1件ずつ
signed URLを取得すると、N+1リクエスト問題になる。したがって:

**`POST /api/customers/[id]/photos/signed-urls`**(新規・バッチ、一覧/比較表示用)

```json
// request
{ "photoIds": ["uuid1", "uuid2", "..."] }
```

- `photoIds`は最大50件まで(それ以上は400 `too_many_ids`)。
- 全`photoIds`について`brain_customer_photos.customer_id === id`であることを一括確認
  (1件でも不一致があれば403、部分成功は返さない=IDORの試行を明確に拒否する)。
- レスポンス:

```json
{
  "success": true,
  "urls": {
    "uuid1": { "url": "https://...", "expiresAt": "2026-09-02T11:00:00Z" },
    "uuid2": { "url": "https://...", "expiresAt": "2026-09-02T11:00:00Z" }
  }
}
```

**`GET /api/customers/[id]/photos/[photoId]/signed-url`**(1件、詳細拡大表示用の簡易版)

- バッチAPIのシングルケースとして残す(詳細表示画面で1枚だけ再取得する場合に、
  バッチAPIを1件配列で呼ぶより意図が明確なため)。
- 内部実装はバッチAPIの単一版を呼ぶ薄いラッパーでよい(コード重複を避ける)。

### 有効期限

- 一覧・比較用(バッチAPI): **10分**。サムネイル的な用途で頻繁に再発行される前提
  ([[PHOTO_KARTE_DB_DESIGN_1]]8-4節の「短め」方針を具体化)。
- 詳細拡大表示(1件API): **1時間**(`voiceNote.ts`の`createSignedUrl(path, 3600)`と同一水準に揃える)。
- 用途はクエリパラメータ`?purpose=thumbnail|detail`で切り替える(2つの別APIを作るのではなく、
  有効期限だけを可変にする)。

### URL期限切れ時の再取得方法

signed URLは`expiresAt`と共に返すため、クライアント側は`expiresAt`を過ぎたURLで表示していた
画像を検知した時点(または表示直前に毎回)で同じ`photoId`に対して再度バッチ/単発APIを呼び直す。
専用の「リフレッシュ」エンドポイントは不要(同じエンドポイントを再呼び出すだけで新しい
signed URLが発行されるため)。

---

## 5. 認可・セキュリティ

| 観点 | 設計 |
|---|---|
| JWT認証 | `extractStaffFromRequest`をそのまま再利用。`Authorization: Bearer`必須 |
| staff.authUserId | `brain_customer_photos.created_by`は`brain_staff.id`(既存`brain_visits.staff_id`と同じ参照先)を格納する。一方、`voice_notes.staff_id`/`karte_imports.staff_id`は**`auth.users.id`(=`staff.authUserId`)を格納する**という異なる慣行だった([[PHOTO_KARTE_DB_DESIGN_1]]3-3節と食い違いがあり、6節で指摘・修正する) |
| canAccessCustomer | 全エンドポイントで必須。写真固有の追加ルールは設けず、既存Rule A'/B'/Cにそのまま従う |
| RLS | [[PHOTO_KARTE_DB_DESIGN_1]]10節の通り、`authenticated`向けポリシーは作成しない(default deny)。API(service_role)がRLSをバイパスして全操作を行う |
| GRANT | `service_role`のみ。`authenticated`にはGRANTしない |
| Storageアクセス | クライアント直接アクセスなし。全てAPI経由のsigned URL方式(4節) |
| IDOR防止 | (a) `canAccessCustomer(customerId)` (b) `photoId`の`customer_id`所有権確認、の2段階を全操作で必須とする(3節) |
| 他店舗アクセス防止 | 現状store_idは単一固定値運用のため店舗間IDORは実質発生しないが、将来のマルチストア化に備え、`brain_customer_photos`取得クエリには`store_id`条件も含めておく(`canAccessCustomer`内部で`brain_customers.store_id = STORE_ID`を既に確認しているため、二重チェックにはなるが将来の齟齬を防ぐ安全策として推奨) |

### 5-1. `created_by`の主体設計(認証主体とスタッフ主体の分離、2026-09-02ユーザー確定)

ユーザー承認により、`created_by`は**`brain_staff.id`参照**で確定した。既存の`voice_notes`/
`karte_imports`(`auth.users.id`参照)には合わせない。将来の混乱を防ぐため、両者の意味を
明確に区別して記録する。

| 概念 | 実体 | 本APIでの変数名 |
|---|---|---|
| **認証主体**(誰としてログインしているか) | Supabase Authが発行する`auth.users.id` | `extractStaffFromRequest()`が返す`RequestingStaff.authUserId` |
| **業務スタッフ主体**(Riora OS上でどのスタッフとして記録するか) | `brain_staff`テーブルの主キー`id` | `extractStaffFromRequest()`が返す`RequestingStaff.staffBrainId` |

- `brain_customer_photos.created_by`のFK先は**`brain_staff(id)`**。
- `voice_notes.staff_id`/`karte_imports.staff_id`は`auth.users.id`(=`authUserId`)を格納する
  別の慣行だが、**写真カルテはこれに合わせず、独自に`brain_staff.id`方式を正とする**
  (ユーザー確定事項)。両テーブルの慣行が混在している事実そのものは
  [[PHOTO_KARTE_AUDIT_1]]・本書6節に記録済み。

#### API実装での取得手順

1. `extractStaffFromRequest(req)`でJWTを検証し、`{ authUserId, staffBrainId, isAdmin }`を得る。
2. アップロードAPI(2節)は、リクエストボディやクエリパラメータに`createdBy`/`staffId`
   相当のフィールドを**一切受け付けない**(仮に送られてきても無視する)。
3. `brain_customer_photos`へのINSERT時、`created_by`列には**サーバー側で解決した
   `staff.staffBrainId`をそのまま使用する**。クライアントが指定した値を使うことは絶対にない。
4. `staff.staffBrainId`が`null`(=admin@salon-riora.jpがbrain_staff行を持たない、
   `extractStaffFromRequest.ts`の設計通り)の場合、`created_by`は`NULL`のまま保存する
   (スキーマ上`created_by`はnullable、[[PHOTO_KARTE_DB_DESIGN_1]]4節)。「管理者が
   アップロードした」という事実はログ(将来必要なら`brain_ops_logs`等)に残す余地はあるが、
   `created_by`列自体に管理者用の特別なIDを発明することはしない。

#### 他スタッフ・他店舗のIDをクライアントから直接指定できないことの担保

- 上記手順の通り、`created_by`はサーバーが`extractStaffFromRequest`の戻り値からのみ
  導出し、リクエストボディの値を採用する経路が存在しない設計とする。これにより
  「他スタッフになりすまして記録する」IDOR類似の攻撃は構造的に防止される。
- 店舗については、現状`extractStaffFromRequest`自体が`store_id`によるスコープを
  持たない([[PHOTO_KARTE_AUDIT_1]]で確認済みの通り、実質単一店舗運用のため)。
  将来マルチストア化する際は、`staff.staffBrainId`が指す`brain_staff.store_id`と、
  操作対象顧客の`brain_customers.store_id`が一致することの確認を
  `canAccessCustomer`側に追加する必要がある(**今回のPhase1スコープ外、
  [[PHOTO_KARTE_DB_DESIGN_1]]2節の「既存踏襲」方針と整合**)。

---

## 6. `PHOTO_KARTE_DB_DESIGN_1.md`との整合性チェック(矛盾・不足の指摘)

API設計を具体化する過程で、DB設計書との間に**3件の矛盾・不足**を発見した。
いずれも今回は指摘のみに留め、DB設計書側の修正はユーザー確認後に行う。

### 矛盾1: Storageパスの`{photo_id}`は使えない → **設計を確定(10節参照)**

DB設計書8-2節は`{store_id}/{customer_id}/{photo_id}.webp`としているが、`photo_id`は
`brain_customer_photos.id`の`gen_random_uuid()`であり、**DB行を作る前にStorageへ
アップロードする(2節の処理順序)場合、アップロード時点ではまだ`photo_id`が存在しない**。
最終的な設計は10節で確定する(結論: `{store_id}/{customer_id}/{clientRequestId}.webp`)。

→ **DB設計書8-2節の修正が必要**(実害はなく、パス生成方法の記述を直すだけ)。

### 矛盾2: created_byの参照先とID空間 → **解決済み(2026-09-02ユーザー確定、5-1節参照)**

DB設計書4節は`created_by uuid REFERENCES brain_staff(id)`としているが、既存コード調査の結果、
`voice_notes.staff_id`・`karte_imports.staff_id`はいずれも**`auth.users.id`
(=`staff.authUserId`)を格納する**慣行だった(`/api/voice/commit/route.ts:74`の
コメント「staff_id は auth.users.id」、`/api/customers/[id]/karte-import/commit/route.ts:82`も同様)。

一方`brain_visits.staff_id`は`brain_staff(id)`を参照する(棚卸しでFK確認済み)。
**既存コードベースには「顧客関連の記録テーブル」と「brain_visits」とで異なる慣行が
混在している**ことが今回の調査で判明した。

ユーザーはこれを踏まえ、**「`created_by`は認証ユーザーそのものではなく、Riora OS上の
業務スタッフを記録する列である」という意味づけを明示した上で、`brain_staff.id`参照を
確定**とした(既存の`voice_notes`/`karte_imports`には無理に合わせない)。
詳細な取得手順・IDOR防止設計は5-1節を参照。

### 不足: アップロード失敗時の孤児オブジェクトが無限に増える経路 → **設計を確定(11節参照)**

2節で指摘した通り、「Storageアップロード成功→DB INSERT失敗→クライアントが同じ
`clientRequestId`で再送→Storage側は`upsert:false`で衝突するがDB側に冪等性チェック対象の
行が無い」というケースで、**エラーが解消されないまま再送を繰り返すと孤児オブジェクトが
積み上がる**。これは`commitVoiceMemo`にも内在する未解決の設計上の穴であり、DB設計書には
記載がない。複数案の比較と推奨案は11節で確定する。

→ **DB設計書には記載がなかった運用上の穴であり、実装フェーズで対応方針を確定する必要がある。**

---

## 7. エラー設計

| ステータス | 使用箇所 | 返却例 |
|---|---|---|
| 400 | 必須パラメータ欠落、`idSchema`検証失敗、`photoType`不正値、`visitId`不整合、ファイルサイズ超過(`file_too_large`)、JSON/FormDataパース失敗 | `{ success: false, error: 'missing_fields' }` |
| 401 | `extractStaffFromRequest`が`null`(未認証・無効トークン) | `{ success: false, error: 'unauthorized' }` |
| 403 | `canAccessCustomer`が`false`、または写真の所有権確認(`customer_id`不一致) | `{ success: false, error: 'forbidden' }` |
| 404 | 存在しない`customerId`自体(`canAccessCustomer`内部で顧客が見つからない場合は403に丸める、既存`canAccessCustomer`の挙動に合わせる。**個別写真の404は使わず403に統一**、6節参照) | (今回404は積極使用しない方針) |
| 409 | アップロード時のStorageパス競合(冪等性チェックで解決できなかった真の衝突) | `{ success: false, error: 'upload_conflict' }` |
| 413 | (使用しない。ファイルサイズ超過は既存慣行に合わせ400で統一) | — |
| 415 | アップロードファイルが`image/webp`以外 | `{ success: false, error: 'unsupported_media_type' }` |
| 429 | 今回のPhase1エンドポイントはLLM呼び出しを含まないため、既存の`claudeLimiter`パターンは適用しない。ただしアップロードAPIへの連続大量リクエストを懸念する場合は、将来的に汎用レート制限の追加を検討事項として残す(今回は未実装) |
| 500 | Storageアップロード例外、DB INSERT/UPDATE例外、env未設定等の予期しないサーバーエラー | `{ success: false, error: 'internal_error' }` |

413/415の使い分けについては既存コードに前例が無いため、本書で新規に採用方針を定義した
(0節・6節参照)。

---

## 8. 既存コードとの整合性・分類

### 8-1. そのまま再利用できるもの

- `src/lib/auth/extractStaffFromRequest.ts`(変更不要)
- `src/lib/auth/canAccessCustomer.ts`(変更不要)
- `app/api/_schemas/common.ts`の`idSchema`/`toValidationErrorResponse`(変更不要)
- `src/lib/repos.ts`の`getServiceClient()`(変更不要)
- `src/lib/constants.ts`の`DEMO_STORE_ID`(変更不要)

### 8-2. 参考にするが修正が必要なもの(パターンの型は同じだが写真用に書き直す)

- `src/lib/voice/commitVoiceMemo.ts` / `commitVoiceMemoRepo.supabase.ts` の
  「Single Write Path + clientRequestId冪等性」パターン → `commitCustomerPhoto.ts`
  (仮称)として写真用に新規作成するが、設計思想はそのまま踏襲する。
- `app/api/customer-memories/[id]/route.ts`の`verifyOwnership()` → 写真テーブル用に
  同じロジックを書き直す(コード共有は難しい、テーブル名が異なるため個別実装になる)。
- `app/api/admin/csv/reservation-import/route.ts`の`MAX_UPLOAD_BYTES`パターン →
  `MAX_PHOTO_UPLOAD_BYTES`として写真用に定義。

### 8-3. 新規作成が必要なもの

- signed URL発行API(`POST .../photos/signed-urls`、`GET .../photos/[photoId]/signed-url`)
  — **サーバー側での`createSignedUrl`呼び出しは今回が初めての実装**であり、直接の前例がない。
- 写真アップロードAPI本体(`POST /api/customers/[id]/photos`)
- 写真一覧API(`GET /api/customers/[id]/photos`)
- 写真削除API(`DELETE /api/customers/[id]/photos/[photoId]`)
- クライアント側の画像圧縮・WebP変換ロジック([[PHOTO_KARTE_AUDIT_1]]既述、DB/API設計とは別レイヤー)

---

## 9. エンドポイント一覧(まとめ)

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/customers/[id]/photos` | 一覧取得(visit/body_part/photo_type絞り込み、signed URLなし) |
| POST | `/api/customers/[id]/photos` | アップロード(multipart、冪等性あり) |
| POST | `/api/customers/[id]/photos/signed-urls` | バッチsigned URL発行(一覧・比較表示用) |
| GET | `/api/customers/[id]/photos/[photoId]/signed-url` | 単発signed URL発行(詳細表示用) |
| DELETE | `/api/customers/[id]/photos/[photoId]` | 論理削除 |

[[PHOTO_KARTE_DB_DESIGN_1]]12節で提案されていた「Before/After比較専用エンドポイント」は
今回も新設しない方針を維持する(1節の`visitId`指定取得で代替可能なため)。

---

## 10. Storageパス設計の確定(矛盾1の解消)

### 10-1. 結論

```
Storageパス:  {store_id}/{customer_id}/{clientRequestId}.webp
DBの id 列:   gen_random_uuid()（Storageパスとは無関係に独立生成）
紐付け方法:   brain_customer_photos.storage_path 列に実際のパス文字列をそのまま保存する
```

`photo_id`(=`brain_customer_photos.id`)とStorageオブジェクトのファイル名は、
**文字列として一致させる必要はない**。両者の対応関係は`storage_path`列という
「ただの参照」で表現すれば十分であり、これは`voice_notes.storage_path`/
`karte_imports`が採らずとも他の多くのDB設計で一般的なパターンである
(ファイルシステム上の名前とDBの主キーを一致させる設計は、むしろIDの外部露出
[パスを見ればレコードの内部IDが分かってしまう]という副作用があるため、
分離しておく方が望ましい)。

### 10-2. なぜ`clientRequestId`が適切か

- `clientRequestId`はクライアントが**アップロード開始前に**生成できる(UUIDv4等)。
  そのため「DB行が存在する前に決定的なStorageパスを決める」という2節の要件を満たす。
- `commitVoiceMemo.ts`の`buildStoragePath()`と全く同じ考え方であり、既存の
  「Single Write Path」設計思想からの逸脱がない。
- `clientRequestId`自体をDBの列として保存する必要はない(11節の推奨案でも同様)。
  `storage_path`文字列から末尾のファイル名部分を取り出せば、必要であれば
  `clientRequestId`を復元できる(デバッグ・問い合わせ対応時に限り、文字列パースで対応する
  想定。専用インデックス列は今回追加しない)。

### 10-3. 最終的なアップロード処理フロー(確定版)

```
1. クライアントが clientRequestId (UUIDv4) を生成
2. クライアントが POST /api/customers/[id]/photos に
   file + visitId + bodyPart + photoType + takenAt + clientRequestId を送信
3. サーバー: storagePath = `${store_id}/${customerId}/${clientRequestId}.webp` を算出
4. サーバー: brain_customer_photos を storage_path で検索(冪等性チェック)
   → 見つかれば既存行をそのまま返す(idempotent: true)
5. サーバー: Storageへ upsert:false でアップロード
   → 成功: 6へ
   → 衝突(409系): 11節の孤児オブジェクト対応ロジックへ分岐
6. サーバー: brain_customer_photos へ INSERT
   (id は DB が自動生成、storage_path 列に手順3の文字列を保存)
7. 成功レスポンス(生成された id を含む)
```

---

## 11. 孤児Storageオブジェクト問題への対応(冪等性とcleanup戦略)

### 11-1. 問題の再確認

「Storageアップロードは成功したが、直後のDB INSERTが失敗する」ケースで、Storage上には
実体ファイルがあるのにDBには行が無い**孤児オブジェクト**が生まれる。クライアントが
同じ`clientRequestId`で再送すると、10-3節の手順5で`upsert:false`のアップロードが
「既に存在する」エラーになるが、手順4の冪等性チェック(DB検索)は空振りするため、
**このリクエストは成功も失敗確定もできず、同じ結果を繰り返すだけになる**
(ユーザー体験としては「何度アップロードしても失敗する」という詰み状態)。

### 11-2. 選択肢の比較

| 案 | 概要 | DBスキーマ変更 | 長所 | 短所 |
|---|---|---|---|---|
| **A. Storage優先+競合時upsert救済**(推奨) | 現行のStorage→DB順序を維持。手順5で衝突を検知した際、DB検索でも見つからない(=真の孤児)と判定できたら、**`upsert:true`で同じパスに上書きアップロードしてから手順6のINSERTに進む** | 不要 | 既存パターン(commitVoiceMemo)からの変更が最小。DB設計書のスキーマを一切変えずに済む | 上書きされる直前のオブジェクトが仮に何らかの理由で他プロセスから参照中だった場合に競合しうる(ただし孤児は定義上DBから参照されていないため実害は低い) |
| B. DB優先(Write-Ahead方式) | 先に`brain_customer_photos`へ`pending`状態の行をINSERT(一意制約は`customer_id + client_request_id`)→Storageへアップロード→成功したら行を`committed`に更新 | **必要**(`client_request_id`列・一意制約・状態列の追加) | 孤児問題が構造的に発生しない。標準的な2相コミットパターン | Phase1のスキーマに列を追加する必要があり、[[PHOTO_KARTE_DB_DESIGN_1]]の确定済み設計を変更することになる。一覧APIも`pending`行を除外するフィルタが必要になり複雑化する |
| C. 定期リコンサイル(バッチ) | Storage上のオブジェクト一覧とDBの`storage_path`一覧を定期的に突き合わせ、DBに対応行が無く、かつ作成から一定時間(例: 24時間)経過したオブジェクトを削除する運用バッチ | 不要 | 実装がシンプルで、A/Bのどちらとも併用できる安全網になる | リアルタイムの詰み状態(11-1節)そのものは解消しない。定期実行の仕組み(cron)が別途必要 |

### 11-3. 推奨案: A + C の併用

- **即時対応としてA**を採用する。理由: DB設計書のスキーマを変更せずに済み
  ([[PHOTO_KARTE_DB_DESIGN_1]]で確定した設計との一貫性を保てる)、かつ既存の
  `commitVoiceMemo`パターンからの差分が「衝突時の分岐を1つ増やすだけ」と小さい。
- **運用上の保険としてC**を将来追加する(Phase1必須ではなく、Phase1運用開始後に
  孤児が実際にどの程度発生するか観測してから判断してよい)。
- **Bは不採用**(Phase1では)。理由: [[PHOTO_KARTE_DB_DESIGN_1]]で確定したスキーマ
  ([[PHOTO_KARTE_DB_DESIGN_1]]4節)を変更することになり、「DB設計レビュー完了」という
  前提を覆してしまう。将来、孤児問題の発生頻度が無視できないレベルになった場合に
  改めて検討する。

### 11-4. 案A確定版のロジック(疑似コード、実装はしない)

```
uploadResult = storage.upload(path, file, { upsert: false })

if uploadResult.conflict:
  existing = db.findByStoragePath(path)
  if existing:
    return existing  // 正常な冪等応答(通常のレース条件)
  else:
    // 真の孤児と判定 → 上書きして仕切り直す
    uploadResult = storage.upload(path, file, { upsert: true })
    if not uploadResult.ok:
      return error(500)
    // このあとの INSERT に進む
```

`upsert:true`への切り替えは「DB検索で本当に見つからなかった場合」のみに限定し、
通常の衝突(手順4の冪等性チェックより後にレースで別リクエストが先着したケース)では
従来通り冪等応答を返す。この分岐により、孤児が原因で永久に失敗し続けるケースを解消しつつ、
正常なレース条件の扱いは変更しない。

---

## 総括

### 推奨案

- 5エンドポイント構成(一覧・アップロード・バッチsigned URL・単発signed URL・削除)。
- 認証・認可は既存の`extractStaffFromRequest`+`canAccessCustomer`をそのまま流用し、
  写真固有の追加認可ルールは設けない。
- アップロードは`commitVoiceMemo`と同じ「clientRequestId起点の冪等性」パターンを踏襲し、
  Storageパスは`{store_id}/{customer_id}/{clientRequestId}.webp`で確定(10節)。
- 孤児オブジェクト対策は「Storage優先+競合時upsert救済(案A)」+将来の定期リコンサイル
  (案C)の併用で確定し、DBスキーマ変更を伴わない(11節)。
- `created_by`は`brain_staff.id`参照で確定し、認証主体(`auth.users.id`)と業務スタッフ主体
  (`brain_staff.id`)を明確に区別した上で、クライアントからの直接指定を構造的に禁止する
  設計とした(5-1節)。
- signed URL発行は完全にサーバー経由に統一し、`voice-notes`のクライアント直接方式は
  踏襲しない(意図的な逸脱、DB設計書の方針を実装レベルで裏付ける)。

### 採用理由

- 既存コードの実際の挙動(`extractStaffFromRequest`/`canAccessCustomer`/
  `verifyOwnership`/冪等アップロード)を読み込んだ上で、車輪の再発明を避けた。
- 一覧表示のN+1問題(signed URLの都度発行)を避けるため、バッチAPIを新設した
  (既存に前例はないが、写真という「一覧表示が前提の機能」特有の要件として正当化できる)。
- 孤児オブジェクト対策は、DB設計書で確定済みのスキーマを変更せずに済む案を優先し、
  設計フェーズの手戻りを避けた。

### 残るリスク

1. 孤児オブジェクトの発生頻度が実運用でどの程度になるかは未知数であり、11-3節の
   「案C(定期リコンサイル)」を実際にいつ追加するかは運用開始後の観測に委ねている
   (Phase1時点では未実装のままでよいと判断したが、監視の仕組み自体もPhase1には含めていない)。
2. `extractStaffFromRequest`/`canAccessCustomer`が現状store_idスコープを持たないため、
   将来のマルチストア化時には5-1節で指摘した追加チェックが必要になる(今回のスコープ外)。

### migration設計へ進むための前提条件と未解決事項

**前提条件(すべて解消済み・今回の設計で確定した内容)**

- [x] `created_by`の参照先: `brain_staff.id`で確定(5-1節)
- [x] Storageパスの生成方法: `{store_id}/{customer_id}/{clientRequestId}.webp`で確定、
      `photo_id`との対応は`storage_path`列のみで表現することで確定(10節)
- [x] 孤児オブジェクト対策: 案A(Storage優先+競合時upsert救済)を採用、DBスキーマ変更なしで
      対応可能と確定(11節)。**これにより[[PHOTO_KARTE_DB_DESIGN_1]]4節のテーブル定義に
      変更は不要**であることが確定した(migration設計はDB設計書の内容をそのまま
      SQL化すればよい)

**未解決事項(migration設計と並行、またはmigration設計後でも対応可能なもの)**

- [ ] 413を使わず400に統一する/415を新規採用するという本書のエラーコード方針への同意
      (API実装時の話であり、migration内容には影響しない)
- [ ] `MAX_PHOTO_UPLOAD_BYTES`の具体的な値(5MB案、[[PHOTO_KARTE_DB_DESIGN_1]]8-1節)の確定
      (Storage bucketの`file_size_limit`設定に影響するため、Storage設計の適用時までに確定が必要)
- [ ] バッチsigned URL APIの`photoIds`上限50件という数値の妥当性(API実装時の話)
- [ ] 11-3節の「案C(定期リコンサイル)」を将来いつ・どのように追加するか(Phase1必須ではない)
- [ ] [[PHOTO_KARTE_DB_DESIGN_1]]総括に記載の残る確認事項(画像処理ライブラリ選定、
      Storage容量・保持期間)は本書のスコープ外のまま未解決

### 「API設計レビュー完了後にmigration設計へ進むべきか」の判断

**進んでよい。** 当初6節で指摘した3件の矛盾・不足は、5-1節(`created_by`)・10節
(Storageパス)・11節(孤児オブジェクト)でいずれも設計として確定し、**
[[PHOTO_KARTE_DB_DESIGN_1]]4節のテーブル定義そのものへの変更は不要**であることが
確認できた。migration設計はDB設計書の内容をそのままSQL化する作業として進めてよい。
ただしmigrationファイルの作成・実行は別途明示的な承認があるまで行わない。

---

## API設計追補: GET /photos ソート順パラメータ(R2, 2026-09-03)

前提: [[PHOTO_KARTE_UX_WIREFRAME_1]]の実装前レビューで指摘(R2)。**まだ`route.ts`の
コード変更は行っていない**。実装時にこの追補の内容を反映すること。

### 背景

1節で定義した`GET /api/customers/[id]/photos`は`taken_at DESC`固定で返す設計だった。
しかし[[PHOTO_KARTE_UX_WIREFRAME_1]]4節の「初回」ゴースト取得
(同一customer_id+同一body_partのうち`taken_at`が最も古い1件)には昇順取得が必要であり、
既存API設計では実現できない(降順で全件取得して末尾を拾う回避策は非効率かつ設計意図に反する)。

### 追加仕様

```
Query(追加):
  order?: 'asc' | 'desc'   (省略時は 'desc'、既存の挙動を維持=後方互換)
```

- `order=desc`(既定): 既存と同じ`taken_at DESC`。**既存の呼び出し元・挙動は一切変わらない**
  (後方互換性を維持。現時点でUI実装は存在しないため実害はないが、設計原則として明記)。
- `order=asc`: `taken_at ASC`。「初回」ゴースト取得(`limit=1`と組み合わせて使用)や、
  将来的な時系列昇順表示に使う。
- カーソルページネーション(既存の`cursor`パラメータ)との組み合わせ: `order=asc`時は
  `cursor`の意味も反転させ、`taken_at`が指定値**より新しい**ものを取得する
  (`.gt('taken_at', cursor)`)。`order=desc`時の既存動作(`.lt('taken_at', cursor)`)は
  変更しない。
- DB変更・migrationは不要。既存インデックス`idx_brain_customer_photos_customer_taken
  (customer_id, taken_at DESC)`はPostgreSQLの性質上、昇順スキャンにもそのまま使えるため
  追加インデックスも不要([[PHOTO_KARTE_DB_DESIGN_1]]11節のインデックス設計に変更なし)。

### 影響範囲

- `app/api/customers/[id]/photos/route.ts`の`GET`ハンドラのみ。同ファイルの`POST`、
  および`signed-urls`・`[photoId]`関連の他エンドポイントには影響しない。
- 現時点でこのAPIを呼ぶUI実装は存在しない([[PHOTO_KARTE_UX_WIREFRAME_1]]策定時点で
  写真カルテUIは未着手)ため、既存呼び出し元への破壊的変更は発生しない。

### 実装時の確認事項(未実施)

- [ ] `order`の不正値(`asc`/`desc`以外)を受け取った場合のバリデーション
      (`invalid_order`等、既存の`invalid_photo_type`と同じ400パターンに揃える)。
- [ ] `tests/api/customer-photos-list.test.ts`に`order=asc`のケース(および
      `order=asc`+`cursor`の組み合わせ)を追加する。

いずれも**設計のみ**であり、`route.ts`のコード変更・テスト追加はまだ行っていない。
実装着手時にこの追補を反映すること。
