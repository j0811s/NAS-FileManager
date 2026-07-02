# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Raspberry Pi 5 上の NAS 用 Web ファイルマネージャ。npm workspaces のモノレポ:

- `apps/web` = `@nas-fm/web`（React + Vite）
- `apps/server` = `@nas-fm/server`（Hono、`0.0.0.0:8080` で listen）
- `packages/shared` = `@nas-fm/shared`（フロント/サーバ共有の型のみ）

プロダクト仕様は `docs/spec.md` を参照（API 設計・セキュリティ必須事項・デプロイ・プレビュー機能など。機能実装の前に該当セクションを読むこと）。TypeScript 制約と features 構成のルールは `.claude/rules/`（typescript.md / features.md）にあり、該当パスのファイルを扱うとき自動で読み込まれる。

## コマンド

ルートに集約済み。個別ワークスペースは `-w` で指定する。

```bash
npm run dev          # web + server 同時起動（concurrently）
npm run dev:web      # Vite dev サーバのみ
npm run dev:server   # Hono（tsx watch）のみ
npm run build        # 全ワークスペース（--workspaces --if-present）
npm run typecheck    # 全ワークスペースの tsc --noEmit
npm run test         # 全ワークスペース（web の Vitest）
npm run lint         # oxlint（lint:fix で自動修正）
npm run fmt          # oxfmt（fmt:check でチェックのみ）
npm run test -w @nas-fm/web   # 個別実行の例
```

## 依存追加のポリシー

`.npmrc` で `save-exact` / `min-release-age=3` / `engine-strict` を強制。

- 新規依存は**バージョン無指定**の `npm install <pkg> -w <workspace>` で追加する（npm が exact 固定かつ公開3日以上の版を選ぶ）。手書きで `^`/`~` を付けない
- Node は **24.16.0** 固定（`.nvmrc` / `.node-version` / 全 package.json の `engines`。更新時は4ファイルすべて揃える）

## ツール

- フォーマッタ/リンタは **oxfmt / oxlint**（Prettier / ESLint ではない。設定は `.oxfmtrc.json` / `.oxlintrc.json`）
- pre-commit は husky + lint-staged（oxfmt → oxlint --fix → typecheck が自動で走る）

## リポジトリ運用

- ブランチ: main 直接（ソロ開発）
- コミット: Conventional Commits（接頭辞は英語、本文は日本語。例: `feat: ファイル一覧APIを追加`）
  - 接頭辞: `feat`（機能追加）/ `fix`（バグ修正）/ `docs`（ドキュメント）/ `refactor`（動作を変えない整理）/ `test`（テスト追加・修正）/ `perf`（性能改善）/ `style`（整形のみ）/ `build`（ビルド・依存関係）/ `ci`（CI 設定）/ `chore`（上記以外の雑務）/ `revert`（コミットの取り消し）
