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

### 1. 転送先の設定(初回のみ)

`deploy/deploy.env.example` を `deploy/deploy.env` としてコピーし、`PI_HOST` / `PI_USER` / `PI_PATH` を実際の値に書き換える(このファイルは Git に含めない)。

### 2. ビルド・パッケージング・転送(開発機側)

```bash
npm run deploy
```

`npm run package`(`release/server.js` + `release/public/` を生成)を実行してから、`deploy/deploy.env` の設定に従って `rsync` で転送する(`scripts/deploy.sh`)。2回目以降の再デプロイもこのコマンド一つでよい。

### 3. Pi 側の準備(初回のみ)

権限を Samba と揃える(詳細は `docs/spec.md` §3):

```bash
sudo groupadd nas 2>/dev/null || true
sudo usermod -aG nas <あなたのユーザー名>
sudo chown -R <ユーザー名>:nas /srv/nas/share
sudo chmod 2775 /srv/nas/share   # setgid
```

`AUTH_SECRET`(ランダムな長い文字列)を生成:

```bash
openssl rand -base64 48
```

本番パスワードのハッシュを生成:

```bash
npx tsx apps/server/scripts/hash-password.ts <本番パスワード>
```

### 4. systemd ユニットの登録(初回のみ)

`deploy/nas-fm.service` と `deploy/nas-fm.env.example` を転送し、Pi 側で配置する。`release/` の再デプロイ(`npm run deploy`)とは別に、初回セットアップ時のみ行う(`nas-fm.env` は後で実際の秘密値に書き換えるため、以降の再デプロイで誤って上書きしないよう `scripts/deploy.sh` の対象には含めていない)。

```bash
# 1. 転送(開発機側)
scp deploy/nas-fm.service deploy/nas-fm.env.example pi-user@<PiのIP>:/tmp/

# 2. 配置・権限・reload をまとめて実行(開発機側から1回のsshで)
ssh pi-user@<PiのIP> '
  sudo mv /tmp/nas-fm.service /etc/systemd/system/nas-fm.service &&
  sudo mv /tmp/nas-fm.env.example /opt/nas-fm/nas-fm.env &&
  sudo chown $(whoami):nas /opt/nas-fm/nas-fm.env &&
  sudo chmod 600 /opt/nas-fm/nas-fm.env &&
  sudo systemctl daemon-reload
'
```

秘密値の編集だけは手動でログインして行う:

```bash
ssh pi-user@<PiのIP>
sudo nano /etc/systemd/system/nas-fm.service   # User= を書き換え
sudo nano /opt/nas-fm/nas-fm.env               # AUTH_SECRET/AUTH_PASSWORD_HASH を書き換え
sudo systemctl enable --now nas-fm
sudo systemctl status nas-fm --no-pager
sudo journalctl -u nas-fm -f   # ログ確認
```

### 5. 動作確認

- `http://<PiのIP>:8080` にブラウザでアクセスしログイン
- Web 側でファイルを作成・編集後、`ls -l /srv/nas/share` でグループが `nas`・パーミッションが `-rw-rw-r--`(ディレクトリは `drwxrwsr-x`)になっているか確認し、Samba 経由でも同じファイルを編集・削除できることを確認する

詰まったときは `docs/spec.md` §9(トラブルシューティング)を参照。
