# PWA_META_ADJUST_REPORT

**PHASE PWA-IMPLEMENT-3 — PWA-3 metaタグ整理（iPhone表示対応）**
株式会社martylabo / Salon Riora
作成日: 2026-07-13
**実装まで実施。commit・pushは未実施（標準運用に合わせ保留。必要であれば指示してください）。**

対象: apple-touch-icon / apple-mobile-web-app-capable /
apple-mobile-web-app-status-bar-style / theme-color / splash screen関連meta

---

## 0. 結論（先出し）

調査の過程で、当初「重複しているので削除すべき」と判断していた
`apple-mobile-web-app-capable`タグについて、**実際には削除すると
iPhoneでの動作に影響しうる、削除してはいけないタグだった**ことが
実機相当の検証で判明した。誤って一度削除したが、Next.js公式ドキュメントと
実際のHTML出力比較により根拠を確認したうえで復元し、コメントを添えて
残す方針に修正した。**最終的な差分は「説明コメント1つを追加」のみ**で、
挙動を変えるコード変更はしていない。

---

## 1. 調査の経緯（訂正あり）

### 1-1. 当初の誤認

`app/layout.tsx`の`<head>`内に手書きの
`<meta name="apple-mobile-web-app-capable" content="yes" />`があり、
かつ`metadata.appleWebApp.capable: true`という設定もあったため、
「同じ内容のタグが2つ生成されている重複」と判断し、一度削除した。

### 1-2. 実機相当の検証で判明した事実

削除後に本番相当ビルドで実際のHTML出力を確認したところ、
`apple-mobile-web-app-capable`というタグ自体が完全に0件になった。

これは、**Next.jsの`appleWebApp.capable: true`が生成するのは
`mobile-web-app-capable`(prefixなし)というタグのみで、
`apple-mobile-web-app-capable`(apple-prefix付き)は生成しない**ためだった
（Next.js公式ドキュメントの出力例で確認済み）。

```
appleWebApp.capable: true が生成するタグ:
  <meta name="mobile-web-app-capable" content="yes" />
  ※ apple-mobile-web-app-capable は生成されない
```

`apple-mobile-web-app-capable`はiOS Safariが「ホーム画面に追加した
アプリをブラウザUIなしのスタンドアロン表示にする」ために昔から
参照している専用タグで、Appleの現行ドキュメントでも引き続き必須とされている。
Next.jsの設定オプション名が"apple"を含むため紛らわしいが、**このタグを
出力する手段はメタデータAPI上に存在せず、手書きの`<meta>`タグだけが
唯一の供給源だった。** つまり最初から重複ではなく、これが無いと
iPhoneでホーム画面に追加した際にSafari UIがそのまま表示され続ける
(スタンドアロン表示にならない)リスクがあった。

### 1-3. 対応

削除した`<meta name="apple-mobile-web-app-capable" content="yes" />`を
復元し、なぜこの手書きタグが必要なのか(Next.jsの設定名と実際の生成内容の
ギャップ)を説明するコメントを付けた。

```diff
       <head>
+        {/* Next.jsのappleWebApp.capableはmobile-web-app-capableのみ生成し、
+            iOS Safariが依拠するapple-mobile-web-app-capableは生成しないため手動追加 */}
         <meta name="apple-mobile-web-app-capable" content="yes" />
         <link rel="preconnect" href="https://fonts.googleapis.com" />
```

**最終的な`app/layout.tsx`への変更はこのコメント追加のみ。動作に影響する
コード変更はしていない**（誤って削除→復元、という経緯を経て、結果的に
「説明を補って残す」が正解だったという結論）。

---

## 2. 対象5項目の最終確認結果

本番相当ビルド(`npm run build` + `npm run start`)を起動し、
実際に配信される`<head>`の内容をcurlで直接確認した。

```html
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="theme-color" content="#F56E8B"/>
<link rel="manifest" href="/manifest.json"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="Riora"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>
```

| # | 項目 | 状態 | 判定 |
|---|---|---|---|
| 1 | apple-touch-icon | `/apple-touch-icon.png`(180×180、前フェーズ以前から実装済み)を正しく参照 | ✅ 問題なし・変更不要 |
| 2 | apple-mobile-web-app-capable | 重複だと誤認して一度削除→実は必須タグと判明→復元(コメント付き) | ✅ 修正済み(復元) |
| 3 | apple-mobile-web-app-status-bar-style | `black-translucent`のまま。アプリ全体で`env(safe-area-inset-*)`を36ファイルで使用済みのため、ステータスバー透過を前提としたレイアウト対応は既にできている | ✅ 変更不要(現状のままで整合) |
| 4 | theme-colorとの整合性 | `<meta name="theme-color" content="#F56E8B">`（viewport設定由来）と`manifest.json`の`theme_color: "#F56E8B"`が完全一致 | ✅ 既に整合済み・変更不要 |
| 5 | splash screen関連meta | `apple-touch-startup-image`は未実装（未対応のまま） | ⚠️ 意図的に未対応(§3で詳述) |

---

## 3. splash screen関連meta（今回は意図的に未対応）

Next.jsには`metadata.appleWebApp.startupImage`という専用オプションがあり、
設定するだけで`<link rel="apple-touch-startup-image">`タグを自動生成できる
ことを確認した(Next.js公式ドキュメントで仕様確認済み)。

```js
// 実装する場合のイメージ(今回は未実装)
appleWebApp: {
  ...
  startupImage: [
    '/splash/apple-startup-XXXxYYY.png',
    { url: '/splash/apple-startup-XXXxYYY@2x.png', media: '(device-width: ...)' },
  ],
}
```

ただし、**この機能を活かすための画像アセット(端末サイズ別のPWA起動画像)は
まだ1枚も作成されていない。** 既存の`/splash/splash-bg.png`はアプリ内の
スプラッシュ画面(`SplashScreen`コンポーネント)専用に作られたもので、
iPhoneの各画面サイズ(SE/標準/Pro/Pro Max等)向けに最適化されたものではない。

今回のPWA-3は「既存metaタグの整合性整理」が目的であり、新規アセット作成を
伴う`apple-touch-startup-image`の本格実装は`docs/PWA_IMPLEMENT_PLAN_v3.md`
のPWA-2cとして別途スコープ済みのため、**今回は実装せず、Next.js側に
すぐ使える設定手段があることの確認のみに留めた。**

---

## 4. 変更ファイル

```
app/layout.tsx … 1箇所のみ(コメント追加。動作変更なし)
```

他のファイルへの変更は無い。`public/manifest.json`・アイコンファイル群は
前フェーズ(PWA-1/PWA-2)からの変更のまま、今回は触れていない。

---

## 5. iPhoneでの確認手順（実施想定・実機用）

以下は本フェーズの範囲外（実機操作）のため実施していない、確認用の手順書。

### 5-1. ホーム画面追加前（Safari通常表示）の確認

```
1. 本番URLをiPhoneのSafariで開く
2. アドレスバーの色(theme-color)がピンク系(#F56E8B)になっているか確認
3. タブ切り替え画面でもタブの色が同系統になっているか確認
```

### 5-2. ホーム画面に追加した直後の確認

```
1. 共有ボタン→「ホーム画面に追加」→追加
2. 追加時のプレビューで、アイコンがクリーム背景+Salon Rioraロゴに
   なっているか確認(PWA-2で生成した icon-192.png が反映される)
3. ホーム画面上のアイコン名が「Riora」になっているか確認
   (apple-mobile-web-app-title由来)
```

### 5-3. アプリ起動後の確認(最重要)

```
1. ホーム画面の「Riora」アイコンをタップして起動
2. 確認ポイント:
   a. Safariのアドレスバー・タブバー・下部ツールバーが一切表示されず、
      フルスクリーンのアプリらしい見た目になっているか
      (apple-mobile-web-app-capable が効いていれば標準表示、
       効いていなければ通常のSafariタブとして開いてしまう)
   b. ステータスバー(時刻・電波・バッテリー表示)がアプリのコンテンツに
      重なって、コンテンツの上端が隠れていないか
      (black-translucent設定により重なる仕様のため、アプリ側の
       safe-area-inset-top対応で上端が切れていないことを確認)
   c. スプラッシュ画像→ログイン画面という一連の流れが表示されるか
      (前フェーズのstart_url修正の効果を再確認)
3. 期待結果: a〜cすべて満たすこと。特にaが最重要
   (これが崩れていると、ユーザー体験上「ただのブックマーク」に見えてしまう)
```

### 5-4. 回帰確認

```
・通常のSafariタブ(ホーム画面追加なし)でアクセスした場合に、
  意図せずステータスバー表示や見た目が変わっていないか
・既存のiOS実機診断パネル(src/components/test/IPhoneDiagPanel.tsx)が
  存在する場合は、そちらでの動作確認も合わせて行うと良い
```

---

## 6. まとめ

```
apple-touch-icon・theme-color・apple-mobile-web-app-status-bar-styleは
いずれも既に正しく設定されており、変更不要と確認した。

apple-mobile-web-app-capableについては、「重複」という当初の見立てが
誤りであることが実機相当の検証で判明したため、削除→復元という経緯を経て、
最終的にはコメントを追加しただけの状態に落ち着いた(動作を変える
コード変更は無い)。

splash screen関連meta(apple-touch-startup-image)は、Next.js側に
すぐ使える設定手段(appleWebApp.startupImage)があることを確認したが、
対応する画像アセットが無いため今回は未実装とし、既存の実装計画どおり
PWA-2cとして別途対応する。

変更ファイルはapp/layout.tsxの1箇所(コメント追加のみ)。
commit・pushの可否が今回の指示に明記されていないため、標準運用に合わせ
いずれも未実施のまま作業ツリーに変更を残している。
```

*PWA_META_ADJUST_REPORT — 「重複だと思って消したら、実は消してはいけないタグだった」。*
