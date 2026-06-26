# Customer Type Engine 事前調査(Pass H)

調査日: 2026-06-25(読み取り専用・本番DB書き込みなし)

## 結論

**本番データで`customer_type`を判定可能な実信号は現状ゼロ件。** Pass Eで確認済みの`goal_note`/`wedding_date`/`brain_skin_records`(全て0件)に加え、新たに調査した「設計上はAI提案エンジン用に明確に意図された実信号」である`brain_menus.target_types`経由の来店履歴シグナルも、**全39件の来店が単一のCSVフォールバックメニュー(target_types=空配列)に紐付いており、判定材料として機能していない**ことが判明した。

## 調査した実信号と結果

| 信号 | 設計上の位置づけ | 実データ件数 | 判定可能か |
|---|---|---|---|
| `brain_customers.goal_note` | 顧客の悩みの自由記述 | 0/40 | 不可 |
| `brain_customers.wedding_date` | E_bridal判定の直接的な根拠 | 0/40 | 不可 |
| `brain_skin_records.*_level` | 肌悩みレベル(ニキビ/毛穴/乾燥等) | 0件(全店舗) | 不可 |
| `brain_menus.target_types`(経由・来店履歴) | **メニュー側にCustomerType[]が設計済み**(`supabase/migrations/20260612000006_seed_master.sql:47-58`で実例: 「毛穴洗浄+ヒト幹19000」→`['B_pore']`等) | 来店39件中、**target_typesが空でない来店は0件**(全件が`role='imported_other', target_types=[]`のCSV取込フォールバックメニューに紐付け) | **不可(現状)** — CSV側のメニュー名マッチングが本来の5メニューに一度も一致していないため |
| `brain_visits.retail_category` | 購入した店販商品名(自由記述) | 13/39件に実データあり(例:「水素サプリ」「RIN スピキュールクリーム」等) | **不可(製品名→customer_typeの対応関係は設計書に存在せず、推測になるため使用しない)** |
| `brain_customers.age_group` / `acquisition_channel` | 補助情報 | 0/40 | 不可 |
| 旧`customers`系(customer_notes等) | 別ID空間・氏名ブリッジ必要 | カテゴリは Family/Work/Health 等(肌悩み軸ではない) | 不可(軸が異なる) |

## 新たな発見: メニューtarget_types経由の信号は「設計上は正しい」が「データ品質により機能していない」

`brain_menus`には実際に5種類のメニューが`customer_type`想定で用意されている:

```
ヒト幹15000(entry)        → 全5タイプ(汎用・判別不可)
毛穴洗浄+ヒト幹19000(pore) → B_pore
水素+ヒト幹18000(sensitive)→ C_sensitive
ハーブピーリング9900(peeling)→ A_acne
EMS+小顔19000(lifting)    → D_aging
```

`brain_visits.menu_id`は`brain_menus(id)`への**必須FK**(NOT NULL)であり、設計上は「どのメニューを使ったか→customer_typeの有力な手がかり」という非常に妥当な実データ経路だった。しかし本番の39件全来店は、CSV取込時にメニュー名が上記5件のいずれにも一致せず、フォールバックメニュー「CSV取込(メニュー名未マッチ)」(`target_types=[]`)に集約されてしまっている。これは過去のCSV Import Pass C/D(メニュー名名寄せ)の精度限界が、間接的にAI提案エンジンの前提データ不足にも連鎖している、という新しい構造的つながりである。

なお、E_bridalに対応する単独メニューは元々存在しない(`wedding_date`が唯一の設計上の判定根拠)。

## 実装方針の提案

上記より、**「今すぐ40件中X件を実際に分類できる」エンジンを作ることはできない**(本番データが無いため)。一方で、タスクの成果物として要求されている「CustomerTypeEngine」自体は、以下の方針で**正しく・誠実に**実装可能:

- 入力: 顧客の来店履歴(`brain_visits.menu_id`→`brain_menus.target_types`)+ `wedding_date`
- ロジック(決定論・推測なし):
  1. `wedding_date`が設定済みなら`E_bridal`(confidence高)
  2. 来店履歴のうち`target_types.length === 1`(単独タイプを明示するメニュー)の来店のみを実信号として集計し、最頻出タイプを採用。`target_types`が空 or 複数種(汎用メニュー)の来店は判別材料として使わない
  3. 実信号が1件も無い場合は`customer_type: null, confidence: 0, reason: 'no_classifiable_signal'`を返す(架空のタイプを割り当てない)
- 現状の本番データに適用した場合の結果: **40件中0件が分類される**(全員`no_classifiable_signal`)。これはエンジンの不具合ではなく、CSV側のメニュー名マッチング精度・顧客のwedding_date未収集という、データ収集側の構造的制約である

この方針で実装を進めてよいか、確認したい。
