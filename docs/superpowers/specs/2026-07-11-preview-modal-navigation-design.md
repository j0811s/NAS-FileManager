# プレビューモーダルの前後スライドナビゲーション 設計

日付: 2026-07-11
ステータス: 承認待ち

## 目的

現在のプレビューモーダル（`PreviewDialog`）は、開いたファイル単体だけを表示する。フォルダ内に複数の画像・動画があるとき、1件ずつ「閉じる→次のファイルをクリックして開く」を繰り返す必要があり手間が大きい。モーダルを閉じずに前後のファイルへ移動できる矢印ボタン・キーボード操作を追加し、連続閲覧を快適にする。

## 方針（決定事項）

- **移動対象はフォルダ内のディレクトリ以外の全ファイル**。プレビュー非対応の拡張子（zip等）も移動先に含める。着地したファイルが非対応なら既存の「プレビューできません・ダウンロード」表示になる（フォルダの並び順どおりに1つずつ進む感覚を優先し、プレビュー可否でフィルタしない）
- **先頭/末尾ではボタンを無効化する（ループしない）**。位置が直感的で実装もシンプル
- **矢印ボタン（クリック/タップ）に加えて、モーダルが開いている間は ←/→ キーでもナビゲーションする**
- **タッチのスワイプジェスチャは今回のスコープ外**（YAGNI。タッチ端末では矢印ボタンをタップすれば同じ操作ができる）
- **モーダル内に「3 / 12」形式の位置カウンタを表示する**
- 対象順序は**現在表示中の並び順（`sortEntries` 後の `sorted`）**に従う。グリッド/テーブルどちらの表示モードでも同じ順序でスライドする

## スコープ外

- タッチのスワイプジェスチャ
- URL への現在位置の反映（ディープリンク）。このアプリはそもそもルーティングを持たず、`path` はコンポーネント内 state のため対象外
- フォルダをまたいだナビゲーション（現在のフォルダ内のみ）
- 一覧が裏で変化した場合（他クライアントによる削除・リネーム等）の追従。`previewTarget` が現在の一覧から見つからなくなるケースは矢印を無効化するだけに留める

## 設計

### 状態管理（`FileBrowser.tsx`）

既存の `previewTarget: FileEntry | null` はそのまま維持し、新しい state 変数は追加しない。ナビゲーション情報はすべて `sorted` からの派生値として計算する。

```tsx
const previewableEntries = useMemo(
  () => sorted.filter((entry) => entry.type !== "dir"),
  [sorted],
);
const previewIndex = previewTarget
  ? previewableEntries.findIndex((entry) => entry.name === previewTarget.name)
  : -1;

function navigatePreview(delta: number) {
  const next = previewableEntries[previewIndex + delta];
  if (next) setPreviewTarget(next);
}
```

`previewIndex === -1`（`previewTarget` が現在の `sorted` に見つからない、通常は起きない保険的なケース）では前後ボタンを両方 disabled・カウンタ非表示にするが、プレビュー自体は `previewTarget` の内容でそのまま表示を続ける（強制クローズはしない）。

`PreviewDialog` への配線:

```tsx
<PreviewDialog
  open={previewTarget !== null}
  onOpenChange={(v) => !v && setPreviewTarget(null)}
  name={previewTarget?.name ?? ""}
  path={previewTarget ? rel(previewTarget.name) : ""}
  nav={{
    hasPrev: previewIndex > 0,
    hasNext: previewIndex >= 0 && previewIndex < previewableEntries.length - 1,
    onPrev: () => navigatePreview(-1),
    onNext: () => navigatePreview(1),
    position:
      previewIndex >= 0
        ? { index: previewIndex + 1, total: previewableEntries.length }
        : null,
  }}
/>
```

### `PreviewDialog` の API 変更

ナビゲーション関連の5つの値は1つの `nav` prop にまとめ、**オプショナル**にする。既存の `PreviewDialog.test.tsx` の4テストは `nav` を渡していないため、オプショナルにすることで無変更のまま通り続ける。

```tsx
export interface PreviewNav {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  position: { index: number; total: number } | null;
}

export function PreviewDialog({
  open,
  onOpenChange,
  name,
  path,
  nav,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  path: string;
  nav?: PreviewNav;
}) { ... }
```

`nav` が未指定のときは矢印ボタン・カウンタ・キーボードリスナーのいずれも描画/登録しない。

### UI（`PreviewDialog.tsx`）

- `DialogHeader` 内、`DialogTitle`（ファイル名。長い名前に備え `truncate` を追加）の隣に `nav.position` があれば `{index} / {total}` を小さい muted テキストで表示
- 画像/動画/テキスト/フォールバックの表示ブロック全体を `<div className="relative">` でラップし、その中に左右矢印ボタンを重ねる
  - `ChevronLeft` / `ChevronRight`（lucide-react）
  - `Button variant="ghost" size="icon"` に `rounded-full bg-background/70 hover:bg-background/90` を additional className で付与（`FileGrid.tsx` の動画再生アイコンオーバーレイと同系統の見た目に揃える）
  - 配置は `absolute left-2 top-1/2 -translate-y-1/2`（左）/ `absolute right-2 top-1/2 -translate-y-1/2`（右）
  - `disabled={!nav.hasPrev}` / `disabled={!nav.hasNext}`（境界で無効化。非表示にはしない）
  - `aria-label="前のファイル"` / `aria-label="次のファイル"`
- `nav` が undefined のときはラッパー div は付けるが矢印は描画しない（既存表示に影響なし）

### キーボード操作

`PreviewDialog` 内に、モーダルが開いていて `nav` があるときだけ有効な `keydown` リスナーを `useEffect` で登録する。

```tsx
useEffect(() => {
  if (!open || !nav) return;
  function handleKeyDown(e: KeyboardEvent) {
    // <video controls> にフォーカスがある場合、ブラウザ標準のシーク操作(←/→)と衝突するため
    // ナビゲーションをスキップする
    if (document.activeElement instanceof HTMLVideoElement) return;
    if (e.key === "ArrowLeft" && nav.hasPrev) nav.onPrev();
    if (e.key === "ArrowRight" && nav.hasNext) nav.onNext();
  }
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [open, nav]);
```

Radix Dialog は Escape での close・フォーカストラップを既に内蔵しているため、追加するのは左右キーのハンドリングのみでよい。

### ファイル切り替え時の内部状態リセット

- `TextPreview` は既に `useEffect` が `[url]` に依存しているため、`path` の変更（＝ナビゲーション）で自動的に再フェッチされる。変更不要
- HEIC対応スペック（`2026-07-11-heic-preview-design.md`）で追加予定の `HeicPreview` は `key={path}` を受け取る設計のため、ナビゲーションで `path` が変わるとコンポーネントごと再マウントされ、内部の `failed` state が自然にリセットされる。追加対応不要
- 画像 (`<img src={url}>`) ・動画 (`<video src={url}>`) は生の `src` 切り替えのみで、React 側に保持する状態が無いため特別な対応不要

## テスト（Vitest）

- `PreviewDialog.test.tsx`（追記）
  - `nav` 未指定時は矢印ボタン・カウンタが描画されない（既存4テストは無変更のまま通ることを確認）
  - `nav` 指定時、矢印ボタン・`{index} / {total}` カウンタが表示される
  - 「次のファイル」ボタンをクリックすると `nav.onNext` が呼ばれる（「前のファイル」も同様）
  - `hasPrev: false` のとき「前のファイル」ボタンが disabled、`hasNext: false` のとき「次のファイル」ボタンが disabled
  - `open` かつ `nav` ありの状態で `ArrowRight`/`ArrowLeft` キーを送ると対応する `onNext`/`onPrev` が呼ばれる。`hasNext: false` のときは `ArrowRight` を送っても呼ばれない
- `FileBrowser.test.tsx`（追記）
  - dir + file が混在する一覧で、ファイルをクリックしてモーダルを開き「次のファイル」ボタンで次のファイル名・パス表示に切り替わること
  - 一覧の最後のファイルを開いた状態では「次のファイル」ボタンが disabled であること（先頭では「前のファイル」が disabled）
  - ディレクトリがナビゲーション対象から除外されること（file, dir, file の並びで、1つ目のfileから「次へ」を押すと2つ目のfileに飛ぶ）

## 影響範囲

- 変更: `apps/web/src/features/file-list/components/FileBrowser.tsx`（`previewableEntries` / `previewIndex` / `navigatePreview` の追加、`PreviewDialog` への `nav` prop 配線）
- 変更: `apps/web/src/features/file-list/dialogs/PreviewDialog.tsx`（`nav` prop の追加、矢印ボタン・カウンタの描画、`keydown` ハンドラ）
- 変更なし: `FileGrid.tsx` / `FileTable.tsx` / `RowActions.tsx`（`onPreview` の呼び出し方は従来どおり）、サーバー側一式（本機能はフロントのみで完結する）
- 依存追加: なし（既存の `lucide-react` の `ChevronLeft` / `ChevronRight` を使用）
- HEIC対応スペック（`docs/superpowers/specs/2026-07-11-heic-preview-design.md`）とは同じ `PreviewDialog.tsx` を変更するが、HEIC側は image 分岐の中身（`HeicPreview` への切り替え）、本設計はラッパー・ヘッダー・矢印・キー操作という別範囲であり、コードとしての衝突は無い（実装順はどちらが先でも良い）
