# PWA_INSTALL_GUIDE_REPORT

**PHASE PWA-IMPLEMENT-5 — インストール導線（iPhone/Android対応）**
株式会社martylabo / Salon Riora
作成日: 2026-07-13
**実装まで実施。commit・pushは未実施（標準運用に合わせ保留。必要であれば指示してください）。**

根拠: `docs/Riora_PWA化最終設計_v1.0.md`「インストール導線」節
（2回目以降訪問・ログイン済み・today画面表示直後に1回だけ、[あとで]で7日間抑制、
3回無視で恒久非表示、押し売りしない）

---

## 0. 結論（先出し）

Today画面（`/phase1`）に、iPhone/Android両対応の控えめなインストール案内カードを
実装した。加えて、設定タブ（実体は`/menu`→使い方ガイド）に「ホーム画面に追加する方法」を
常設した。表示条件・抑制ロジックとも実機相当の検証（iOS Safari／Android Chrome／
LINEアプリ内ブラウザをUserAgentで再現）で確認済み。

---

## 1. 実装内容

### 1-1. Today画面の控えめな案内カード（新規）

`src/components/pwa/InstallPrompt.tsx`（新規ファイル）を作成し、
`src/components/phase1/Phase1Screen.tsx`のスクロール領域内、
`TodayBriefingCard`の直前に配置した。

```diff
  <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{...}}>
+   <InstallPrompt />
    <TodayBriefingCard onSelectCustomer={handleSelectFromBriefing} />
  </div>
```

設計書は「画面下部に控えめなバー」という配置を想定していたが、本アプリは
下部に`AppBottomNav`が固定表示されているため、**新たな固定バーを追加すると
既存のナビゲーションと視覚的に衝突する**と判断した。かわりに、Today画面の
コンテンツ内(通常のカードと同じ扱い)に、既存カードと同じ角丸・淡いピンクの
枠線・シャドウで馴染ませる形にした。押し売り感を避けるという設計意図は
保ったまま、既存レイアウトにより自然な形を採用している。

### 1-2. 表示条件（設計書どおり実装）

```
表示する条件(すべて満たす場合のみ):
 ・ログイン済み(useAuthStore の session が存在)
 ・Today画面への訪問が2回目以降(1回目では出さない)
 ・[あとで]の合計クリック回数が3回未満(3回で恒久非表示)
 ・[あとで]から7日間経過している(期間中は再表示しない)
 ・PWAとして既にインストール済み(standalone表示)でない
 ・iPhone(Safari)またはAndroid(Chrome)のみ(PC等では出さない)
 ・Androidは beforeinstallprompt を実際に捕捉できた場合のみ
   (捕捉できなければAndroidでは何も表示しない)

タイミング: 条件を満たしてから0.9秒待ってから表示(today画面が
落ち着いてから、接客の邪魔にならないように)
```

訪問回数はブラウザの`localStorage`に、抑制状態(あとで回数・抑制期限)も
同じく`localStorage`に保存する(端末単位で判定。ログアウト/再ログインでも
リセットされない)。

### 1-3. 表示内容（3パターン）

| 状況 | 表示内容 |
|---|---|
| iPhone(Safari、通常) | 「ホーム画面に追加できます」+「共有ボタン→ホーム画面に追加」の手順+[あとで] |
| iPhone(LINE等アプリ内ブラウザ) | 「この画面ではホーム画面に追加できません」+「Safariで開く」の案内+[あとで] |
| Android(Chrome、beforeinstallprompt捕捉時) | 「ホーム画面に追加しませんか？」+[追加する][あとで] |

Android の「追加する」をタップすると、保留しておいた`beforeinstallprompt`
イベントの`prompt()`を実行し、OS標準のインストールダイアログを表示する
(捕捉したイベントを「押し売りせず、任意のタイミングで出す」という
設計書の意図どおりの実装)。

### 1-4. 設定タブへの常設ガイド（追加）

現状「設定」タブ(`AppBottomNav`)の実体は`/menu`（メニュー管理ダッシュボード）
であり、その中の「使い方ガイド」(`/menu/guide`)が唯一の常設ヘルプ画面だった
(前フェーズの調査で確認済み)。新規に別画面を作るのではなく、**既存の
使い方ガイドに8番目のセクションとして追加**した。

```diff
  const sections: Section[] = [
    ...既存7セクション...
+   {
+     id: 8,
+     icon: Smartphone,
+     title: 'ホーム画面に追加する方法',
+     content: (iPhone手順 / Android手順 / アプリ内ブラウザの注意)
+   },
  ]
```

既存のアコーディオンUI(開閉・アニメーション・配色)をそのまま利用しており、
新しいコンポーネントやページを増やしていない。

---

## 2. 検証

本番相当ビルド(`npm run build` + `npm run start`)に対し、実際にログイン
(`admin@salon-riora.jp`)した上で、UserAgentを差し替えたPlaywrightの
複数ブラウザコンテキストで検証した。

```
[iOS Safari, 2回目訪問]        install card visible: true
[iOS Safari, あとで押下後]      dismissCount=1, dismissUntil設定あり, カード非表示: true
[iOS Safari, 1回目訪問]        カードが出ない(意図どおり): true
[iOS + LINEアプリ内ブラウザ]    「Safariで開く」案内が表示される: true
[Android Chrome, beforeinstallprompt捕捉時] 案内バー表示+「追加する」ボタンあり: true
[Android Chrome, beforeinstallprompt未発火] カードが出ない(意図どおり): true
[設定タブ→使い方ガイド]         「ホーム画面に追加する方法」セクション追加・開閉・
                                iPhone/Android両手順の表示を確認: true
```

`npm run build`もエラー0件で成功。

---

## 3. 変更ファイル

```
src/components/pwa/InstallPrompt.tsx   … 新規
src/components/phase1/Phase1Screen.tsx … InstallPromptのimport+配置(2行)
app/menu/guide/page.tsx                … セクション8追加(アイコンimport含む)
```

`AppBottomNav`・`SplashScreen`・`ClientShell`など、これまでのPWAフェーズで
触れたファイルにはさらなる変更を加えていない。

---

## 4. 今回あえて対応していない点

```
・完全なLighthouse PWA監査(installable要件の形式的なpass確認)は
  計画上PWA-7として別途予定しているため、今回は実施していない
・「3回無視で恒久非表示」は実装済みだが、実際に3回連続で発生させる
  長期間の実機シナリオでの確認は行っていない(ロジック自体は
  dismissCountの単純なインクリメント+閾値比較のため、コードレビュー上
  問題なしと判断)
```

---

## 5. まとめ

```
設計書の「押し売りしない」思想(初回非表示・2回目以降・[あとで]7日抑制・
3回で恒久非表示)を、iPhone/Android両方に対応する形で実装した。
配置は設計書の「下部バー」から、既存のAppBottomNavと衝突しない
「Today画面コンテンツ内のカード」へ、視覚的な自然さを優先して調整した。

設定タブ(実体は使い方ガイド)にも「ホーム画面に追加する方法」を
新セクションとして常設し、プロンプトを見逃した場合の代替導線を確保した。

変更ファイルは3件(新規1・既存編集2)。iOS/Android/LINEアプリ内ブラウザの
3パターンをUserAgent切り替えで実機相当検証済み。commit・pushの可否が
今回の指示に明記されていないため、標準運用に合わせいずれも未実施のまま
作業ツリーに変更を残している。
```

*PWA_INSTALL_GUIDE_REPORT — 「隣で1回、一緒に追加する。あとはアイコンをタップするだけ」を、押し付けがましくなく。*
