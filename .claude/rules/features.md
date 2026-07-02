---
paths:
  - "apps/**"
---

# features 構成のルール

- feature 間の import は各 feature の `index.ts`（公開境界）経由のみ。内部実装への直接 import は禁止
- feature 横断の共通ロジックは各アプリの `lib/`、フロント/サーバで共有する型は `packages/shared`
- shadcn/ui の生成物は `apps/web/src/components/ui/`（features には入れない）
- server は feature ごとに `<name>.routes.ts` / `<name>.service.ts` / `<name>.schema.ts` をまとめ、`app.ts` で routes を束ねる

feature の雛形生成には `/new-feature` スキルを使う。
