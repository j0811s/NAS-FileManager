---
name: new-feature
description: features 構成ルールに沿って web または server の feature 雛形を生成する。新しい機能（feature）を追加するとき、feature ディレクトリを作るときに使う。引数: web|server <feature-name>（kebab-case）
---

# new-feature: feature 雛形の生成

`$ARGUMENTS` から対象アプリ（`web` または `server`）と feature 名（kebab-case）を読み取る。引数が無い・不足している場合は対象アプリと feature 名を確認してから進める。

## 共通ルール（CLAUDE.md の features 構成に準拠）

- feature 間の import は `index.ts`（公開境界）経由のみ。他 feature の内部ファイルを直接 import するコードを書かない
- フロント/サーバで共有する型は feature 内ではなく `packages/shared/src/types.ts` に定義し、`packages/shared/src/index.ts` から `export type` で再エクスポートする
- `verbatimModuleSyntax` が有効なので、型のみの import/export は必ず `import type` / `export type`

## web の場合

`apps/web/src/features/<feature-name>/` に以下を作成:

```
components/        # feature 専用コンポーネント（空で開始、.gitkeep）
hooks/             # feature 専用フック（空で開始、.gitkeep）
api.ts             # サーバ API 呼び出し（fetch ラッパ）
types.ts           # feature 内部だけで使う型
index.ts           # 公開境界（バレル）。外に見せるものだけ export
```

- `index.ts` には「この feature の公開 API はここから export する」ことをコメントで明記する
- 汎用 UI プリミティブが必要なら `components/ui/`（shadcn/ui 生成物）を使う。feature 内に汎用コンポーネントを作らない

## server の場合

`apps/server/src/features/<feature-name>/` に以下を作成:

```
<feature-name>.routes.ts    # Hono ルート定義（export const <camelCase>Routes = new Hono()）
<feature-name>.service.ts   # ビジネスロジック・ファイル I/O
<feature-name>.schema.ts    # リクエスト/レスポンスのバリデーションスキーマ
```

- 作成後、`apps/server/src/app.ts` に `app.route("/api", <camelCase>Routes)` の形でルートを登録する（既存の登録パターンに合わせる）
- ユーザー入力のパスを扱う場合は必ず `lib/` のパス検証（safeResolve）を経由させる。存在しなければ実装を提案する
- 大きなファイルの読み書きはストリーミング（`fs.createReadStream` / `pipeline`）。`parseBody()` で全体をメモリに載せない

## 生成後の検証

1. `npm run typecheck` が通ること
2. `npm run lint` / `npm run fmt:check` が通ること
