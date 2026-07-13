# PWA_IMPLEMENT_PLAN_v3

**PHASE PWA-IMPLEMENT-1 — start_url修正 実施報告 + 次の実装計画**
株式会社martylabo / Salon Riora
作成日: 2026-07-13
**実装まで実施。commit・pushは未実施（指示に明記が無かったため、標準運用に合わせ保留）。**

前版: `docs/PWA_IMPLEMENT_AUDIT_REPORT_v2.md`
今回対応: v2で発見した「PWA起動時にスプラッシュ画面を経由しない」問題の修正。

---

## 0. 結論（先出し）

`public/manifest.json`の`start_url`を`"/phase1"`→`"/"`へ変更した。
変更はこの1行のみ。build成功・実機相当の検証（本番buildを起動し
Playwrightでルート`/`へアクセス）でスプラッシュ→ログイン画面への
遷移を確認済み。他ファイルへの変更は無い。

---

## 1. 実施した変更

```diff
 {
   "name": "Riora",
   "short_name": "Riora",
   "description": "Salon Riora 接客サポート AI",
-  "start_url": "/phase1",
+  "start_url": "/",
   "id": "/phase1",
   "display": "standalone",
   ...
```

**変更ファイルは`public/manifest.json`の1行のみ。**

### 1-1. なぜこれだけで直るのか

ルート`/`（`app/page.tsx`）は元々スプラッシュ表示→セッション確認→
`/phase1`または`/login`への遷移ロジックをすでに持っていた（v2で確認済み）。
問題はPWA起動時の入口(`start_url`)がこのルートを迂回して`/phase1`へ
直接向いていたことだけだったため、**新規コードは不要で、start_urlを
本来の入口(`/`)に合わせるだけで解決する。**

### 1-2. `id`フィールドは変更していない

`id: "/phase1"`はそのまま残した。`id`はインストール済みPWAの同一性識別に
使われるフィールドで、`start_url`とは独立して機能する。今回の指示は
「start_urlの修正」かつ「変更は最小限に」だったため、機能上変更が
不要な`id`には手を加えていない。

---

## 2. 検証内容

### 2-1. build確認

```
npm run build
✓ Compiled successfully
（ルート一覧に / (Home) を含む全ルートが正常出力・エラー0件）
```

### 2-2. manifest.json配信内容の確認

本番相当ビルド(`npm run start`)を起動し、`curl http://localhost:3000/manifest.json`で
配信内容を直接確認。

```json
"start_url": "/",
"id": "/phase1",
```

意図通り反映されていることを確認。

### 2-3. ルート`/`の遷移フロー確認（Playwright、本番buildに対して実行）

```
アクセス: http://localhost:3000/
遷移トレース: / → / → /login → /login
最終URL: http://localhost:3000/login
画面内容: 「Salon Riora / GINZA SKIN LABO / スタッフ メールアドレス / パスワード / ログイン」
         （ログインフォームが正しく表示されている）
```

このビルドはDEMO_MODEが無効な本番相当ビルドのため、セッション無し→
`/login`へ遷移する経路を確認した形になる。**「ルート`/`→スプラッシュ→
適切な行き先」という一連の流れ自体が壊れていないことを実証した。**
（DEMO_MODE有効時に`/phase1`側に着地する経路は、v2までの調査で
`ClientShell.tsx`の`attemptDemoAutoSignIn`ロジックとして別途確認済みであり、
今回の`start_url`変更はこの分岐そのものには一切手を加えていない）

### 2-4. 他機能への影響確認

```
・grep確認: "start_url"という文字列を参照している箇所はmanifest.json以外に
  存在しない(前版調査で確認済み・今回変更前に再確認)
・sw.jsのキャッシュ対象リストは"/phase1"を含んだまま(変更していない)ため、
  Service Workerのキャッシュ戦略への影響は無い
・変更ファイルはpublic/manifest.jsonの1行のみ(git diffで確認済み)
```

---

## 3. PWAとしてホーム画面から起動した時の確認手順（想定・実機用）

以下は今回のフェーズ範囲外（実機でのホーム画面インストール操作）のため
**実施していない想定手順**として提示する。実際にiPhone/Androidで確認する際の
手順書として使用できる。

### 3-1. iPhone(Safari)での確認手順

```
1. 本番URL(Vercel上のURL)をSafariで開く
2. 共有ボタン→「ホーム画面に追加」を実行
3. ホーム画面に追加された「Riora」アイコンをタップして起動
4. 確認ポイント:
   a. 起動直後、白画面が一瞬映った後にスプラッシュ画像
      (/splash/splash-bg.png + ローディングドット)が表示されるか
   b. 数秒後、ログイン画面(未ログイン時)またはphase1画面(ログイン済み時)
      へ自動遷移するか
   c. ブラウザのアドレスバー等が表示されず、フルスクリーンの
      アプリらしい見た目になっているか(display: standalone の効果)
5. 期待結果: a〜cすべて満たすこと。a の「白画面が一瞬映る」こと自体は
   iOSのPWA起動の仕様上残る(apple-touch-startup-image未実装のため。
   v2で指摘済みの別課題)が、その後は正しくスプラッシュ画像が表示されること
```

### 3-2. Android(Chrome)での確認手順

```
1. 本番URLをChromeで開く
2. メニュー→「アプリをインストール」（もしくは自動表示されるインストールバナー）を実行
3. ホーム画面(またはアプリ一覧)に追加された「Riora」アイコンをタップして起動
4. 確認ポイント:
   a. Android標準のOS生成スプラッシュ(アイコン+background_color基調の
      起動画面)が一瞬表示された後、アプリ側のスプラッシュ画像に
      切り替わるか
   b. ログイン画面またはphase1画面へ正しく自動遷移するか
   c. スタンドアロン表示(URLバー無し)になっているか
5. 期待結果: a〜cすべて満たすこと
```

### 3-3. 両OS共通・回帰確認

```
・PWAとしてではなく通常のブラウザタブでルート"/"にアクセスした場合も
  従来通りスプラッシュ→ログイン/phase1へ遷移すること(退行していないか)
・キャッシュされた古いmanifest.jsonが端末に残っている場合、
  Service Workerの更新サイクル上、start_url変更が即座に反映されない
  可能性がある。実機確認時は一度PWAをホーム画面から削除→
  ブラウザのキャッシュ削除→再度「ホーム画面に追加」からやり直すこと
```

---

## 4. 次の実装計画（v2からの更新版）

v2で提示した実装順序のうち、①（start_url変更）が完了したため、
次点から着手する形に更新する。

```
✅ ① start_url変更(完了・本レポート)
→ ② PWA-1残り: manifest.jsonのtheme_color/background_color確定
     (正本#F8F1F3 vs 現状#F56E8B/#FFF8F7、どちらに揃えるかの意思決定が必要)
→ ③ PWA-2: アイコン本番化(IMG_0165.JPGからの正式生成)
→ ④ PWA-2b: maskable専用アイコン(中心80% safe zone+クリーム余白)
→ ⑤ PWA-2c: iOS向けapple-touch-startup-image一式
→ ⑥ PWA-3: apple-mobile-web-app-capableタグの重複整理(軽微)
→ ⑦ PWA-4: オフライン専用画面+splash-bg.pngのService Workerキャッシュ追加
→ ⑧ PWA-6: 設定タブ常設ガイド(「ホーム画面に追加する方法」)
→ ⑨ PWA-5: インストール導線(beforeinstallprompt捕捉+iOS手順カード+抑制ロジック、最大工数)
→ ⑩ PWA-7: Lighthouse監査+実機確認(§3の手順を含む最終チェック)
```

### 完成度(更新)

```
PWA-1 manifest配置: 75%(start_url解消・残るはtheme/background色確定のみ)
他項目はv2から変更なし
全体の完成度: 前版48%(重み付け概算) → 今回50%程度
```

---

## 5. まとめ

```
指示どおり、manifest.jsonのstart_urlを"/phase1"→"/"へ変更した。
変更はこの1行のみで、他ファイルには一切手を加えていない。

build成功・本番相当ビルドでのPlaywright検証により、ルート"/"への
アクセスがスプラッシュ経由で正しくログイン画面へ遷移することを確認した。
実機でのホーム画面インストール確認(§3)は本フェーズの範囲外のため
未実施だが、次回実施時の手順として提示した。

指示にcommit・pushの可否が明記されていなかったため、本フェーズの
標準運用(明示的な許可がある場合のみ実行)に合わせ、いずれも未実施のまま
作業ツリーに変更を残している。
```

*PWA_IMPLEMENT_PLAN_v3 — 「入口を1行直したら、既にあったスプラッシュがそのまま生きた」。*
