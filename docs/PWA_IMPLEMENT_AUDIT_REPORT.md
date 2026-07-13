# PWA_IMPLEMENT_AUDIT_REPORT

**PHASE PWA-IMPLEMENT-AUDIT-1 — Riora OS スタッフアプリ PWA化 実装監査**
株式会社martylabo / Salon Riora
作成日: 2026-07-13
**本書は調査・計画のみ。コード変更・DB変更・migration・commit・pushは一切行っていない。**

正本: `docs/Riora_PWA化最終設計_v1.0.md`（2026-07-04作成）

---

## 0. 結論（先出し）

**予想より実装が進んでいた。** 「これから作る」段階ではなく、「manifest・アイコン・
Service Worker・apple系metaタグは既に手作業で相当量実装済みだが、正本の内容と
細部が食い違っている／インストール導線とスプラッシュ・設定ガイドが丸ごと未着手」
という状態。**全体の完成度は概算45%**。

さらに、**アイコン素材として指定された`IMG_0165.JPG`と視覚的に同一のロゴが、
既に`public/icon-192.png`等として使われている（もしくは酷似したものが使われている）**
ことを確認した。ゼロから作る作業ではなく「差し替え・整合」の作業になる可能性が高い。

---

## 1. PWA設計書の内容確認

`docs/Riora_PWA化最終設計_v1.0.md`（正本）の要点:

```
0. 前提: 凍結中のUIは変えない。PWAは配布・起動体験の追加のみ
1. manifest.json: start_url=/today、theme/background=#F8F1F3、
   icons(192/512/maskable版192/512)
2. インストール導線: Android=beforeinstallprompt捕捉、iOS=手順カード。
   2回目訪問+ログイン済み+today画面表示直後に1回だけ。[あとで]で7日抑制
3. オフライン: アプリシェルCache First、APIはNetwork First(鮮度優先・長期キャッシュ禁止)、
   オフライン時は「オフラインです」という優しい案内画面
4. アイコン/スプラッシュ: 「Salon Riora/SKINLABO」ロゴ使用。maskable版は
   中心80%safe zone+クリーム余白で別途生成必須。スプラッシュは「作成済み(完了)」と記載
5. 通知: v1はOSプッシュ不使用、アプリ内バッジのみ
6. iPhone/Androidインストール手順(スタッフ配布用文面)
7. 実装チェックリスト: PWA-1(manifest)〜PWA-7(Lighthouse監査+実機テスト)
8. リスク表(iOS内蔵ブラウザ制約・古いキャッシュ事故・通知過剰投資等)
```

---

## 2. 現在の実装状況確認

| 項目 | 状態 | 詳細 |
|---|---|---|
| **manifest有無** | ✅ 存在 | `public/manifest.json`（Next.jsの`metadata.manifest`経由で`<link rel="manifest">`を自動生成、`app/layout.tsx:10`） |
| **service worker有無** | ✅ 存在 | `public/sw.js`（手書き、Workbox等の生成物ではない）。`app/ClientShell.tsx:34-35`で`navigator.serviceWorker.register('/sw.js')`を実行済み |
| **next-pwa導入状況** | ❌ 未導入 | `package.json`に`next-pwa`/`workbox`系の依存は無し。Service Workerは完全手書き |
| **metadata設定状況** | 🟡 部分実装 | `app/layout.tsx`の`metadata`に`manifest`・`appleWebApp`(capable/statusBarStyle/title)・`icons.apple`は設定済み。`theme-color`は`viewport`側で設定（Next.js 15+の作法どおり）。ただし`<head>`内に手書きの`<meta name="apple-mobile-web-app-capable">`が重複している（`metadata.appleWebApp.capable`が既に同じタグを自動生成するため二重） |
| **apple-touch-icon設定状況** | ✅ 存在 | `public/apple-touch-icon.png`（180×180、正本が指定するサイズと一致）。`metadata.icons.apple`で参照済み |
| **splash設定状況** | ❌ 未実装 | `apple-touch-startup-image`等のPWA起動スプラッシュは**存在しない**。正本§4は「作成済み(完了)」と記載しているが、コード・`public/`配下のどこにもこれに該当する実装が見つからなかった（後述§4で詳述） |

### 2-1. 追加確認（正本のチェックリストPWA-1〜7を実データで照合）

| チェックリスト項目 | 状態 |
|---|---|
| PWA-1 manifest配置 | 🟡 配置済みだが内容が正本と不一致(§4) |
| PWA-2 アイコン一式 | 🟡 192/512/apple-touch-180は存在するが、**maskable専用の余白版は無い**(`manifest.json`が`icon-192.png`/`icon-512.png`をpurpose="any"と"maskable"の両方に使い回している) |
| PWA-2b スプラッシュ | ❌ 未実装(正本の「作成済み」記載と矛盾) |
| PWA-3 apple系metaタグ | 🟡 ほぼ実装済み(軽微な重複あり) |
| PWA-4 Service Worker | 🟡 実装済みだが簡易版(オフライン専用の案内ページが無い。キャッシュ戦略の骨格はほぼ正本どおり) |
| PWA-5 インストール導線 | ❌ 未実装(`beforeinstallprompt`の捕捉・iOS手順カード・7日抑制ロジックいずれも見つからず) |
| PWA-6 設定タブ常設ガイド | ❌ 未実装(「ホーム画面に追加する方法」という文言・UIはどこにも存在しない) |
| PWA-7 Lighthouse監査・実機テスト | 未実施(本フェーズは調査のみのため未検証) |

---

## 3. `IMG_0165.JPG`の確認

```
パス: C:\Users\user\Desktop\IMG_0165.JPG
形式: JPEG
解像度: 414×415px
PixelFormat: 24bpp RGB(アルファチャンネル無し=JPEG形式の仕様上、透過は不可能)
```

**内容**: 「Salon Riora / SKINLABO」ロゴ（細い筆記体+円+クリーム背景）そのもの。
正本§4が「使用ロゴ」として明記しているロゴと一致する。

| 確認項目 | 結果 |
|---|---|
| PWAアイコンとして利用可能か | ✅ 内容的に問題なし（ブランドロゴそのもの・クリーム背景込みで完結している） |
| 解像度 | 414×415px（1px差はエクスポート時の誤差程度・実質正方形） |
| 縦横比 | ほぼ1:1（414:415、誤差0.2%） |
| 透過の必要性 | **不要**。JPEG形式自体が透過非対応であり、正本もクリーム背景を残す前提（透過ではなく余白で対応する設計） |
| リサイズ要否 | **要**。512×512アイコン向けには414px→512pxへの**拡大**が必要（細い線・小さい文字のロゴのため、正本§4が警告する「小サイズで文字が潰れる」リスクと合わせて拡大時のにじみにも注意が必要）。192×192・180×180へは縮小のみで問題なし |
| フォーマット変換 | **要**。manifest.jsonの仕様上アイコンは`image/png`指定のため、JPG→PNGへの変換が必須（透過の有無に関わらず） |

### 3-1. 重要な発見: 同一ロゴが既に`public/`配下に存在

```
public/icons2/IMG_0165.JPG … デスクトップ版とMD5完全一致（既にコピー済み・未使用）
public/icon-192.png / apple-touch-icon.png … 目視で同一ロゴ（Salon Riora/SKINLABO）を確認
public/icons1/WNMV8676.PNG(1254×1254) … 同ロゴを使ったPWA設定手順の説明画像
  （実アイコンではなく「設定方法を示す解説図」。manifest.jsonの記載例も
   正本・現行manifest.jsonのいずれとも異なる第3のバリエーションが書かれている）
```

**つまり「これからIMG_0165.JPGをアイコンにする」のではなく、「既にこのロゴで
作られたアイコンが存在するが、正本の要件（maskable専用版・背景色統一）を
満たしていないので作り直す」という状況に近い。** ゼロから起こす作業ではないため、
実装時にこの前提を踏まえておくと工数が変わる（後述§7）。

---

## 4. 設計書との差分一覧

| 項目 | 正本(v1.0) | 現状 | 差分 |
|---|---|---|---|
| `start_url` | `/today?utm_source=pwa` | `/phase1` | **`/today`というルート自体がこのアプリに存在しない**（実際のTodayタブは`/phase1`）。現状の方が実態に即しており、正本側の記載が古い可能性 |
| `theme_color`/`background_color` | `#F8F1F3` | `theme_color:#F56E8B`／`background_color:#FFF8F7` | 不一致。現行の方はボトムナビ等で使われているピンク基調色(#F56E8B)に寄せてある模様。正本はクリームベージュ基調 |
| `id`フィールド | 記載なし | `"id": "/phase1"` | 現行のみに存在(Next.jsの慣例に沿った追加。害はない) |
| アイコン構成 | any用2枚+maskable専用2枚(計4枚、safe zone処理済み) | any/maskable兼用2枚のみ(計2枚、safe zone処理なし) | **maskable専用版が無い**。正本が最も強く警告した「★要注意」項目がそのまま未対応 |
| スプラッシュ画面 | 「作成済み(完了)」と明記 | 実装が見つからない | **正本の記載と実態が矛盾**。iOS用`apple-touch-startup-image`、Android向けの自動生成設定いずれも存在しない |
| インストール導線(PWA-5) | `beforeinstallprompt`捕捉+iOS手順カード+7日抑制 | 一切なし | 未着手 |
| 設定タブ常設ガイド(PWA-6) | 「ホーム画面に追加する方法」を常設 | 一切なし | 未着手 |
| オフライン案内画面 | 「オフラインです。電波の良い場所で〜」の優しい画面 | `sw.js`がキャッシュ済み`/phase1`を返すのみ、専用の案内画面は無し | 部分実装(仕組みはあるが、専用UIが無い) |
| apple-mobile-web-app-capable | 1箇所で十分 | `metadata.appleWebApp.capable`と手書き`<meta>`の2箇所で重複設定 | 軽微な冗長（動作に支障はないが整理の余地あり） |
| next-pwa導入 | 明記なし(手法は問わない書きぶり) | 未導入・完全手書きSW | 差分というより実装方針の選択。現状の手書き実装自体は正本の意図（過剰にしない）と矛盾しない |

---

## 5. 実装フェーズの細分化（正本PWA-1〜7を実装済み度に応じて再整理）

```
PWA-1  manifest整合          … 既存manifest.jsonの内容を正本に合わせて調整
                               (start_urlは/today→/phase1のまま採用を推奨。
                                theme/background色は要ユーザー確認・後述§6)
PWA-2  アイコン本番化         … IMG_0165.JPGから192/512/apple-touch-180を正式生成
                               (拡大時のにじみ確認込み)
PWA-2b maskable専用アイコン   … 中心80% safe zone+クリーム余白の専用版を新規生成
                               (正本が最も警告した未対応項目)
PWA-2c スプラッシュ画像        … 正本が「完了」と誤記していた実態を踏まえ、
                               iOS向けapple-touch-startup-image(端末サイズ網羅)を新規作成
PWA-3  apple系metaタグ整理     … 重複するapple-mobile-web-app-capableタグの整理のみ(軽微)
PWA-4  オフライン案内画面      … sw.jsのnavigateフォールバック先を、
                               既存の/phase1再送ではなく専用の優しい案内画面に変更
PWA-5  インストール導線        … beforeinstallprompt捕捉(Android)+iOS手順カード+
                               2回目訪問/ログイン済み/today表示直後の1回限定+
                               [あとで]7日抑制をゼロから実装(最大工数)
PWA-6  設定タブ常設ガイド      … 「ホーム画面に追加する方法」を設定タブ内に追加
PWA-7  Lighthouse監査+実機確認 … installable要件のパス確認、iPhone/Android実機でのホーム追加テスト
```

---

## 6. 現在の完成度・不足項目・実装順序・想定工数

### 現在の完成度

```
PWA-1 manifest配置             : 70%(配置済み・内容不一致あり)
PWA-2 アイコン(any用)          : 80%(素材・サイズとも実質完成、要フォーマット確認のみ)
PWA-2b maskable専用アイコン    : 0%
PWA-2c スプラッシュ            : 0%(正本の「完了」記載は誤り)
PWA-3 apple系metaタグ          : 90%(重複整理のみ残)
PWA-4 Service Worker基本      : 70%(仕組みはあるが専用オフライン画面が無い)
PWA-5 インストール導線         : 0%
PWA-6 設定タブ常設ガイド       : 0%
PWA-7 Lighthouse/実機確認      : 未実施(0%として計上)

単純平均: 約34%　/　実装済み項目の重み(manifest・アイコン・metaタグ・SWは
土台として比較的重い)を考慮した概算: 約45%
```

### 不足項目一覧

```
1. maskable専用アイコン(192/512、中心80% safe zone+クリーム余白) — 未着手
2. iOS向けスプラッシュ画像一式(iPhone SE〜Pro Max網羅) — 未着手(正本の記載と矛盾)
3. インストールプロンプト導線(Android beforeinstallprompt・iOS手順カード・
   表示条件制御・7日抑制ロジック) — 未着手
4. 設定タブ内「ホーム画面に追加する方法」常設ガイド — 未着手
5. オフライン時の専用案内画面(「オフラインです」) — 未着手
6. manifest.jsonのtheme_color/background_color/start_urlを
   正本 or 現状のどちらに揃えるかの意思決定 — 未決定(§4)
7. apple-mobile-web-app-capableタグの重複整理 — 軽微・未対応
8. Lighthouse PWA監査・iPhone/Android実機でのホーム画面追加テスト — 未実施
```

### 実装順序（推奨）

```
① PWA-1 manifest整合(内容確定後に着手。§6の意思決定が前提)
② PWA-2 アイコン本番化(IMG_0165.JPGからの正式生成)
③ PWA-2b maskable専用アイコン(②と同時に素材準備するのが効率的)
④ PWA-2c スプラッシュ画像
⑤ PWA-3 apple系metaタグ整理(軽微・いつでも可)
⑥ PWA-4 オフライン専用画面
⑦ PWA-6 設定タブ常設ガイド(⑤より前でも後でも独立して着手可)
⑧ PWA-5 インストール導線(最も工数が大きく、他の土台(manifest・アイコン)が
   固まってから着手するのが自然)
⑨ PWA-7 Lighthouse監査・実機確認(全て完了後の最終チェック)
```

### 想定工数

| フェーズ | 内容 | 工数目安 |
|---|---|---|
| PWA-1 | manifest内容の意思決定+反映 | S(数時間) |
| PWA-2 | IMG_0165.JPGから192/512/180生成+差し替え | S(半日未満、画像編集ツール要) |
| PWA-2b | maskable専用版(safe zone処理)生成 | S〜A(半日、safe zone比率の検証込み) |
| PWA-2c | スプラッシュ画像一式(端末サイズ網羅) | A(1日、複数解像度の書き出しが必要) |
| PWA-3 | metaタグ重複整理 | S(1時間未満) |
| PWA-4 | オフライン専用画面 | S〜A(半日、既存デザイン言語に合わせた1画面追加) |
| PWA-5 | インストール導線(Android/iOS両対応+抑制ロジック) | B(1〜2日、最大工数項目) |
| PWA-6 | 設定タブ常設ガイド | S(半日、既存の使い方ガイド画面と同じパターンで追加可能) |
| PWA-7 | Lighthouse監査+実機テスト(iPhone/Android) | S〜A(半日〜1日、実機確認の手間次第) |
| **合計目安** | | **B〜C(4〜6日)** |

---

## 7. まとめ

```
PWA化は「ゼロから始める」段階ではなく、manifest・Service Worker・apple系metaタグ・
アイコン(any用)は既に土台として実装済み(概算45%)。ただし正本が最重要視した
maskable専用アイコンとインストール導線、および正本が「完了」と誤記していた
スプラッシュ画像は、実態としてすべて未着手。

IMG_0165.JPGは内容的にPWAアイコンとして問題なく使えるロゴ画像だが、
・414×415pxのため512pxへは拡大が必要
・JPG→PNG変換が必須
・視覚的に酷似したロゴが既にpublic/icon-192.png等として使われている
  (同一ファイルのコピーもpublic/icons2/に既に存在)
という3点を踏まえ、「新規作成」ではなく「差し替え・正式化」という位置づけで
進めるのが実態に即している。

想定工数は合計4〜6日(B〜C)。最大の工数を要するのはインストール導線(PWA-5)で、
最初に着手すべきはmanifest.jsonの内容確定(正本と現状のどちらの色・start_urlに
揃えるかの意思決定)。

本フェーズでは調査・計画のみを行い、コード変更・commit・pushは一切行っていない。
```

*PWA_IMPLEMENT_AUDIT_REPORT — 「土台は既にあった。仕上げの4割が残っているだけだった」。調査・計画のみ・実装なし。*
