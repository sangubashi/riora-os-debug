# Riora OS 個人情報(PII)保持ポリシー v1

- 作成: Phase SEC-PII-2(調査のみ・実装禁止・DB変更禁止)
- 目的: Riora OSで保持する個人情報の最終ポリシーを確定する
- 調査方法: 実DBスキーマ(information_schema)・実データ分布・アプリケーションコード(grep)による確認。推測を含む箇所は明記する。

## 前提(ユーザー確定方針)

- 電話番号: **使用しない・保存しない・名寄せに使用しない**
- メールアドレス: **使用しない**
- LINE User ID: **現時点では使用しない**
- 住所: **都道府県・市区町村まで。番地以降は保持しない**

必須保持: 氏名 / 生年月日 / 誕生日 / 担当スタッフ / 来店履歴 / 施術履歴 / 購入履歴 / 顧客メモ / AI学習用特徴量 / 都道府県 / 市区町村
保持しない: 電話番号 / メールアドレス / LINE User ID / 番地以降の住所

対象テーブル: `customers` / `brain_customers` / `customer_memories` / `voice_notes` / `reservations`

---

## 1〜3. 現在保存されているPII一覧・保存箇所・利用画面

### 1.1 `customers`(legacy顧客表)

| カラム | 型 | PII該当 | 実データ状況 | 利用画面 |
|---|---|---|---|---|
| `name` | text | 氏名 | 30件中30件入力あり | 顧客一覧・詳細系(legacy経路。現行UIの主経路は`brain_customers`) |
| `name_kana` | text | 氏名(カナ) | 未確認(grep上コード内での表示利用箇所なし) | 見つからず |
| `phone` | text | **電話番号** | **30件中0件(全件NULL・実質未使用)** | 見つからず(`src/components`内で`.phone`参照0件) |
| `email` | text | **メールアドレス** | 未確認 | 見つからず(コード内`.email`参照は全てスタッフ認証(`auth.users.email`)用途であり顧客emailの表示・利用箇所なし) |
| `memo` | text | 自由記述(顧客メモ相当) | 使用中 | 顧客メモ系UI |
| `skin_tags` | text[] | 施術関連特徴量 | 使用中 | 顧客詳細・AI提案系 |
| その他(`visit_count`/`total_spent`/`avg_price`/`line_response_rate`/`vip_rank`/`churn_risk_score`等) | — | AI学習用特徴量相当 | 使用中 | ダッシュボード・顧客詳細 |

**生年月日・誕生日・住所(都道府県/市区町村)に該当するカラムは`customers`に一切存在しない。**

### 1.2 `brain_customers`(現行の主顧客表)

| カラム | 型 | PII該当 | 実データ状況 | 利用画面 |
|---|---|---|---|---|
| `name` | text | 氏名 | 使用中(現行UIの主経路) | 顧客一覧・`CustomerBottomSheet`等ほぼ全顧客詳細UI |
| `prefecture` | text | **都道府県** | CSV取込では常にNULL(現行SalonBoard売上明細CSVに対応列が存在しないため)。手動入力経路の有無は未確認 | 表示UI見つからず(`csv-import`のimport側コードのみで参照) |
| `city` | text | **市区町村** | 同上(常にNULL) | 同上 |
| `age_group` | text | 生年月日相当(年代のみ・年代区分) | CSV取込では常にNULL | 表示UI見つからず |
| `wedding_date` | date | 記念日(誕生日ではない) | 未確認 | 見つからず |
| `assigned_staff_id` | uuid(FK→ profiles相当) | 担当スタッフ | 使用中 | 顧客詳細・予約系全般 |
| `churn_score`/`type_confidence`/`customer_type` | — | AI学習用特徴量 | 使用中 | AI提案・タイムライン・ダッシュボード |
| `external_key_hash` | text | 会員番号ハッシュ(PIIの仮名化値) | CSV取込の名寄せキー | 表示なし(内部処理専用) |

**電話番号・メールアドレス・LINE User IDに該当するカラムは`brain_customers`に一切存在しない**(確認済み)。
**生年月日・誕生日に該当する専用カラムも存在しない**(`age_group`は年代区分のみで生年月日そのものではない)。

### 1.3 `customer_memories`

| カラム | 型 | PII該当 | 実データ状況 | 利用画面 |
|---|---|---|---|---|
| `content` | text | 自由記述(顧客メモ本体。家族・記念日・趣味等の個人情報を含みうる) | 使用中(現状DB上1件のみ) | `CustomerMemorySection`・`CustomerMemoryTab`・AI Timeline(`timeline-summary`/`conversation-starters`のプロンプト入力) |
| `memory_type` | text(CHECK: family/anniversary/hobby/occupation/life_event/travel/pet/other) | メモ分類 | 使用中 | 同上 |
| `trigger_date` | date | **誕生日・記念日等が入り得る唯一の日付フィールド** | 現状データなし(`anniversary`該当行0件) | `CustomerMemorySection`(「◯日まで」表示) |
| `is_sensitive` | boolean | センシティブフラグ | 使用中 | 同上・AI Timelineの「避けるべき話題」 |

**重要な発見**: Riora OS全体を通じて、**「生年月日」「誕生日」を構造化データとして保持する専用カラムはどのテーブルにも存在しない**。ユーザー要件の「必須保持: 生年月日・誕生日」を満たす唯一の実装経路は、`customer_memories.content`(自由記述)+`memory_type='anniversary'`+`trigger_date`の組み合わせであり、これは**任意入力の自由記述メモであって、構造化された生年月日フィールドではない**。現状は該当データ0件。

### 1.4 `voice_notes`

| カラム | 型 | PII該当 | 実データ状況 | 利用画面 |
|---|---|---|---|---|
| `transcript` | text | **音声の文字起こし全文。顧客が話した内容そのものであり、家族構成・住所・体調等の機微情報が偶発的に含まれうる自由文** | 使用中(18件) | `VoiceMemoSection`・`customer_notes`/`booking_prompts`/`handover_notes`生成元 |
| `summary`/`insight_summary` | text | 上記の要約(同様のリスクを継承) | 使用中 | 同上・AI Timeline |
| `ng_topics` | jsonb | 触れてはいけない話題(機微情報) | 使用中 | 今日タブブリーフィング・AI Timeline |
| `buy_tendency` | jsonb | 購買傾向(AI学習用特徴量) | 使用中 | LINE提案生成(`lineQueueGenerator.ts`) |
| `storage_path` | text | 音声ファイル自体(生の音声=生体的な個人情報相当) | 使用中 | Storage経由でWhisper解析にのみ使用、UI表示はしない |

`transcript`は構造化PIIではないが、**内容として電話番号・メールアドレス等が偶発的に発話・記録される可能性がある自由文**である点をリスクとして明記する(現状サニタイズ処理は確認できず)。

### 1.5 `reservations`

| カラム | 型 | PII該当 | 実データ状況 | 利用画面 |
|---|---|---|---|---|
| `customer_id`/`brain_customer_id` | uuid | 顧客参照(ID自体はPIIではないが名寄せの起点) | 使用中 | 今日タブ・ホーム予約一覧 |
| `staff_id` | uuid | 担当スタッフ参照 | 使用中 | 同上 |
| `notes` | text | 自由記述(顧客の要望等、内容次第でPIIを含みうる) | 使用中 | 見つからず(表示UI未確認・保存のみ) |
| `customer_hash_id` | text | 仮名化ID(`customers_pii.hash_id`参照) | 未使用(実データ上の利用箇所未確認) | ― |

**電話番号・メールアドレス・生年月日・住所に該当するカラムは`reservations`に一切存在しない。**

### 1.6 スコープ外だが方針上重要な発見(参考)

対象5テーブル外だが、ユーザー方針「LINE User IDは現時点では使用しない」に直接関わるため付記する: **`line_user_ids`テーブルにLINE User ID・表示名・プロフィール画像URLが現在も実データとして保存・利用されている**(LINE配信キュー生成・承認フロー・LINE管理画面で参照)。今回のポリシーが「新規に使用しない」という意味であれば矛盾しないが、「既存分も含め使用しない」という意味であれば**現状の運用と方針が矛盾している**ため、別途方針の明確化が必要(本ポリシーのスコープ外につき詳細調査は未実施)。

---

## 4. 削除しても影響のない項目

コード内で表示・参照箇所が一件も見つからなかった項目(削除の実害が低いと考えられる):

- `customers.phone`(全件NULL・参照コード0件)
- `customers.email`(表示・利用箇所なし)
- `customers.name_kana`(表示箇所なし)
- `brain_customers.wedding_date`(表示箇所なし)
- `brain_customers.prefecture`/`city`/`age_group`(現状全てCSV取込経路で常にNULL・表示箇所なし。ただし**ユーザー必須保持方針の「都道府県・市区町村」の受け皿として温存すべきカラムでもある**ため、削除候補ではなく「未利用だが今後使う前提のカラム」として扱う)
- `reservations.customer_hash_id`(利用箇所未確認)

---

## 5. 匿名化可能な項目

- `voice_notes.transcript`/`summary`: 文字起こし全文は施術記録として業務上必要だが、AI学習(`brain_events`等の匿名化パイプライン)へ渡す際は既存の`brain_events.customer_hash`方式(`sha256(customer_id + store.anon_salt)`)と同様の仮名化を経由する運用が既に存在する(`brain_events`テーブルコメント参照)。個票としての`voice_notes`自体を匿名化する設計は現状ない。
- `customer_memories.content`: `is_sensitive=true`のメモはAI Timeline生成時に「詳細を書かず配慮の方向性のみ記載する」という既存の擬似匿名化ルールが実装済み(`timeline-summary/route.ts`のプロンプト設計)。
- `customers.phone`/`email`: 実データが元々存在しない(全件NULL)ため、匿名化ではなく**削除が適切**(§4参照)。

---

## 6. 予約CSV取込時に保存対象とする項目(RES-2/RES-3設計との整合)

Phase RES-2/RES-3で確定した予約CSV(`予約一覧_*.csv`)マッピングのうち、PIIに該当する列の扱いを本ポリシーに照らして再確認する:

| CSV列 | 本ポリシーでの扱い |
|---|---|
| お名前・フリガナ | **保存する**(氏名は必須保持) |
| 電話番号(列25/29) | **保存しない・名寄せに使用しない**(RES-3で技術的にも「使用不可(0%充足)」と確認済みであり、本ポリシーの「電話番号を保存・使用しない」方針とも整合。氏名ベースの名寄せのみを採用する既存確定方針を維持) |
| お客様番号 | 保存対象(値があれば会員番号として)。ただし現サンプルでは全行空欄 |
| スタッフ名 | **保存する**(担当スタッフは必須保持) |
| 来店日・開始時間・終了時間・所要時間 | **保存する**(来店履歴・施術履歴に相当) |
| 予約時メニュー・予約時合計金額 | **保存する**(施術履歴・購入履歴に相当) |
| ご要望・ご相談等の自由記述欄 | 顧客メモに準ずる扱い。`notes`列へ保存する場合、内容に電話番号等が偶発的に含まれていないかの配慮は今後の実装時の検討事項(本ポリシーでは新規の懸念点として記録するに留める) |
| 性別 | 本ポリシーの必須保持/保持しないリストに明記なし。**要方針決定(B分類)** |

---

## 総括: A/B/C分類

### A. 必須保持

| 項目 | 現状の実装状況 |
|---|---|
| 氏名 | `customers.name`/`brain_customers.name`として実装済み |
| 生年月日・誕生日 | **専用カラムが存在しない**。`customer_memories`(memory_type='anniversary'等)の自由記述としてのみ表現可能。構造化データとしての実装は未着手 |
| 担当スタッフ | `assigned_staff_id`(customers/brain_customers)・`staff_id`(reservations)として実装済み |
| 来店履歴 | `brain_visits`(調査範囲外だが既存)・今後`reservations`経由でも実装(RES-2/RES-3) |
| 施術履歴 | `brain_visits.menu_id`・`reservations.menu`として実装済み/実装予定 |
| 購入履歴 | `brain_visits.treatment_amount`/`retail_amount`・`reservations.price`として実装済み/実装予定 |
| 顧客メモ | `customer_memories.content`・`customers.memo`として実装済み |
| AI学習用特徴量 | `customer_type`/`churn_score`/`type_confidence`/`skin_tags`/`insight_tags`等として実装済み |
| 都道府県・市区町村 | `brain_customers.prefecture`/`city`としてカラムは存在するが**現状常にNULL(未実装状態)**。削除せず今後のデータ投入経路整備が必要 |

### B. 将来検討

- `brain_customers.prefecture`/`city`への実データ投入経路の整備(現状のSalonBoard売上明細CSVには対応列がないため、どこから住所情報を取得するかの設計が別途必要)
- 生年月日・誕生日の構造化保持(`customer_memories`の自由記述運用のままでよいか、専用カラム新設が必要かの判断。DB変更を伴うため別フェーズでの検討事項)
- 予約CSVの「性別」列の扱い方針
- `line_user_ids`のLINE User ID運用と本ポリシー「現時点では使用しない」との整合性の明確化(スコープ外につき本書では判定を保留)
- `voice_notes.transcript`/`reservations.notes`等の自由記述欄に電話番号等が偶発的に混入した場合のサニタイズ方針(現状は`csvImportPipeline.ts`側の`piiSanitizer.ts`のような仕組みが音声メモ・予約メモには存在しない)

### C. 削除候補

- `customers.phone`(全件NULL・コード上の参照0件・電話番号を保存しない方針に合致)
- `customers.email`(参照0件・メールアドレスを使用しない方針に合致)
- `customers.name_kana`(表示・利用箇所なし。ただし氏名カナ自体は必須保持の「氏名」に含まれる可能性があるため、削除ではなく「未使用だが氏名の一部として今後使う可能性」で**要再検討**)
- `brain_customers.wedding_date`(表示箇所なし。ただし記念日情報として`customer_memories`側に統合済みのため重複管理となっている可能性があり、削除ではなく整理対象として記録)

---

## 本調査で判明した重要な矛盾・ギャップ(申し送り事項)

1. **ユーザー必須保持方針「生年月日・誕生日」に対応する構造化カラムがシステム全体に存在しない**。現状唯一の受け皿は`customer_memories`の自由記述であり、これは任意入力かつ現状データ0件。方針を満たすには実装(DB変更)が必要。
2. **必須保持方針「都道府県・市区町村」も同様に、カラムは存在するが実データ投入経路が存在しない**(CSV取込経路が対応していないため常にNULL)。
3. **`line_user_ids`にLINE User IDが現在も実運用で保存・利用されており、「LINE User IDは現時点では使用しない」という方針と現状のシステム動作が一致していない**(スコープ外のため本書では是正提案はしない、事実の指摘のみ)。

いずれも本フェーズは調査のみのため、対応要否・実施タイミングの判断はユーザーに委ねる。

---

## 追記(2026-09-24): ギャップ1(生年月日)への対応

現場スタッフ運用上の要望により、ユーザー承認のうえ生年月日を構造化データとして
保持する方針に変更した。`brain_customers.birth_date`列を新設し(マイグレーション
`20260924010000_brain_customers_birth_date.sql`、適用は別途承認後)、
`salonBoardParser.ts`のPIIブラックリスト(`isPiiColumn`)から生年月日関連パターンを
除外・`COLUMN_ALIASES.birthDate`を追加した。電話番号・メール・住所等、他のPII除外
方針は変更していない。ギャップ2(都道府県・市区町村)・3(LINE User ID)は本追記の
対象外(引き続き未対応)。詳細はCLAUDE.mdの該当エントリを参照。
