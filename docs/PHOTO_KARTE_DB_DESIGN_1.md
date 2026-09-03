# 写真カルテ機能 DB設計レビュー (PHOTO_KARTE_DB_DESIGN_1)

作成日: 2026-09-02
前提: [[PHOTO_KARTE_AUDIT_1]](事前調査・事前棚卸し)の続き。
ステータス: 設計レビューのみ。migration作成・実行・本番DB変更・RLS変更・Storage変更・
コード実装・push・deployは一切行っていない。

確定済み方針(ユーザー承認済み):
- 写真アクセスはB案(service_role限定・API経由のみ)
- tenant/storeは既存踏襲(単一店舗前提、`app.store_id`の全面実効化はしない)

---

## 1. アクセス制御方式(B案の具体化)

### 1-1. karte_importsとの比較

`karte_imports`の実際の設計(棚卸しで確認済み):
- GRANT: `service_role`のみ(SELECT, INSERT)。`authenticated`へのGRANTなし。
- RLS: `ki_select`(qual: `true`)/ `ki_insert`(with_check: `true`) — **RLSは有効だが中身は全許可**。

ここで一つ改善点がある。GRANTで`authenticated`を締め出しているなら、RLS側で`qual: true`
(全許可)を追加する意味は本来ない。むしろ将来誰かが誤って`authenticated`にGRANTを追加した
瞬間、このRLSは何の防波堤にもならず全顧客の全データが晒される。**これは多層防御が
実質1層しかない状態**であり、`brain_customer_photos`ではこの点を改善する。

### 1-2. brain_customer_photosの最終形

```
GRANT:  service_role にのみ SELECT/INSERT/UPDATE/DELETE を付与。
        authenticated / anon には一切GRANTしない。
RLS:    ALTER TABLE brain_customer_photos ENABLE ROW LEVEL SECURITY;
        ポリシーは作成しない(=authenticated/anonは常にゼロ件、service_roleはRLSを
        バイパスするため常に全件アクセス可能)。
```

理由: Supabaseの`service_role`は`BYPASSRLS`属性を持つため、RLSポリシーの有無に関わらず
service_role経由の操作は常に許可される。一方`authenticated`はGRANTが無い時点で
「permission denied」となりRLSの評価にすら到達しない。**ポリシーを一切作らないことで、
将来GRANT設定が誤って緩んだ場合でもRLSが自動的に全件拒否のセーフティネットとして機能する**
(karte_importsの`qual:true`はこの保険を自ら外してしまっている)。

### 1-3. API層

既存の`extractStaffFromRequest()` → `canAccessCustomer(customerId, staffId, isAdmin)`の
順序をそのまま踏襲する。全ての写真関連APIは:

1. JWTからstaff/admin判定(`extractStaffFromRequest`)
2. `canAccessCustomer(customer_id)`でRule A'/B'/C判定
3. 通過したリクエストのみservice roleクライアントで`brain_customer_photos`にアクセス

### 1-4. is_internal_user(棚卸しで発見したAPI層限定ゲート)の扱い

棚卸しの結果、`is_internal_user`(スタッフ本人の顧客レコード除外)はDB関数
(`auth1_v2_can_access_customer()`)にもRLSにも実装されておらず、**API層の
`canAccessCustomer.ts`のみで判定**されていることが判明している。

B案(API経由限定)を採用する場合、写真データへのアクセスは必ず`canAccessCustomer()`を
経由するため、**この関数さえ通れば`is_internal_user`ゲートも自動的に写真機能に適用される**。
つまり今回は「DB側に`is_internal_user`ゲートが無い」という既存の穴を新たに埋める必要はなく、
**B案を徹底すること自体がこの穴を実質的に無害化する**(ブラウザからの直接アクセス経路が
最初から存在しないため)。

ただし、`voice-notes`のようにクライアントから直接Supabaseへアクセスする実装
(anon key + `createSignedUrl`をブラウザから直接呼ぶ)を写真機能で"うっかり"再現すると、
この防御は崩れる。**7節のStorage設計で明記する通り、signed URL発行は必ずサーバーAPI経由に
限定し、ブラウザから`supabase.storage.from('customer-photos')`を直接叩くコードを
書かないことを設計上の絶対条件とする。**

---

## 2. tenant/store設計

### 2-1. 結論: store_idは持たせる

`brain_customers`/`brain_visits`/`brain_staff`/`brain_menus`は全て`store_id`を
NOT NULLで保持しており(棚卸しで実列定義を確認済み)、これは`brain_*`系テーブルの
共通規約になっている。`brain_customer_photos`もこの規約に合わせ、**`store_id`を
NOT NULL REFERENCES brain_stores(id)`として持たせる**。

### 2-2. 現時点での意味

- 現状は`app_store_id()`(session変数`app.store_id`)が未設定のため、既存の
  `brain_customers_store_isolation`ポリシー(`store_id = app_store_id()`)も実質機能していない。
  写真テーブルも同じ制約を引き継ぐため、**store_idを持たせても今回は分離の実効化にはならない**。
- 実際の値は、既存コードと同じく`DEMO_STORE_ID`(固定UUID
  `00000000-0000-0000-0000-000000000001`)をAPI層で設定する。

### 2-3. 持たせる理由(将来の移行を見据えて)

1. **一貫性**: brain_visits等と同じ列を持つことで、将来`app_store_id()`を実効化する際に
   写真テーブルだけ後から列追加・データバックフィルする手間を避けられる。
2. **将来の移行方法**: `app.store_id`実効化のタイミングで、`brain_customer_photos`にも
   他の`brain_*`テーブルと全く同じ形の`store_id = app_store_id()`ポリシーを追加するだけで
   写真も自動的にtenant分離の対象になる。列を今から持たせておけば、その時点でのマイグレーション
   作業は「ポリシー追加」のみで済み、「列追加+全行backfill」という高リスク作業を避けられる。
3. **RLSを使わない今回の設計でも無駄にならない**: 1-2節の通りB案では`authenticated`への
   GRANT自体が無いため、`store_id`は現時点ではRLSの判定に使われない。しかし将来A案
   (RLS直接制御)へ緩和する判断をした場合の移行先としても機能する。

---

## 3. データモデル

### 3-1. customer_id/visit_idの参照先(重複回避の核心)

棚卸しで確認した既存FKの実態:

| テーブル | customer_id参照先 | 備考 |
|---|---|---|
| `karte_imports` | `customers`(legacy) | brain_customer_id列なし |
| `voice_notes` | `customer_id→customers`(legacy)**と**`brain_customer_id→brain_customers`の2列 | 移行途中で列を継ぎ足した跡 |
| `brain_visits` | `brain_customers` | 新系列の正 |
| `auth1_v2_can_access_customer(p_customer_id)` | `brain_customers.id`空間で判定 | brain_visits.customer_id経由 |

**`brain_customer_photos.customer_id`は`brain_customers(id)`のみを参照する1列構成とする。**
`customers`/`brain_customer_id`の2列構成(voice_notesパターン)は踏襲しない。

理由:
- `customers`と`brain_customers`は同一UUIDのミラー行として運用されている(現行DBトリガーで
  backfillされていることが判明済み、[[project_brain_customer_id_migration]])。よって
  UUID自体はどちらを参照しても同じ値になるが、**認可判定の起点である
  `auth1_v2_can_access_customer()`は`brain_customers`/`brain_visits`空間で書かれている**ため、
  新規テーブルは最初から`brain_customers`だけを参照するのが整合的。
- 2列構成は「将来customersを廃止した後にbrain_customer_idだけ使えばよい」という設計だったと
  推測されるが、実際には廃止が進んでおらず両方生き続けている。新規テーブルでこれを増やす
  合理性はない。

### 3-2. visit_idの参照先

`brain_visits(id)`を参照する。理由は3-1と同様(`brain_visits`が来店+施術情報を兼ねる
現行の正系列であるため)。

### 3-3. staff/店舗の参照先

`created_by`は`brain_staff(id)`を参照する(`brain_visits.staff_id`と同じ参照先で統一)。

---

## 4. brain_customer_photos 推奨スキーマ

```sql
-- 設計案(migrationファイルはまだ作成しない)
CREATE TABLE public.brain_customer_photos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id       uuid REFERENCES public.brain_visits(id) ON DELETE SET NULL,
  body_part      text NOT NULL,
  photo_type     text NOT NULL DEFAULT 'progress'
                 CHECK (photo_type IN ('before','after','progress')),
  storage_path   text NOT NULL,
  taken_at       timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.brain_staff(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
```

### 4-1. 依頼カラムの必要性評価

| カラム | 必要性 | 備考 |
|---|---|---|
| `photo_id`(→`id`) | 必須 | 他テーブルと統一し`id`と命名(karte_imports/voice_notes/brain_visits全て`id`)。`photo_id`という名前は使わない。 |
| `store_id` | 必須(2節参照) | brain_*規約への準拠+将来移行の布石 |
| `customer_id` | 必須 | `brain_customers(id)`単参照(3-1節) |
| `visit_id` | 必須だがnullable | 施術と紐付かない単発撮影(初診カウンセリング時等)も許容するためnullable。ON DELETE SET NULL(来店記録が削除されても写真自体は残す) |
| `body_part` | 必須 | 5節参照。自由入力ではなく統一語彙を推奨 |
| `photo_type` | 必須 | 6節参照 |
| `storage_path` | 必須 | Storageオブジェクトへの参照。RLSと直接連動させないため単なる文字列列でよい |
| `taken_at` | 必須 | 撮影日時。アップロード日時(`created_at`)と分離する(後日まとめてアップロードするケースを許容) |
| `created_by` | 必須 | `brain_staff(id)`参照。ON DELETE SET NULLで退職スタッフの写真も残す |
| `created_at` | 必須 | 標準の作成日時 |
| `deleted_at` | 必須 | 論理削除。brain_*標準パターンに準拠 |

**重複させなかったもの**: `updated_at`(brain_*系のほとんどが持たない。写真は基本
イミュータブルで更新しない設計のため不要)。

---

## 5. Before/After・経過比較の設計

### 5-1. 核心的な発見: visit_count_atの再利用

`brain_visits.visit_count_at`(integer NOT NULL)が「その顧客にとって何回目の来店か」を
既に保持している。写真は`visit_id`で紐付くため、**「初回|3回目|6回目|現在」という経過比較は
photo側に専用のシーケンス番号を持たせずとも、`JOIN brain_visits ON photos.visit_id = brain_visits.id`
して`visit_count_at`でソート・フィルタするだけで実現できる**。

```sql
-- 例: ある顧客のある部位の写真を来店回次順に並べる
SELECT p.*, v.visit_count_at, v.visit_date
FROM brain_customer_photos p
JOIN brain_visits v ON v.id = p.visit_id
WHERE p.customer_id = :customer_id
  AND p.body_part = :body_part
  AND p.deleted_at IS NULL
ORDER BY v.visit_count_at ASC;
```

`visit_id`がNULLの写真(単発撮影)は経過比較の対象から自然に外れる(JOINで除外される)。
将来的に必要ならLEFT JOINで別枠表示することも可能。

### 5-2. 「同じ部位」を保証する設計

Before/After・経過比較のいずれも、`body_part`で完全一致フィルタすることを比較UIのクエリ
契約とする。DB制約としては強制しない(CHECK制約で部位語彙を縛りすぎると将来の拡張性を
損なうため、5節のUI/APIレベルでの規律とする)。

### 5-3. Before/After自体の表現

`photo_type IN ('before','after')`の同一`visit_id`ペアを「その施術のBefore/After」として
扱う。異なるvisit間の比較(経過比較)は5-1の`visit_count_at`ベースのクエリで実現し、
`photo_type`は「現在」の位置づけの写真にも`after`または`progress`を割り当てることで
「初回|3回目|6回目|現在」の「現在」列もクエリ上は最新visitの`after`/`progress`写真として
自然に表現できる。

---

## 6. body_part設計(将来の顔/肌マップ拡張余地)

`body_part`は自由入力の`text`とするが、**アプリ層で統一語彙を提示する**方式を推奨する
(DBのCHECK制約による語彙固定はしない — 将来Phase4で肌マップが部位を細分化した際に
migrationなしで語彙を追加できるようにするため)。

初期語彙案(顔まわり中心、Phase4の肌マップとの接続を見据えた命名):
```
face_full(顔全体), forehead(額), cheek_left(左頬), cheek_right(右頬),
nose(鼻), chin(顎), eye_area(目周り), neck(首), other(その他)
```

将来Phase4で肌マップが「額を上部/中部/下部」のように細分化する場合、`body_part`に
新しい値を追加するだけで対応でき、テーブル構造の変更は不要。**この語彙リストはDB制約では
なくアプリ側の定数として管理し、CHECK制約は付けない**(付けると将来の語彙追加が
migration行為になってしまうため)。

---

## 7. photo_type設計

`photo_type IN ('before','after','progress')`の3値を提案する。

- `before`: 施術前の状態を記録した写真
- `after`: 施術直後の状態を記録した写真
- `progress`: 定点観察・経過記録用の写真(施術と直接紐付かない、または「その日の状態記録」)

依頼にあった「経過写真」は`progress`として表現する。将来的に`counseling`(初診カウンセリング時の
記録)等を追加する可能性もあるが、CHECK制約に含めるのは今回の3値のみとし、追加が必要になった
時点でCHECK制約自体をmigrationで更新する(text型なのでCHECK制約の変更のみで済み、
データ移行は不要)。

---

## 8. Storage設計

### 8-1. bucket

- 名称: `customer-photos`(新規)
- Public/Private: **Private**
- 許可MIME: `image/webp`(クライアント側で必ずWebP変換してからアップロードする運用とし、
  それ以外の形式は許可しない)
- ファイルサイズ上限: 圧縮後想定300〜500KB/枚に対し、余裕を見て**5MB**程度を上限とする
  (圧縮に失敗した端末からの生データ混入を防ぎつつ、極端な巨大ファイルは弾く)

### 8-2. パス構造

```
{store_id}/{customer_id}/{photo_id}.webp
```

ユーザー提示案を採用。`voice-notes`の`{staffId}/{customerId}/...`(アップロードした
スタッフ基準)とは異なり、**顧客基準+写真固有IDのフラット構造**とする。理由:

- B案(API経由限定)ではStorage RLSがそもそも`authenticated`に開放されないため、
  `voice-notes`のように「パスの先頭セグメント=auth.uid()」という構造でアクセス制御する
  必要がない。パスは純粋に「整理のためのディレクトリ構造」として設計してよい。
- `staff_id`をパスに含めると、施術記録の性質上「後日別スタッフが確認・追加撮影する」
  ケースでパスの意味が薄れる。顧客基準の方が写真カルテという性質に合う。

### 8-3. Storage RLS

`storage.objects`に対しては**`customer-photos`bucketに関するポリシーを一切作成しない**。
GRANTの話とは別に、Storage APIも結局は`storage.objects`テーブルへのRLSで制御されるため、
`authenticated`/`anon`ロールに対するポリシーが存在しなければ、そのロールでの
アップロード・ダウンロード・signed URL発行はすべて拒否される。

サーバーAPI(service roleクライアント)は`BYPASSRLS`により常にアクセス可能なため、
**アップロード・削除・signed URL発行は全てNext.js API Route経由(service role)で行う**。
ブラウザから`supabase.storage.from('customer-photos')`を直接呼び出すコードは書かない。

### 8-4. signed URL

- 発行はサーバーAPI(`GET /api/customers/[id]/photos/[photoId]/signed-url`)からのみ。
- 有効期限は用途別に分ける:
  - 一覧サムネイル表示: 短め(例: 5〜10分、頻繁に再発行される前提)
  - Before/After比較・詳細表示: 中程度(例: 1時間、voice-notesと同水準)
- 音声メモと異なりブラウザから直接`createSignedUrl`を呼ばない設計のため、
  Storage RLSに`voice-notes`のような「アップロード者=auth.uid()」制約を持たせる必要が
  そもそも発生しない(8-3節と整合)。

### 8-5. アップロード

サーバーAPI(`POST /api/customers/[id]/photos`)がmultipart/form-dataを受け取り、
`canAccessCustomer()`通過後にservice roleで`customer-photos`にアップロードし、
`brain_customer_photos`にレコードを作成する。クライアント側の圧縮・WebP変換は
アップロード前(ブラウザ側)で完了させ、サーバーは受け取ったWebPをそのまま保存する
(サーバー側で再圧縮は行わない、Phase1では)。

### 8-6. 削除

- 基本は論理削除(`deleted_at`更新のみ、Storage上のオブジェクトは残す)。
- Storage上の物理削除(`remove()`)は別途の運用バッチ・管理者操作として切り離す
  (音声メモと異なり、写真は「誤って消してしまった」際の復旧価値が高いため、
  即時物理削除は避ける)。

### 8-7. バックアップ・容量

- 現在の契約プランのStorage容量上限は未確認([[project_backup_recovery_design]]で
  進行中のDBバックアップ基盤とは別に、Storageのバックアップ方針も別途確認が必要)。
- 写真は音声メモよりファイル数・総容量が増えやすい(1施術あたり複数部位×Before/After等で
  ファイル数が音声メモの数倍になりうる)。Phase1着手前にSupabaseダッシュボードで
  現在のStorage使用量・プラン上限を確認することを推奨する。

---

## 9. 画像サイズ戦略

ユーザー提示の基本案(長辺1920px、WebP、quality 80前後、目標300〜500KB/枚)を妥当と評価する。
画質を落としすぎない優先方針とも整合する。

用途別のサイズ戦略:

| 用途 | 想定サイズ | 生成タイミング |
|---|---|---|
| 一覧のサムネイル | 長辺400px程度 | クライアント側で撮影時に本体と同時生成、または本体から都度リサイズ表示 |
| Before/After比較・タイムライン | 長辺800〜1000px程度(「中サイズ」) | 同上 |
| 詳細表示(拡大表示) | 長辺1920px(オリジナル圧縮後) | アップロードされた本体をそのまま使用 |

Phase1では実装をシンプルにするため、**まずオリジナル(長辺1920px・WebP・quality80)の
1サイズのみ保存し、一覧・比較ではCSSの`object-fit`やブラウザの画像デコードでの
表示サイズ縮小に任せる**方式を最初の実装候補とする。複数サイズ(サムネイル別ファイル生成)は
写真枚数が増えて表示パフォーマンスが問題になった時点で追加検討する(Phase1の複雑化を避ける)。

---

## 10. RLS/GRANTの最終形(まとめ)

| 層 | 設定 |
|---|---|
| テーブルGRANT | `service_role`のみ。`authenticated`/`anon`にはGRANTしない |
| テーブルRLS | `ENABLE ROW LEVEL SECURITY`のみ設定し、ポリシーは作成しない(default deny) |
| API認可 | `extractStaffFromRequest()` → `canAccessCustomer(customer_id)` を全エンドポイントで必須実行 |
| Storage RLS(objects) | `customer-photos`bucketに関するポリシーを作成しない(default deny)。全アクセスはservice role経由 |
| is_internal_userゲート | DB/RLSには実装せず、API層の`canAccessCustomer()`を必ず経由させることで担保する(1-4節) |

karte_importsとの違いは「RLSに`qual:true`の緩いポリシーを追加しない」点のみ。これにより
GRANT設定に将来ミスがあってもRLSが最終防波堤として機能する、より安全な構成にしている。

---

## 11. インデックス設計

想定される検索パターン:
1. ある顧客の写真一覧(新しい順) → `customer_id, taken_at DESC`
2. ある顧客のある部位の経過比較 → `customer_id, body_part, visit_id`(5節のJOINクエリ用)
3. ある来店(施術)に紐づく写真一覧 → `visit_id`
4. 店舗全体の棚卸し・管理画面(将来) → `store_id, created_at DESC`

```sql
CREATE INDEX idx_brain_customer_photos_customer_taken
  ON brain_customer_photos (customer_id, taken_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_brain_customer_photos_customer_bodypart
  ON brain_customer_photos (customer_id, body_part)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_brain_customer_photos_visit
  ON brain_customer_photos (visit_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_brain_customer_photos_store
  ON brain_customer_photos (store_id, created_at DESC);
```

`voice_notes`(`idx_voice_notes_customer: customer_id, created_at DESC`)や`karte_imports`
(`idx_karte_imports_customer_created: customer_id, created_at DESC`)と同じ「顧客+日時」の
複合インデックス規約に合わせている。`deleted_at IS NULL`の部分インデックスは
`brain_visits`等の既存論理削除パターンには見られなかったが、写真は件数が多くなりやすく
一覧表示で毎回`deleted_at IS NULL`フィルタが乗ることを踏まえ、Phase1から部分インデックスに
しておくことを提案する(既存規約からの小さな逸脱だが、性能上の実利がある)。

---

## 12. API設計

既存API構造(`extractStaffFromRequest` → `canAccessCustomer` → service roleクライアント、
`/api/voice/*`のパターン)に合わせ、必要最小限の4エンドポイントを提案する。

| メソッド/パス | 用途 |
|---|---|
| `POST /api/customers/[id]/photos` | アップロード(multipart/form-data、visit_id/body_part/photo_type/taken_atを付与) |
| `GET /api/customers/[id]/photos` | 一覧取得(クエリパラメータで`visit_id`/`body_part`/`photo_type`絞り込み。signed URLは含めずstorage_pathのみ返す) |
| `GET /api/customers/[id]/photos/[photoId]/signed-url` | 個別のsigned URL発行(表示直前に都度呼ぶ) |
| `DELETE /api/customers/[id]/photos/[photoId]` | 論理削除(`deleted_at`更新のみ) |

Before/After比較専用のエンドポイントは新設しない。理由: `GET .../photos`に
`body_part`絞り込みを持たせれば、クライアント側で`photo_type`ごとに振り分けて
表示すれば足りるため、専用エンドポイントを増やすと最小限の原則に反する。

一覧取得のレスポンスにsigned URLを含めない設計にしたのは、一覧APIをキャッシュしやすくし、
signed URLの発行(=Storageへの都度リクエスト)を実際に表示する分だけに限定してコストを
抑えるため。

---

## 13. UIとの関係の評価

依頼の構成(スマホ: 顧客詳細→写真カルテ→写真一覧 / iPad: 顧客情報・履歴|写真比較|施術情報)は、
[[PHOTO_KARTE_AUDIT_1]]6節で提示した「2段階構成」と整合している。

- `CustomerBottomSheet.tsx`(430px幅固定、既に2500行超)に`PhotoKarteSection.tsx`という
  アコーディオンセクションを1つ追加し、そこから「写真カルテを開く」導線ボタンを置くだけに
  留めるのが適切と評価する。CustomerBottomSheet本体のロジック・状態管理には手を入れない。
- 専用の写真カルテ画面(全画面モーダルまたは別ルート)を新設し、そこでBefore/After比較・
  経過比較・iPad時の3カラムレイアウトを実装する。この画面はCustomerBottomSheetの
  430px制約から独立しているため、iPadで横向きに開いた際に自由にレイアウトできる。
- 上記の分離により、CustomerBottomSheetへの影響は「セクション1つ+ボタン1つ」に限定され、
  凍結ルール上のリスクを最小化しつつ、写真カルテという新機能が本来必要とする画面設計の
  自由度を確保できる。**この設計方針は適切と判断する。**

---

## 14. 将来拡張(Phase2〜4)への対応可否

| 将来機能 | 今回のデータ構造での対応可否 |
|---|---|
| Apple Pencil / 手書きアノテーション(Phase3) | `brain_customer_photos`に対する子テーブル(例: `brain_photo_annotations`、`photo_id`参照)を後日追加すれば対応可能。今回のスキーマに変更は不要 |
| 顔/肌マップ(Phase4) | `body_part`が自由なtext値でCHECK制約を課していないため、部位語彙の細分化はアプリ側の語彙追加のみで対応可能(6節)。肌状態の構造化データは別テーブル(`brain_skin_records`に類似)で`photo_id`を参照する形で追加可能 |
| AIによるカルテ補助(Phase4) | `visit_id`経由で`brain_visits`/`brain_skin_records`と関連付けられるため、既存のAI提案パイプラインとの接続点は用意されている。ただし今回はAI関連ロジックを一切実装・変更しない |
| カウンセリング履歴・基本カルテ統合(Phase2) | `photo_type`に将来値を追加(CHECK制約の更新のみ)、または別テーブルとの関連付けで対応可能 |

いずれも「今回のテーブル構造を変更せずに追加テーブル・追加値で拡張できる」設計になっている
ことを確認した。

---

## 15. 既存機能への影響整理

| 機能 | 影響 |
|---|---|
| `CustomerBottomSheet.tsx` | セクション追加+導線ボタンのみ。既存セクション・`openSections`状態管理・Adaptive Priorityロジックには触れない |
| AI提案 | 今回一切変更しない。将来Phase4での接続点は14節の通り温存される |
| LINE(`src/components/line/**`等) | 一切触れない(凍結領域) |
| voice notes | 別テーブル・別bucketのため無関係。ただし8-3節の設計は`voice-notes`の弱点(Storage RLSがアップロード者基準)を踏まえた反面教師として活用している |
| 来店履歴(`brain_visits`) | 参照されるのみで、スキーマ変更は発生しない(`visit_id`が既存の`brain_visits.id`をFK参照するだけ) |
| admin領域(`app/admin/**`) | 一切触れない(凍結領域) |

---

## 16. migration案(設計レベル、まだ作成しない)

実装時に必要になる見込みのmigrationは以下の3本(ファイル名はタイムスタンプ命名規約に従う想定):

1. **テーブル作成**: `brain_customer_photos`の`CREATE TABLE`、4節のCHECK制約、
   11節のインデックス4本。
2. **GRANT/RLS設定**: `ENABLE ROW LEVEL SECURITY`、`GRANT ... TO service_role`のみ
   (`authenticated`へのGRANTは意図的に含めない)。10節の通りポリシーは作成しない。
3. **Storage bucket作成**: `customer-photos`bucket(Private, `image/webp`許可,
   5MB上限)。Storage RLSポリシーは作成しない。bucket作成自体はDashboard操作になる
   見込みだが、実行したSQL/設定内容は必ずmigrationファイルにコメントとして残し、
   `voice-notes`で起きた「Dashboard設定がコード管理外になる」問題を繰り返さない。

いずれも今回は設計内容の提示のみであり、ファイル作成・適用は行っていない。

---

## 総括

### 推奨案

- アクセス制御: B案(service_role限定・API経由のみ)。GRANT+RLS(ポリシーなしの完全デフォルト拒否)+API認可+Storage RLS(ポリシーなし)の4層で、`authenticated`ロールからの直接アクセス経路を構造的に消す。
- テーブル: `brain_customer_photos`、`customer_id`は`brain_customers`のみを参照(voice_notesの2列パターンを踏襲しない)。
- 経過比較: 専用シーケンス列を持たず`brain_visits.visit_count_at`を再利用する。
- Storage: 新規`customer-photos`bucket、パスは`{store_id}/{customer_id}/{photo_id}.webp`、signed URL発行はサーバーAPI限定。
- UI: CustomerBottomSheetへの追加は最小限(セクション+導線ボタン)にとどめ、Before/After比較と経過比較は専用の全画面ビューに切り出す。

### 採用理由

- 棚卸しで発見した`voice_notes`の新旧RLSポリシー混在、`karte_imports`の「GRANT制限+緩いRLS」という多層防御の穴を踏まえ、写真という最高機微度データではより厳格な構成(ポリシーなしの完全デフォルト拒否)を採用した。
- 既存の`brain_*`系命名・FK・インデックス規約に極力揃えることで、今後のメンテナンス性とレビューのしやすさを確保した。
- `visit_count_at`の再利用や`body_part`のCHECK制約なし設計により、Phase2〜4の拡張を見据えつつPhase1のスキーマ変更コストを最小化した。

### 残るリスク

1. Storage容量・バックアップ方針が未確認のまま(8-7節)。
2. `is_internal_user`ゲートはAPI層のみで担保されるため、**将来もし写真機能にクライアント直接アクセス経路(voice-notesのような方式)を追加してしまうと、このゲートが機能しなくなる**。実装時にレビューで再確認すべき最重要ポイント。
3. 画像処理ライブラリが未選定(Phase1着手前に決定が必要、DB設計とは独立の課題)。
4. `brain_visits.staff_id`はRESTRICT(削除不可)だが、写真の`created_by`はSET NULLとした非対称性がある。運用上「退職スタッフの写真記録を匿名化してでも残す」方針でよいか、最終確認が必要。

### 実装前に確認すべき項目

- [ ] Supabase契約プランのStorage容量上限確認
- [ ] 画像処理ライブラリ選定(Canvas API自前実装 vs `browser-image-compression`等)
- [ ] `body_part`の初期語彙リスト(6節の案)の最終確定
- [ ] `created_by`のON DELETE方針(SET NULLでよいか)の最終確認
- [ ] Phase1実装順序([[PHOTO_KARTE_AUDIT_1]]12節)のうち、どのサブフェーズから着手するか

この設計案についてご承認いただければ、次はAPI設計の詳細化またはmigrationファイルの
ドラフト作成(作成のみ、適用はしない)に進められます。
