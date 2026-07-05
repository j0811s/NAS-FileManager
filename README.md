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

`npm run package`(`release/server.js` + `release/public/` を生成)を実行してから、`deploy/deploy.env` の設定に従って `rsync` で転送する(`scripts/deploy.sh`)。

### 3. Pi 側の準備(初回のみ)

権限を Samba と揃える(詳細は `docs/spec.md` §3):

```bash
sudo groupadd nas 2>/dev/null || true
sudo usermod -aG nas <あなたのユーザー名>
sudo chown -R <ユーザー名>:nas /srv/nas/share
sudo chmod 2775 /srv/nas/share   # setgid
```

### 4. systemd ユニットの登録(初回のみ)

`deploy/nas-fm.service` を転送し、Pi 側で配置する。`release/` の再デプロイ(`npm run deploy`)とは別に、初回セットアップ時のみ行う。

> **以下のコマンドはすべて開発機(Mac)側、プロジェクトルートのターミナルで実行する。**
> Pi に ssh ログインした状態のシェルに貼り付けない(`hash-password.ts` はリポジトリ内のファイルなので Pi 上には無く、`ERR_MODULE_NOT_FOUND` になる)。`ssh pi-user@<PiのIP> '...'` の行はコマンドの一部であり、事前に別途ログインする必要はない。

```bash
scp deploy/nas-fm.service pi-user@<PiのIP>:/tmp/

ssh pi-user@<PiのIP> '
  sudo mv /tmp/nas-fm.service /etc/systemd/system/nas-fm.service &&
  sudo sed -i "s/<あなたのユーザー名>/pi-user/" /etc/systemd/system/nas-fm.service &&
  sudo systemctl daemon-reload
'
```

`AUTH_SECRET`(ランダムな長い文字列)と本番パスワードのハッシュを生成し、`nas-fm.env` を作成(開発機側から1回のsshで):

```bash
AUTH_SECRET=$(openssl rand -base64 48)
AUTH_PASSWORD_HASH=$(npx tsx apps/server/scripts/hash-password.ts <本番パスワード>)

ssh pi-user@<PiのIP> "sudo tee /opt/nas-fm/nas-fm.env > /dev/null" <<EOF
AUTH_SECRET=${AUTH_SECRET}
AUTH_PASSWORD_HASH=${AUTH_PASSWORD_HASH}
EOF

ssh pi-user@<PiのIP> "sudo chown \$(whoami):nas /opt/nas-fm/nas-fm.env && sudo chmod 600 /opt/nas-fm/nas-fm.env"
```

最後にサービスを起動:

```bash
ssh pi-user@<PiのIP>
sudo systemctl enable --now nas-fm
sudo systemctl status nas-fm --no-pager
sudo journalctl -u nas-fm -f   # ログ確認
```

### 5. 動作確認

- `http://<PiのIP>:8080` にブラウザでアクセスしログイン
- Web 側でファイルを作成・編集後、`ls -l /srv/nas/share` でグループが `nas`・パーミッションが `-rw-rw-r--`(ディレクトリは `drwxrwsr-x`)になっているか確認し、Samba 経由でも同じファイルを編集・削除できることを確認する

詰まったときは `docs/spec.md` §9(トラブルシューティング)を参照。

## 更新のデプロイ(2回目以降)

初回セットアップ(上記1〜4)が済んでいれば、コード変更後の反映は以下の2コマンドのみでよい。

```bash
npm run deploy
ssh pi-user@<PiのIP> "sudo systemctl restart nas-fm"
```

`rsync` はファイルを置き換えるだけでプロセスは再起動しないため、**`systemctl restart` を忘れると新しいコードが反映されない**点に注意する。
