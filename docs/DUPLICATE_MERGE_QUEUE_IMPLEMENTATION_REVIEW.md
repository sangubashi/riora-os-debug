# Duplicate Merge Queue 実装レビュー

**ステータス: レビューのみ・コード変更禁止・commit禁止・push禁止・deploy禁止**
**作成日: 2026-07-20**
**対象**: 前セッションで実装した顧客統合(Duplicate Merge Queue)一式(UI・API・rollback API、いずれも未commit)

---

## 0. 結論の先出し

```
実装コードを精読した結果、当初想定していなかった重大な欠落を1件発見した:
execute APIはbrain_visits/brain_customersのみ更新し、CUSTOMER_DUPLICATE_MANAGEMENT_
V1.mdが要求していたlegacy空間テーブル(contraindications/voice_notes/customer_memories/
customer_notes)・reservations.brain_customer_id・timeline_summary_cacheの移行/
無効化を一切行っていない。禁忌情報が統合後に到達不能になりうるため、この状態での
本番実行は推奨しない。

UI側にも重大な不備がある: 区分C(統合禁止)のグループでも実行ボタンが機能してしまう
(ラベルだけで実際のブロックが無い)。また、rollback APIは実装済みだがUIから
呼び出す手段が存在せず、統合完了後の結果(opsLogId)も画面に表示されない。

同時実行に対するロック機構は無く、TOCTOU(check-then-act)の競合ウィンドウが
execute・rollbackとも存在する。ただしrollback自体の「統合後に新規visitが
追加されていないか」の安全確認は正しく実装されており、通常操作では機能する。

監査ログ(brain_ops_logs)は、execute APIが実際に変更する範囲(brain_visits+
brain_customers)に対しては100%のrollback可能性を持つ。ただし上記の欠落
(legacy空間テーブル等)を今後実装で埋める場合、監査ログにもその変更履歴を
追加しないとrollbackが不完全になる。
```

---

## 1. 本番データ破壊リスク

### 🔴 重大: legacy空間テーブル・関連テーブルの移行が未実装

`app/api/admin/customer-merge/execute/route.ts`を精読した結果、実際に書き込むのは以下の2テーブルのみだった:

- `brain_visits`(`customer_id`付け替え・`visit_count_at`再採番)
- `brain_customers`(生き残り側`first_visit_date`更新・統合元`deleted_at`設定)

`docs/CUSTOMER_DUPLICATE_MANAGEMENT_V1.md` §5〜§9が要求していた以下は未実装:

| テーブル | 未実装の影響 |
|---|---|
| `contraindications`(legacy customers.id空間) | 統合元が論理削除されるため、`deleted_at IS NULL`でフィルタする画面からは禁忌情報が到達不能になる可能性がある。安全上最も重大 |
| `voice_notes`・`customer_memories`・`customer_notes` | 同様にlegacy空間の紐付けが残ったまま統合元が消えるため、AI Timeline等で表示されなくなる可能性 |
| `reservations.brain_customer_id` | 統合元に未来予約が紐づいていた場合、生き残り側から見えないまま孤立する |
| `timeline_summary_cache` | 統合後もキャッシュが再生成されず、古いAI要約が残り続ける |

`docs/DUPLICATE_MERGE_SAFETY_VALIDATION.md`のシミュレーションはLTV・visit_count_at・離脱予兆・ホームケア通知のみを検証対象としており、この欠落は検証で検出されていなかった(検証スコープ自体がbrain_visits/brain_customersに限定されていたため)。

### 🟡 中: UPDATE操作の影響行数を検証していない

`execute`・`rollback`とも`.update(...).eq('id', x)`の戻り値(`error`)のみで成否判定しており、対象行が0件だった場合も「成功」と扱われる可能性がある。特にrollbackの「統合元のdeleted_at解除」で、対象が既に想定外の状態(手動で復元済み等)だった場合に気づけない。

### 🟢 低: first_visit_date補正・空visitケースは安全側に倒れる

`simulateMerge()`はグループ全体でvisitが0件のケースでも`firstVisitDateBefore`にフォールバックし、既存値を誤ってnullにする経路は存在しないことを確認した。

---

## 2. 同時操作リスク

| シナリオ | 分析 | 対策の有無 |
|---|---|---|
| 管理者A・Bが同時に統合実行 | advisory lock・楽観的並行性制御が無い。同一グループを異なる統合先で同時実行すると、後勝ちのUPDATEが前の結果を上書きし`visit_count_at`が欠番・重複しうる | **対策なし**。運用ルールで防ぐ必要がある(チェックリスト参照) |
| rollback中に新規visitが入る | 事前安全確認(統合先の現在visit数と監査ログ件数の比較)で`rollback_unsafe`(409)を返す設計が実装済み | **対策あり**(ただし確認クエリと実UPDATEの間に短い競合ウィンドウは残る) |
| 二重実行(連打・リトライ) | 1回目成功後、2回目は対象が`deleted_at != null`のため`customer_already_deleted`(409)で通常はブロックされる。UIも`isExecuting`中はボタンをdisable | **概ね対策あり**(真に同時のダブルサブミットには非対応) |

---

## 3. 監査ログ完全性

`brain_ops_logs`(`kind='customer_merge'`)の`CustomerMergeAuditDetail`(4項目: `mergeGroupId`・`sourceCustomerIds`・`targetCustomerId`・`visitReassignments[]`・`firstVisitDateBefore/After`等)は、**execute APIが実際に変更する範囲(brain_visits・brain_customers.first_visit_date・brain_customers.deleted_at)に対しては100%のrollbackを実装レベルで保証できる**(ロジックは`DUPLICATE_MERGE_SAFETY_VALIDATION.md`で実データ検証済み)。

ただしこの「100%」は§1で指摘した狭い実装スコープに対してのみ成立する。将来legacy空間テーブルの移行を追加する場合、監査ログのスキーマ自体を拡張し、それらの変更履歴も記録しないとrollbackが不完全になる。

---

## 4. UIレビュー

### 誤操作しやすい箇所(重大度順)

1. **🔴 区分C(統合禁止)でも実行できる**: `CustomerMergeScreen.tsx`のバッジ表示・`MergeGroupDetailModal.tsx`の実行ボタンともに`category`を判定に使っておらず、`survivorId`が選択されてさえいれば区分に関わらず実行可能。「統合禁止」ラベルは装飾のみで実効性が無い
2. **rollback UIが存在しない**: APIは実装済みだが、画面上に呼び出しボタンが無い。Phase4は「Rollback実装」と指示されたが、UI導線が欠落している
3. **統合完了後の結果が画面に表示されない**: `lastExecuteResult`(`opsLogId`含む)はstoreに保持されるが、どの画面からも参照されていない。rollbackに必須の`opsLogId`を管理者が確認する手段が事実上無い
4. **実行中でもモーダルを閉じられる**: `isExecuting`中でも背景クリック・×ボタンでモーダルが閉じ、成功/失敗の結果を見逃しうる
5. **最終確認ステップの文言が汎用的**: 生き残り・削除対象の氏名/IDを確認ステップで再掲していない

### 改善案

- 区分Cはボタンをdisableするか、詳細画面自体を「統合不可」表示に切り替える
- 統合完了直後の成功表示にrollbackボタンを併設し、そのopsLogIdをそのまま渡せる導線にする
- 統合完了後、`opsLogId`を含む結果バナーをコピー可能な形で一定時間表示する
- `isExecuting`中は背景クリック・×ボタンを無効化する
- 確認ステップに「統合先: ○○様 / 削除対象: △△様・□□様(N件)」を明示する

---

## まとめ

1. 最重要所見: legacy空間テーブル(禁忌情報含む)・予約・タイムラインキャッシュの移行が未実装。本番実行前に必ず対応が必要
2. UI側の区分Cブロック漏れも本番実行前に必ず修正が必要
3. 同時実行ロックは無いため、コード対応または運用ルールでの防止が必要
4. 監査ログは現状の実装スコープに対しては完全だが、スコープ拡張時は監査ログも合わせて拡張する必要がある
5. rollback UIの欠落・結果表示の欠落はユーザビリティ上の重大な障害となるため実装を推奨する

詳細な実行前チェックリストは`docs/CUSTOMER_MERGE_PRODUCTION_CHECKLIST.md`を参照。

本レビューではコード変更・commit・push・deployのいずれも行っていません。
