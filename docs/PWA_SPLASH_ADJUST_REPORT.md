# PWA_SPLASH_ADJUST_REPORT

**PHASE PWA-IMPLEMENT-2c — iOSスプラッシュ対応**
株式会社martylabo / Salon Riora
作成日: 2026-07-13
**実装まで実施。commit・pushは未実施（標準運用に合わせ保留。必要であれば指示してください）。**

---

## 0. 結論（先出し）

PWA-1(start_url修正)だけでは不十分だったことが、実機相当の検証で判明した。
**`app/ClientShell.tsx`の認証ガードがルート`/`にも適用されてしまい、
既存のスプラッシュ画面(`SplashScreen`)が意図した最短0.8秒を待たずに
150ms未満で吹き飛ばされる**という問題があった。1行の追加で解消し、
既存のスプラッシュ画面の見た目・ロジックには一切手を加えていない。

あわせて、既存の`/splash/splash-bg.png`から主要7機種分の
`apple-touch-startup-image`(iOSネイティブ起動画像)を生成し設定した。

---

## 1. 既存スプラッシュ画面をPWA起動時にも正しく表示させる

### 1-1. 発見した問題

前フェーズ(PWA-1)で`manifest.json`の`start_url`を`/phase1`→`/`に
変更したことで、ルート`/`（スプラッシュを表示する`app/page.tsx`）を
経由するようにはなった。しかし、実際に**画像が視認できる時間**を
計測したところ、意図された「最低0.8秒表示」が機能しておらず、
**150ms未満で`/login`へ強制的に切り替わってしまう**ことが分かった。

```
検証(Playwright, 150ms間隔でDOM状態をサンプリング):
t=0ms   url=/       splashImg=あり
t=150ms url=/login  splashImg=なし   ← この時点で既に消えている
```

### 1-2. 原因

`app/ClientShell.tsx`は、認証未確認の画面に対して
「①"読み込み中…"というプレーンな待機画面を出す」「②未ログインなら
`/login`へ強制リダイレクトする」という**独自のガード処理**を、
`PUBLIC_PATHS`に含まれないすべてのパスに対して適用する仕組みになっている。

```js
const PUBLIC_PATHS = [
  '/login',
  '/splash',   // ← 使われていない別ルート(前フェーズv2で発覚済み)
  '/test',
]
```

ルート`/`はこの`PUBLIC_PATHS`に**含まれていなかった**ため、
`app/page.tsx`(SplashScreen表示+0.8秒待機+自前のセッション確認+
リダイレクト)と、`ClientShell`(別系統のセッション確認+即リダイレクト)
という**2つの独立した認証チェック処理が同時に競合**していた。
ClientShell側の判定の方が早く完了するため、スプラッシュ画面が
自分の最低表示時間を守る前に、ClientShellが先に`/login`へ
強制的に移動させてしまっていた。

### 1-3. 対応（変更は1行のみ）

```diff
 const PUBLIC_PATHS = [
+  '/',
   '/login',
   '/splash',
   '/test',
 ]
```

ルート`/`を`PUBLIC_PATHS`に追加し、**ClientShell側の認証ガードを
ルート`/`には適用しないようにした。** ルート`/`は元々`app/page.tsx`
自身が完結したセッション確認・最低表示時間・リダイレクト処理を
持っているため、ClientShellの介入を止めるだけで正しく動作する。

**`app/page.tsx`・`SplashScreen`コンポーネント自体は一切変更していない**
（指示どおり、既存のスプラッシュ画面を尊重した最小限の変更）。

### 1-4. 修正後の検証結果

```
t=0ms    url=/       splashImg=あり
t=150ms  url=/       splashImg=あり
t=300ms  url=/       splashImg=あり
t=450ms  url=/       splashImg=あり
t=600ms  url=/       splashImg=あり
t=750ms  url=/       splashImg=あり
t=900ms  url=/login  splashImg=なし   ← 意図どおり約0.8秒表示してから遷移
```

設計どおりの最低表示時間(0.8秒)を守ってから`/login`へ遷移することを確認した。

### 1-5. 回帰確認

```
・/phase1(未ログイン)へ直接アクセス → 従来どおり/loginへリダイレクト(退行なし)
・/customers(未ログイン)へ直接アクセス → 従来どおり/loginへリダイレクト(退行なし)
・PUBLIC_PATHSの判定は "pathname === p || pathname.startsWith(p + '/')" のため、
  "/"追加によって他のパス(例: /phase1)が誤って公開扱いになることはない
  ("/".startsWith('/' + '/') は常にfalseのため副作用なし)
```

---

## 2. apple-touch-startup-imageの設定

### 2-1. 生成した画像

既存の`/splash/splash-bg.png`(784×1340、SplashScreenコンポーネントが
実際に表示している画像そのもの)を元に、主要なiPhone画面サイズ向けに
7枚を書き出した。

```
public/splash/apple-startup-750x1334.jpg   … iPhone SE(第2/3世代)/8
public/splash/apple-startup-1125x2436.jpg  … iPhone X/XS/11 Pro
public/splash/apple-startup-828x1792.jpg   … iPhone XR/11
public/splash/apple-startup-1170x2532.jpg  … iPhone 12/13/14
public/splash/apple-startup-1179x2556.jpg  … iPhone 14 Pro/15/16
public/splash/apple-startup-1284x2778.jpg  … iPhone 12/13/14 Pro Max
public/splash/apple-startup-1290x2796.jpg  … iPhone 14 Pro Max/15 Pro Max/16 Pro Max
```

元画像を各サイズへ`fit: cover, position: top`でリサイズ(SplashScreen
コンポーネント自身が`objectFit: cover, objectPosition: center top`で
表示しているのと同じ切り出し方なので、見た目の一貫性を保っている)。
また、透過が不要な全面塗り画像のためPNGではなくJPEG(quality 82)で
書き出し、1枚あたり43KB〜112KB程度に抑えた
(当初PNGで生成した際は1枚1.4MB〜3.7MBと重く、起動体感速度を
損ないかねなかったため、フォーマットを見直した)。

### 2-2. manifest/metadataへの反映

`app/layout.tsx`の`appleWebApp`に`startupImage`を追加し、
デバイスサイズごとの`media`条件と対応付けた。

```js
appleWebApp: {
  capable: true,
  statusBarStyle: 'black-translucent',
  title: 'Riora',
  startupImage: [
    { url: '/splash/apple-startup-750x1334.jpg', media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)' },
    { url: '/splash/apple-startup-1125x2436.jpg', media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)' },
    { url: '/splash/apple-startup-828x1792.jpg', media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)' },
    { url: '/splash/apple-startup-1170x2532.jpg', media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)' },
    { url: '/splash/apple-startup-1179x2556.jpg', media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)' },
    { url: '/splash/apple-startup-1284x2778.jpg', media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)' },
    { url: '/splash/apple-startup-1290x2796.jpg', media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)' },
  ],
},
```

Next.jsの`appleWebApp.startupImage`オプションが、指定した配列を
自動的に`<link rel="apple-touch-startup-image" media="...">`タグへ
変換することを確認済み（本番buildの実HTML出力で7件すべて確認）。

### 2-3. サイズ別画像が必要な理由と、今回カバーしていない範囲

Web標準の仕様上、`apple-touch-startup-image`は**画面サイズが完全一致
した場合のみ**適用される。iOS/iPadOSの全機種・全画面(縦横含む)を
網羅すると25種類以上の組み合わせが必要になる（一般的なPWA向け生成
ツールの実装からも確認済み）。

今回は以下の理由で、**主要7機種(縦向きのみ)に絞った実用的な範囲**とした。

```
・本アプリはmanifest.jsonで orientation: "portrait" 指定済み → 横向き対応は元々不要
・iPad等のタブレットは対象外(UIがmax-w-[430px]のスマホ専用設計のため)
・対象はスタッフが実際に使う端末であり、不特定多数への配布ではない
```

**一致する機種が無い場合(今回の7機種に含まれない新しいiPhoneなど)は、
iOSがmanifestの`background_color`(#FFF8F7)+アイコンから簡易的な
スプラッシュを自動生成する**（Apple/Safari標準の既定動作。前回の
PWA-3レポートで確認済みのフォールバック）。「起動時に何も表示されない」
という状態にはならないため、実害は限定的。

### 2-4. さらに機種を追加したい場合の手順（指示）

```
1. 対象機種のCSSピクセル寸法(device-width × device-height、論理px)と
   pixel ratioを調べる(Appleの公式仕様書または既知の一覧表を参照)
2. 実ピクセル = device-width × ratio, device-height × ratio を計算
3. 元画像 public/splash/splash-bg.png を sharp等で
   fit: 'cover', position: 'top' で当該サイズへリサイズしJPEG出力
   (本フェーズで使用したスクリプトと同じロジックを機種分だけ繰り返す)
4. app/layout.tsx の appleWebApp.startupImage 配列に
   { url, media: '(device-width: Wpx) and (device-height: Hpx) and (-webkit-device-pixel-ratio: R)' }
   を追加
```

---

## 3. iPhoneでのスプラッシュ表示確認手順（想定・実機用）

本フェーズの範囲外（実機操作）のため未実施。実施時の手順として提示する。

```
1. 本番URLをiPhoneのSafariで開き、「ホーム画面に追加」を実行
2. ホーム画面の「Riora」アイコンをタップして起動
3. 確認ポイント:
   a. アイコンタップ直後、白画面のみが一瞬映るか
      (apple-touch-startup-imageがロードされるまでの一瞬の遅延。
       今回の対応で解消しきれない、iOSの仕様上避けられない部分)
   b. その直後、/splash/splash-bg.pngベースの「リオくま」ブランド画像が
      画面いっぱいに表示されるか(このとき、使用しているiPhoneの機種が
      §2-1の7機種のいずれかに一致していれば、専用画像が出るはず)
   c. 約0.8秒程度、そのスプラッシュ画像が表示され続けるか
      (§1-4で確認した挙動がPWA実機でも同様に働くか)
   d. その後、ログイン画面(未ログイン時)またはphase1画面(ログイン済み時)
      へ自動的に切り替わるか
4. 期待結果: a〜dすべて満たすこと。特にb・cが今回の対応の本体
5. 補足確認: 使用機種が§2-1の7機種に含まれない場合は、bの代わりに
   クリーム色の背景+ロゴアイコンだけのシンプルな画面が一瞬映る
   (iOS標準のフォールバック。異常ではない)
```

---

## 4. 変更ファイル一覧

```
app/ClientShell.tsx          … PUBLIC_PATHSに'/'を追加(1行)
app/layout.tsx                … appleWebApp.startupImage を追加
public/splash/apple-startup-750x1334.jpg   (新規)
public/splash/apple-startup-1125x2436.jpg  (新規)
public/splash/apple-startup-828x1792.jpg   (新規)
public/splash/apple-startup-1170x2532.jpg  (新規)
public/splash/apple-startup-1179x2556.jpg  (新規)
public/splash/apple-startup-1284x2778.jpg  (新規)
public/splash/apple-startup-1290x2796.jpg  (新規)
```

`SplashScreen`コンポーネント(`src/components/SplashScreen/index.tsx`)・
`app/page.tsx`自体への変更は無い。

---

## 5. 検証

```
・npm run build → Compiled successfully・エラー0件
・本番相当ビルド(npm run start)を起動し、Playwrightで以下を確認:
   - ルート"/"アクセス時、スプラッシュ画像が約0.8秒表示されてから
     /loginへ遷移すること(修正前は150ms未満で消えていたことも記録)
   - /phase1・/customersへの未ログインアクセスは従来どおり/loginへ
     リダイレクトされ、退行が無いこと
   - 本番HTML出力でapple-touch-startup-imageタグが7件、意図した
     media条件つきで出力されていること
・生成した7枚のJPEGを目視確認(1枚を代表としてRead機能で表示)、
  画質・トリミング位置とも問題なし
```

---

## 6. まとめ

```
PWA-1(start_url修正)だけでは、ClientShell側の独自認証ガードが
ルート"/"にも及んでいたため、スプラッシュ画面が意図した0.8秒を
待たずに消えてしまう問題が残っていた。app/ClientShell.tsxの
PUBLIC_PATHSに'/'を1行追加するだけでこれを解消し、既存の
SplashScreenコンポーネント自体には一切手を加えていない。

あわせて、既存のsplash-bg.pngから主要7機種向けのapple-touch-startup-image
を生成し、Next.jsのappleWebApp.startupImage経由で設定した。全機種の
完全網羅(25種類以上)ではなく、スタッフの実利用を想定した実用的な
範囲に絞っており、対象外の機種はiOS標準のフォールバック(アイコン+
背景色の簡易スプラッシュ)で穏当に動作する。

変更ファイルはapp/ClientShell.tsx・app/layout.tsxの2箇所(小規模な差分)
と、public/splash/配下の新規画像7枚。commit・pushの可否が今回の指示に
明記されていないため、標準運用に合わせいずれも未実施のまま作業ツリーに
変更を残している。
```

*PWA_SPLASH_ADJUST_REPORT — 「start_urlを直しただけでは終わっていなかった。もう一つ、見えない競合が残っていた」。*
