# Phase1 認証基盤分離 完成レポート

作成日: 2026-06-23

## 0. 事前調査での発見(実装前に確認済み・問題なしと判断して着手)

ユーザー指示に基づき、実装前に以下を調査した。いずれも「実装を停止すべき問題」ではなく「修正方針が明確な問題」と判断し、そのまま実装した。

1. **ロール名の不整合(`admin` vs `manager`)**: DB制約(`profiles.role CHECK (role IN ('owner','admin','staff'))`、15件以上のmigrationファイルで一貫)・`useDashboardStore.ts`の`UserRole`型は`'owner'|'admin'|'staff'`。一方`app/lib/roles.ts`の`INTERNAL_ADMIN_ROLES`のみ`'manager'`を使用し`'admin'`を含まないため、DB上`role='admin'`のユーザーが`isAdminRole()`でfalse判定される実害あるバグだった。→ DB制約に合わせて`admin`へ統一(§1)
2. **役割情報の重複管理サイトが3箇所存在**: `useStaffStore.userRole`・`useDashboardStore.userRole`(`setCurrentStaff`経由)はいずれも**setterが一度も呼ばれておらず実質デッドステート**であることをgrepで確認。`useCustomerStore`の`debug.role`は顧客一覧フィルタ用の局所的な値で、アプリ全体の認可に使われていない。→ 実害のある重複(同時に異なる値を持つ)は存在しないため、新規に追加する一元管理場所(`useAuthStore.role`)とは別に既存デッドステートを削除する作業は本タスクのスコープ外と判断し、残課題として記録(§5)
3. **`app/customers/page.tsx`に独自のDEMO_MODE依存ログインガードが別途存在**: ClientShellの認証ガードと並行する形で、このページ単体にも`if (DEMO_MODE) {...} else { supabase.auth.getSession()... }`という同種のチェックがあった。ClientShellのガードを常時有効化したことで本チェックは事実上冗長になったが、削除は「対象: app/ClientShell.tsx」の範囲外と判断し変更していない(残課題として記録)
4. **`PUBLIC_PATHS`内の各パスの実体確認**: `/test`(認証診断用Server Component。認証が壊れた時の復旧手段のため公開維持が必須)、`/splash`(静的画像のみ・Supabase依存なし)、`/phase1-debug`(完全オフラインのUI検証ページ)を実際に読み、分類の根拠とした(§3)

いずれも実装の妨げにはならないと判断し、そのまま実装に着手した。

## 1. ロール定義統一

### 1-1. 調査結果(修正前の全定義箇所)

| 定義箇所 | 値 | 用途 |
|---|---|---|
| DB: `profiles.role` CHECK制約(15+ migrationファイル) | `'owner' \| 'admin' \| 'staff'` | 正典 |
| `src/store/useDashboardStore.ts:37` `UserRole`型 | `'owner' \| 'admin' \| 'staff' \| null` | DBと一致 |
| `src/store/useAuthStore.ts` `inviteStaff`引数型 | `'staff' \| 'admin'` | DBと一致 |
| `app/lib/roles.ts` `INTERNAL_ADMIN_ROLES` | `["manager", "owner"]` | **DBに無い`manager`を使用(バグ)** |
| `src/store/useStaffStore.ts:10` `StaffRole`(ローカル型) | `'owner' \| 'admin' \| 'staff' \| null` | DBと一致するが未使用(§0-2) |

### 1-2. 修正内容

`app/lib/roles.ts`の`INTERNAL_ADMIN_ROLES`を`["manager", "owner"]` → `["admin", "owner"]`へ修正。`isAdminRole`/`getAppRole`関数本体(コメントで「変更不可」と明記された権限判定ロジック)は**変更せず**、データ(許可ロール値の配列)のみを修正した。

| 項目 | 修正前 | 修正後 |
|---|---|---|
| `INTERNAL_ADMIN_ROLES` | `["manager", "owner"]` | `["admin", "owner"]` |
| `InternalAuthRole`型 | `'manager' \| 'owner' \| 'staff'` | `'admin' \| 'owner' \| 'staff'` |
| `isAdminRole('admin')`の結果 | `false`(バグ) | `true`(修正) |

`getRoleDisplayName()`内の`'manager'`ケース(表示ラベル)は**UI文言のため変更していない**(禁止事項「UI変更禁止」を厳守)。DB制約上`role='manager'`という値は実在し得ないため、このケースは到達しないコードとして残るが、表示文言自体の変更は本タスクの範囲外と判断した。

## 2. 認証フロー分離

### 2-1. 調査結果(修正前)

`app/ClientShell.tsx`内に以下3つのDEMO_MODE依存箇所があった:
1. 自動サインインEffect: `if (!DEMO_MODE) return`(DEMO_MODE=false時は自動サインインが起動しない)
2. ログインリダイレクトEffect: `if (DEMO_MODE) return`(DEMO_MODE=true時はリダイレクト判定自体が無効)
3. ローディング画面表示条件: `if (!DEMO_MODE && !initialized && !isPublic)`

この設計では「DEMO_MODEのON/OFFで認証の挙動そのものが変わる」状態であり、ユーザー指示の「DEMO_MODEがON/OFFでも認証動作は同じ」を満たしていなかった。

### 2-2. 実装内容

**`src/store/useAuthStore.ts`(認証基盤)に移動・統合**:
- `DEMO_CREDENTIALS`定数を移動
- 新規関数`performDemoSignIn()`(モジュール内プライベート関数): DEMO_MODE時のみ`signInWithPassword`を実行。同時多発実行防止フラグは試行完了後に必ずリセットし、ログアウト後の再試行を可能にする
- `initialize()`を拡張: セッションが無く`DEMO_MODE`の場合、`performDemoSignIn()`の完了を**待ってから**`initialized: true`をセットするように変更。これにより「`initialized=true`だが自動サインインが未完了」という不安定な中間状態が発生しなくなる(後述§2-4のバグ修正)
- 新規メソッド`attemptDemoAutoSignIn()`: 初期化完了後にセッションが失われた場合(明示的なログアウト後等)に再度自動サインインを試みるための公開メソッド
- `role`状態(`profiles.role`)をログイン・初期化の両経路で取得し格納(§4)

**`app/ClientShell.tsx`**:
- `DEMO_MODE`のimportを完全に削除。本ファイルはDEMO_MODEを一切参照しない
- 自動サインインEffectは`useAuthStore.attemptDemoAutoSignIn()`を呼ぶだけに簡素化(DEMO_MODE判定はストア内に隠蔽)
- ログインリダイレクトEffectの`if (DEMO_MODE) return`を削除。**常時有効**化
- ローディング画面表示条件を`!initialized && !isPublic`に変更(DEMO_MODE判定を削除)

これにより「DEMO_MODEがON/OFFでも認証ガードの動作(未ログインなら/loginへ)は完全に同じ」になった。DEMO_MODEが変えるのは「自動サインインが起動するか否か」のみであり、これは`useAuthStore`内部に完全にカプセル化されている。

### 2-3. 実装中に発見・修正した競合状態(regression)

最初の実装(`attemptDemoAutoSignIn`をClientShell側のEffectとして`initialized`変化時に呼ぶだけの素朴な移植)では、**自動サインインの完了を待たずにログインリダイレクトEffectが先に発火し、`/phase1`に直接アクセスすると一瞬で`/login`へ飛ばされてしまう競合状態**が実機検証(Playwright)で発覚した。これは「ClientShellを単純にDEMO_MODE非依存にする」だけでは解決できない、設計上必然の問題だったため、自動サインインの初回試行を`initialize()`内部に完全に取り込み、`initialized`が立つ前に完了させる形に修正した(上記§2-2に反映済み)。

### 2-4. 認証フロー図

```
[アプリ起動]
   │
   ▼
ClientShell mount
   │
   ▼
useAuthStore.initialize()
   │
   ├─ supabase.auth.getSession() (4秒タイムアウト付き)
   │
   ├─ セッション無し かつ DEMO_MODE=true?
   │     │
   │     ├─ Yes → performDemoSignIn()
   │     │         (admin@salon-riora.jpで signInWithPassword、完了を待つ)
   │     │
   │     └─ No  → そのまま
   │
   ├─ session/user/role(profiles.role)をstateへ反映
   │
   └─ initialized: true ★ここまで完了してから次に進む(競合状態を排除)
   │
   ▼
ClientShellの各Effect再評価(initialized=true時点で同時に評価)
   │
   ├─ 自動サインインEffect: attemptDemoAutoSignIn()
   │     → session既にありなら即return(initialize()内で完了済みのため通常は何もしない)
   │     → ログアウト後にsessionが無くなった場合はここで再度自動サインインを試みる
   │
   └─ ログインリダイレクトEffect(DEMO_MODEを見ない・常時有効)
         → !session && !isPublic(PUBLIC_PATHS外) なら /login へ router.replace
```

## 3. PUBLIC_PATHS見直し

### 3-1. 調査結果と分類

| パス | 修正前 | 分類根拠 | 修正後 |
|---|---|---|---|
| `/login` | 公開 | ログイン画面自体 | 公開(変更なし) |
| `/splash` | 公開 | 静的画像のみ表示、Supabase/認証依存なし(`SplashIntroScreen.tsx`確認済み) | 公開(変更なし) |
| `/test` | 公開 | Server Component。「認証・Zustand・ClientShellを一切使わない」設計の接続診断ページ。**認証が壊れた場合の唯一の復旧手段**のため公開を維持する必要がある | 公開(変更なし) |
| `/phase1-debug` | 公開 | 「Supabase・認証・API通信を全て無効化」した完全オフラインUI検証ページ(`MOCK_CUSTOMER`等のダミーデータのみ使用)。本番で不特定多数に見せる必要は無い | **保護対象へ変更** |
| `/phase1` | 公開 | スタッフのメイン画面。実データ(予約・顧客)を表示 | **保護対象へ変更** |
| `/customers` | 公開 | 顧客一覧・詳細。実データ | **保護対象へ変更** |
| `/kpi` | 公開 | 店舗KPI。実データ | **保護対象へ変更** |
| `/line` | 公開 | LINE配信・チャット管理 | **保護対象へ変更** |
| `/menu` | 公開 | メニュー管理 | **保護対象へ変更** |
| `/ai-suggestions` | 公開 | AI提案画面 | **保護対象へ変更** |

### 3-2. 修正後のPUBLIC_PATHS

```ts
const PUBLIC_PATHS = [
  '/login',
  '/splash',
  '/test',
]
```

7パス(`/phase1-debug`,`/phase1`,`/customers`,`/kpi`,`/line`,`/menu`,`/ai-suggestions`)を保護対象に変更した。DEMO_MODE=true の現状では自動サインインによりセッションが確立されるため、実運用上の見た目は変わらない(実機検証で確認済み・§5)。

## 4. ロール情報の一元管理

`src/store/useAuthStore.ts`の`role: UserRole | null`を**唯一の管理場所**とした。

- 型は新規定義せず、既存の`useDashboardStore.ts`の`UserRole`(`'owner'|'admin'|'staff'|null`)を再利用(ロール定義統一の方針と整合)
- `initialize()`・`signIn()`の両方でログイン確定後に`profiles.role`を取得し格納
- `signOut()`で`null`にリセット
- `onAuthStateChange`リスナーでも追従(他タブでのログイン状態変化にも対応)

既存の未使用デッドステート(`useStaffStore.userRole`/`useDashboardStore.userRole`、§0-2)は削除していない(スコープ外。残課題§6に記録)。これらは現在どこからも書き込まれていないため、`useAuthStore.role`との「複数管理」競合は実害として発生しない。

## 5. テスト結果

### 5-1. 自動テスト
```
npm test       → 45 files / 442 tests 全成功
npm run typecheck → 既存無関係2件のみ(e2e/prod-verify.spec.ts, e2e/voice-memo-verify.spec.ts)
```

### 5-2. Playwright回帰確認(実機・実Supabase接続)

| 確認項目 | 結果 |
|---|---|
| `/phase1`直接アクセス(自動サインイン) | ✅ 競合状態なく一発で表示(§2-3のバグ修正後) |
| KPI画面 | ✅ `/kpi`アクセス可能 |
| 顧客詳細(一覧+詳細シート+音声メモセクション) | ✅ 30名の実データ表示・詳細シート展開・音声メモセクション含む全セクション表示確認 |
| LINE画面 | ✅ `/line`アクセス可能 |
| メニュー画面 | ✅ `/menu`アクセス可能 |
| 管理者画面 | ✅ `/admin/dashboard`アクセス可能(MD-1〜6の既存実装に影響なし) |
| ログアウト相当(セッション破棄)→再アクセス | ✅ 自動再ログインが機能し、保護画面に正常復帰 |
| デバッグパネル(`session`/`auth.uid`/`role`) | ✅ `role: owner`を含め正しく表示(centralized role取得の動作確認) |

ログイン・ログアウトの中核メソッド(`useAuthStore.signIn`/`signOut`)自体のロジックは変更していない(role取得処理を追加したのみ)ため、既存の動作(本セッション内の以前のPlaywright実機テストで確認済みの`admin@salon-riora.jp`での手動ログイン成功)に影響はない。DEMO_MODE下では自動サインインがログイン画面表示より先に完了するため、本タスクでは手動ログインフォームのUI操作テストではなく、実際にセッション・ロールが正しく確立されること(デバッグパネル表示)で検証した。

## 6. 残課題

1. **`app/customers/page.tsx`の独自DEMO_MODE依存ガードが冗長なまま残存**(§0-3)。ClientShellの常時ガードと機能が重複しており、削除すれば一貫性が上がるが「対象: app/ClientShell.tsx」のスコープ外のため未対応
2. **未使用のロール状態(`useStaffStore.userRole`/`useDashboardStore.userRole`)の削除は未実施**(§0-2、§4)。実害は無いが、将来誤って使われると「複数管理」が復活するリスクがある
3. **`src/components/LoginScreen/index.tsx` + `src/lib/auth.ts`(誰からもimportされない競合ログインUI)は今回も未削除**(以前の設計レビューで指摘済み)。本タスクのスコープ外のため対応していない
4. **管理者ダッシュボード(`/admin/*`)の認可は今回未対応**: ClientShellの常時ガードにより「ログイン必須」にはなったが、「owner/admin専用」のロールベース制限は追加していない(設計レビューのPhase 3相当・別タスク)
5. **本番DEMO_MODE=false化はまだ実施していない**: 本タスクは「DEMO_MODEのON/OFFで認証動作を同じにする」という分離のみが目的であり、実際にDEMO_MODEをfalseにする変更・環境変数化は行っていない(設計レビューのPhase 1範囲内・次の判断はユーザー側)

## 7. 修正ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `app/lib/roles.ts` | `INTERNAL_ADMIN_ROLES`を`manager`→`admin`に修正(ロール定義統一) |
| `src/store/useAuthStore.ts` | `role`状態の追加・一元管理、DEMO自動サインインの移植・競合状態修正、`attemptDemoAutoSignIn()`新設 |
| `app/ClientShell.tsx` | DEMO_MODE参照の完全削除、PUBLIC_PATHSの縮小、認証ガードの常時有効化 |

## 8. スクリーンショット

`docs/screenshots/`配下に保存。

| ファイル | 内容 |
|---|---|
| `AUTHSEP_01_phase1_after_autologin.png` | `/phase1`直接アクセス・自動サインイン後(競合状態修正後・正常表示) |
| `AUTHSEP_02_kpi.png` | KPI画面・保護ルートとして正常アクセス |
| `AUTHSEP_02_customers.png` | 顧客一覧・保護ルートとして正常アクセス |
| `AUTHSEP_02_line.png` | LINE画面・保護ルートとして正常アクセス |
| `AUTHSEP_02_menu.png` | メニュー画面・保護ルートとして正常アクセス |
| `AUTHSEP_02_admin_dashboard.png` | 管理者ダッシュボード・既存実装への影響なし |
| `AUTHSEP_03_voice_memo_section.png` | 顧客詳細BottomSheet全体(音声メモセクション含む)が正常表示 |
| `AUTHSEP_05_after_logout_and_autorelogin.png` | ログアウト相当操作後の自動再ログイン復帰 |
