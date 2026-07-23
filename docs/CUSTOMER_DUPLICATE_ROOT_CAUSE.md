# 顧客重複発生原因調査 — 小宮山仁美・佐々英之ケース

**ステータス: 調査のみ・コード変更禁止・DB変更禁止・commit禁止**
**作成日: 2026-07-23**
**対象**: `brain_customers`に2件ずつ重複が存在する「小宮山 仁美」「佐々 英之」の2組(customer-merge機能の調査対象として先に発見済み)。

**位置づけ**: `docs/CSV_IMPORT_DUPLICATE_ROOT_CAUSE_AUDIT_V1.md`(2026-07-20)は売上明細CSV**単体**の再取込によるカスケード重複(同一パイプライン内での自己増殖)を扱った。本調査はそれとは異なる経路 ——**予約CSV取込と売上明細CSV取込という2つの別パイプライン間**で発生した重複であることが判明したため、別ドキュメントとして記録する。

---

## 結論の先出し

```
2件目のbrain_customerは「売上明細CSV取込」(csvImportPipeline.ts の runImportPipeline())
で生成された。1件目は2日前の「予約CSV取込」(reservationImportPipeline.ts)で作成された
"スタブ"顧客であり、Customer Resolver(findNameCandidates)自体は1件目を正しく候補として
検出できていた。

しかし1件目のスタブは「visit実績0件・firstVisitDate=null」という状態のまま作成されており、
売上明細CSV側の自動確定マッチ(Pass A+C・legacy Pass N)は両方ともこの状態の候補を
扱えない設計になっている。結果としてneeds_review止まりとなり、運用者が個別に「統合」を
選択しない限り、既定値'new'により新規重複顧客が生成される。

external_key(会員番号ハッシュ)は無関係(両CSVとも会員番号列が空欄)。
再現条件が明確なため、同じ経路で今後も発生し続けると判断する。
```

---

## 1. 実データで確認した経緯(小宮山仁美・佐々英之で共通)

| 順序 | 日時 | customer_id | 作成元 | first_visit_date | brain_visits | reservations |
|---|---|---|---|---|---|---|
| ① スタブ作成 | 2026-07-21T07:16:37/38 | `4d72519c...` / `8bb0ad88...` | 予約CSV取込 | **null** | 0件 | 1件(status: cancelled / confirmed。ともに`会計済み`ではない) |
| ② 重複作成 | 2026-07-23T02:05:51/53(2日後) | `2c420e06...` / `3878e790...` | 売上明細CSV取込 | 実来店日(07-22 / 07-21) | 1件(`source: salonboard_import`) | 0件 |

氏名表記は①②とも完全一致(「小宮山 仁美」「佐々 英之」、スペース位置含め同一)。`docs/CSV_IMPORT_DUPLICATE_ROOT_CAUSE_AUDIT_V1.md`が扱った「表記揺れ」パターンには該当しない。

---

## 2. どの処理で2件目が生成されたか(コードレベル追跡)

### 2.1 1件目(スタブ)の生成元 — 予約CSV取込

`src/lib/import/reservationImportPipeline.ts`

```ts
// runReservationImportPipeline() 内(275-279行目)
const createdCustomer = await repos.customerRepo.create({
  storeId: input.storeId, name: row.customerName, ageGroup: null,
  firstVisitDate: resolved.status === 'completed' ? formatVisitDate(row.visitDate) : null,
  prefecture: null, city: null, externalKeyHash: null,
})
```

`decideReservationCustomerMatch()`(41-45行目)は氏名候補0件のとき`{ status: 'new' }`を返す。小宮山仁美・佐々英之ともCSV取込時点では該当店舗に同名顧客が存在しなかったため、この分岐で新規作成された。

**重要な点**: `firstVisitDate`は`resolved.status === 'completed'`のときのみ設定される。`reservationStatusMapper.ts`によれば`completed`は「会計済み」のみが該当し、「受付待ち」→`confirmed`・「お客様/サロンキャンセル」→`cancelled`は非該当。今回の2件はいずれも会計未了ステータス(confirmed/cancelled)だったため、**firstVisitDateはnullのまま確定した**。`externalKeyHash`もこのパイプラインでは常に`null`固定(会員番号を扱う仕組み自体が無い)。

### 2.2 2件目(重複)の生成元 — 売上明細CSV取込

`src/lib/import/csvImportPipeline.ts` の `matchCustomer()` が該当行を解決する際の実際の分岐(270-342行目):

1. `hash = null`(会員番号列が空欄の実運用CSVのため)
2. `nameCandidates = findNameCandidates(agg.customerName, ctx.existingCustomers)` → **①のスタブ1件を正しく検出**(`nameCandidates.length === 1`)
3. `findAlreadyImportedCandidate()` → スタブはvisit実績0件のため同日importedチェックはヒットせず`null`
4. **Pass A+C** `resolveByVisitProximity([stub], visitDate, repos)`:
   - `recentByCustomer(stub.id, 1)` → 0件 → `withVisits`に追加されずスキップ
   - ループ後 `withVisits.length === 0` → `{ status: 'no_visit_history' }`を返す
   - → `allowLegacyPassNFallback = true`(no_visit_historyの場合のみ旧Pass Nへ委譲可)
5. **legacy Pass N**(326-334行目): `nameCandidates.length === 1 && allowLegacyPassNFallback` は真だが、
   ```ts
   if (sole?.firstVisitDate != null && sole.firstVisitDate <= visitDate) { … }
   ```
   **`sole.firstVisitDate`が`null`のため`!= null`の時点で条件不成立 → Pass Nは発動しない**
6. どちらの自動確定マッチにも失敗 → `decideCustomerMatch()` → `nameCandidates.length > 0`のため`{ status: 'needs_review' }`

`runImportPipeline()`側(518-538行目):

```ts
} else if (decision.status === 'needs_review') {
  needsReviewCount += 1
  const choice = input.reviewDecisions[agg.lineNumber] ?? 'new'   // ← 未指定なら既定'new'
  if (choice === 'merge') {
    customerId = decision.candidates[0].customerId
    updatedCustomers += 1
  } else {
    const created = await repos.customerRepo.create({ … })        // ← ここで2件目が生成される
    …
    newCustomers += 1
  }
}
```

`docs/CSV_IMPORT_DUPLICATE_ROOT_CAUSE_AUDIT_V1.md §3`で既に指摘されている通り、`reviewDecisions`はHTTPリクエスト1回分のみ保持されブラウザ側にも永続化されないため、運用者がこの行に対して個別に「統合」を選択しない限り、既定`'new'`で新規重複顧客が作成される。今回のケースはこれに該当したとみられる。

---

## 3. 各質問項目への回答

### 3.1 どの処理で2件目のbrain_customerが生成されたか
`csvImportPipeline.ts` の `runImportPipeline()` 内、`decision.status === 'needs_review'` かつ `reviewDecisions`が当該行を`'merge'`に設定していなかった分岐(`customerRepo.create()`、536行目)。呼び出し元は売上明細CSV Import実行API(`app/api/admin/csv/import/route.ts`)。

### 3.2 予約CSV取込時か
**1件目(スタブ)がYES。** `reservationImportPipeline.ts`の`runReservationImportPipeline()`が新規作成した。2件目はこの経路ではない。

### 3.3 売上CSV取込時か
**2件目(重複)がYES。** `csvImportPipeline.ts`の`runImportPipeline()`が新規作成した(2.2節参照)。

### 3.4 Customer Resolverか
Resolver自体(`customerMatcher.ts`の`findNameCandidates`)は**正しく機能していた**(スタブを候補として1件検出できている)。両パイプラインとも同一の`findNameCandidates`を共有利用しており、氏名正規化のズレは無い。問題はResolverの後段、**確定マッチ判定ロジック(Pass A+C・legacy Pass N)が「visit実績0件・firstVisitDate=null」という状態の候補を確定マッチにできない**という設計上のギャップにある。

### 3.5 external_key生成ロジックか
**無関係。** 両CSVとも会員番号(customerNumber)列が空欄の実運用データであり、`hash`は常に`null`。加えて`reservationImportPipeline.ts`は`externalKeyHash: null`を固定で渡しており、会員番号ハッシュを扱う仕組み自体が予約CSV側に存在しない。

### 3.6 再現条件
以下がすべて揃うと必ず重複が生じる:
1. 予約CSV取込で、その時点で同姓同名の既存顧客が0件 → 新規スタブ作成
2. スタブ作成時の予約ステータスが「会計済み」以外(受付待ち/キャンセル) → `firstVisitDate=null`のまま確定
3. 後日、売上明細CSV取込で同一人物の会計行が処理される
4. その時点でスタブの`brain_visits`が依然0件(=CSV取込までに他の経路で来店実績が記録されていない)
5. `needs_review`としてUIに表示された当該行に対し、運用者が個別に「統合」を選択しない(既定`'new'`のまま進める)

### 3.7 今後も発生する可能性があるか
**あり。構造的に発生し続ける。** 予約CSV取込が「visit実績なし・firstVisitDate null」のスタブを作ること自体は仕様通りの動作であり、かつ売上明細CSV側のPass A+C/legacy Pass Nはどちらも意図的にこの状態を「不確実」として弾く設計(誤統合防止のガード)になっている。したがって、運用者が確認画面で当該行を毎回正しく「統合」選択しない限り、**「予約→(会計済みでない状態)→後日の売上明細CSV」という順序で来店するすべての顧客**で同じ重複が起こり得る。人的運用に依存した回避策はあるが、コード上の自動防止策は現状存在しない。

---

## 4. 参考: 既存監査ドキュメントとの関係

`docs/CSV_IMPORT_DUPLICATE_ROOT_CAUSE_AUDIT_V1.md`(2026-07-20)で確認された「完全重複30件・表記揺れ24件」は、**売上明細CSV単体の再取込**によるカスケード増殖が主因だった。本調査で確認した小宮山仁美・佐々英之のケースは、**予約CSVと売上明細CSVという別パイプライン間**での重複であり、上記ドキュメント作成後に追加された Pass A+C(`resolveByVisitProximity`)実装によって「visit実績のある候補同士」の重複は相当程度改善されたとみられる一方、**「visit実績が1件も無いスタブ」を候補とするケースは、Pass A+Cの設計上そもそも救えない**という新たなギャップとして残っていることが今回判明した。

---

本調査ではコード変更・DB変更・commitのいずれも行っていない。
