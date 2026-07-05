# NAS-FileManager

Raspberry Pi 5 上の NAS 用 Web ファイルマネージャ。npm workspaces のモノレポ:

- `apps/web` = `@nas-fm/web`（React + Vite）
- `apps/server` = `@nas-fm/server`（Hono、`0.0.0.0:8080` で listen）
- `packages/shared` = `@nas-fm/shared`（フロント/サーバ共有の型のみ）

詳しい API 設計・セキュリティ要件は `docs/spec.md`、開発フェーズの進行状況は `docs/roadmap.md` を参照。

## 開発

```bash
npm install
npm run dev          # web + server 同時起動
npm run typecheck
npm run test
npm run lint
npm run fmt
```

## Raspberry Pi への配置

### 1. ビルド・パッケージング(開発機側)

```bash
npm run package
```

`release/server.js`(単一バンドル)と `release/public/`(web の静的ビルド)が生成される。

### 2. Pi への転送

```bash
rsync -avz release/ pi-user@<PiのIP>:/opt/nas-fm/
```

### 3. Pi 側の準備(初回のみ)

権限を Samba と揃える(詳細は `docs/spec.md` §3):

```bash
sudo groupadd nas 2>/dev/null || true
sudo usermod -aG nas <あなたのユーザー名>
sudo chown -R <ユーザー名>:nas /srv/nas/share
sudo chmod 2775 /srv/nas/share   # setgid
```

本番パスワードのハッシュを生成:

```bash
npx tsx apps/server/scripts/hash-password.ts <本番パスワード>
```

### 4. systemd ユニットの登録

`deploy/nas-fm.service` を `/etc/systemd/system/nas-fm.service` にコピーし、`User=` / `AUTH_SECRET` / `AUTH_PASSWORD_HASH` を実際の値に書き換える(値は Git に含めない)。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nas-fm
sudo systemctl status nas-fm --no-pager
sudo journalctl -u nas-fm -f   # ログ確認
```

### 5. 動作確認

- `http://<PiのIP>:8080` にブラウザでアクセスしログイン
- Web 側でファイルを作成・編集後、`ls -l /srv/nas/share` でグループが `nas`・パーミッションが `-rw-rw-r--`(ディレクトリは `drwxrwsr-x`)になっているか確認し、Samba 経由でも同じファイルを編集・削除できることを確認する

詰まったときは `docs/spec.md` §9(トラブルシューティング)を参照。
