# PWA インストール可能化設計

## 背景・目的

ホーム画面に追加してアプリのように開けるようにしたい。ただし本アプリは仕様上 LAN 内の `http://<PiのIP>:8080` でのみ提供され、HTTPS 化の予定はない（`docs/spec.md` §8）。

ブラウザの「インストール」機能はセキュアコンテキスト（HTTPS、または `localhost`）が前提のため、この制約を踏まえてスコープを絞る。

- **Android / デスクトップ Chrome**: セキュアコンテキストが無いと `beforeinstallprompt` が発火せず、真の意味での「インストール」はできない。現状の LAN HTTP ではメニューからのショートカット作成止まりになる
- **iOS Safari**: Apple の公式ドキュメント上は HTTPS 必須とされているが、旧来の「ホーム画面に追加」機構が LAN HTTP でも standalone 起動する可能性があり、実機確認でしか判断できない
- **Service Worker**: セキュアコンテキストが無い環境では登録自体ができない。オフラインキャッシュ等の機能を持つ Service Worker を今回追加しても LAN HTTP 環境では動作しないため、**今回はスコープ外**とする

よって今回の対応は「今すぐ体験が変わる」ものではなく、**manifest とアイコンを整備しておき、将来 Tailscale 経由で HTTPS が入った時点で追加コード無しでインストール可能になる土台を作る**ことが主目的。加えて iOS の「ホーム画面に追加」は現状でもアイコン・アプリ名が正しく表示される効果はある。

## スコープ

- `manifest.webmanifest` + アイコン一式 + `index.html` の `<head>` タグ追加のみ
- 新規 npm 依存は追加しない（`vite-plugin-pwa` 等の Service Worker 生成ツールは使わない）
- Service Worker 自体を追加しない（オフラインキャッシュ、プッシュ通知は将来 HTTPS 化した後に別途検討）

## 実装内容

### 1. manifest（`apps/web/public/manifest.webmanifest`）

```json
{
  "name": "NAS-FileManager",
  "short_name": "NAS-FM",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

`start_url` / `scope` は絶対 URL にしない（LAN IP や将来の Tailscale ホスト名など、アクセス元が変わっても機能するように）。

### 2. アイコン生成

既存ロゴが無いため新規デザインする。NAS（サーバ/ハードドライブ）をモチーフにした単色グリフを 512×512 の viewBox で SVG として作成し、`sharp`（`apps/server` に既存の依存を一時スクリプトから利用。web 側には依存追加しない）でラスタライズする。

- `icon-192.png` / `icon-512.png`: グリフをキャンバスいっぱいに配置
- `icon-maskable-512.png`: Android の丸マスク対策で内側 80%（安全領域）にグリフを収め、背景色で全面塗りつぶし
- `apple-touch-icon.png`（180×180）: 不透明・透過なし・角丸なし（iOS 側で自動マスクされるため）

配色はアプリのニュートラルなテーマ（`index.css` の `--background` / `--primary` 相当）に合わせる。

### 3. `index.html` への追加

- `<link rel="manifest" href="/manifest.webmanifest">`
- `<meta name="theme-color" content="#ffffff">`（1本のみ。`next-themes` の `ThemeProvider` は未配線で `.dark` クラスが付与されることが無く、実際には常にライト表示のため、ダーク用の出し分けは今は付けない。ダークモード配線時に追加すればよい）
- `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="default">`
- `<meta name="apple-mobile-web-app-title" content="NAS-FM">`

### 4. 動作確認

- dev（`npm run dev:web`）と本番ビルド両方で `manifest.webmanifest` が `application/manifest+json` として配信されることを確認（Hono の mime テーブルに `webmanifest` は登録済みのためリネーム不要と確認済み）
- `npm run package`（`scripts/package-release.mjs`）実行後、`release/public/` にアイコン一式・manifest が含まれることを確認（`apps/web/dist` を丸ごと `release/public/` にコピーする既存の仕組みに乗るだけなので追加対応は不要のはず）
- 実機確認: ビルド後、iPhone Safari で LAN 経由アクセスし「ホーム画面に追加」→ standalone 起動するか（Safari の UI が消えるか）を確認する。この結果次第で roadmap の記載を「対応済み」か「manifest整備済み・要HTTPS」にする

### 5. ドキュメント更新

`docs/roadmap.md` は spec.md 由来の Phase 1〜5 のみを追跡しており、spec.md 範囲外で後から追加された機能（search / trash / bulk-selection / upload-queue-tray 等）はいずれも roadmap.md に追記されていない（実績確認済み）。本機能も同様の扱いとし、roadmap.md は更新しない。本設計docとコミット履歴が記録として機能する。iOS 実機確認が未了の場合はコミットメッセージや PR 上で「対応完了」と書かず、確認待ちである旨を明記する。

## テスト方針

静的アセット（JSON/PNG/HTML head タグ）のみの変更で、既存の自動テスト（Vitest）で検証すべきロジックは無い。目視・`curl` でのヘッダ確認・実機での「ホーム画面に追加」動作確認を verification とする。
