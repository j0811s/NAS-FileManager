---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/tsconfig*.json"
---

# TypeScript の制約（TS 6.0.3 で実際にエラーになる）

- `baseUrl` は使わない（TS5101 でエラー）。`paths` の値は相対パス必須（`"@/*": ["./src/*"]` 形式。`"src/*"` は TS5090）
- `tsc -b` / `composite` は使わない。ルートと `apps/web` の solution tsconfig はエディタの参照解決用で、`tsc -b` すると TS6306 になる。型検査は各ワークスペースの `tsc -p <tsconfig> --noEmit`（`npm run typecheck` が束ねる）
- `verbatimModuleSyntax: true`（tsconfig.base.json）。型のみの import/export は必ず `import type` / `export type`

# @nas-fm/shared はソース参照

`exports` が `./src/index.ts`（TS ソース）を直接指す。ビルド不要・ビルドスクリプトも無し。型解決は各ワークスペース tsconfig の `paths`（`"@nas-fm/shared": ["../../packages/shared/src/index.ts"]`）。Vite / tsx がソースのまま取り込む。
