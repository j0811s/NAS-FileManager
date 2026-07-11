# フォルダ階層のURLハッシュ同期 設計

日付: 2026-07-11
ステータス: 承認待ち

## 目的

現在 `FileBrowser.tsx` の閲覧中フォルダパス（`path`）は素の `useState("")` で保持されており、URLとは一切連動していない。そのため、ブラウザの戻る/進むボタンでフォルダ階層を移動することができず、特定のフォルダを直接ブックマーク・共有することもできない。閲覧パスをURLハッシュ（`#/docs/2024` 形式）に同期し、ブラウザの標準的な履歴操作（戻る/進む/リロード/ブックマーク）でフォルダ階層をナビゲートできるようにする。

## 方針（決定事項）

- **実装は自前の `useHashPath` フック**（`window.location.hash` + `hashchange` イベント）で行う。`react-router-dom` 等のルーティングライブラリは導入しない。このアプリは単一ページで「フォルダパスという1つの文字列状態」を同期したいだけであり、ネストルーティングや複数ページ機能は無いため、ライブラリ追加は過剰（YAGNI）
- **ハッシュ形式**: `#/` + パスの各セグメントを `encodeURIComponent` してから `/` で結合。ルート（`path === ""`）はハッシュ無し（`location.hash = ""`）
- **不正な形式のハッシュ**（`%` エンコードが壊れている等デコード不能なもの）は**サイレントにルートへフォールバック**する
- **有効な形式だが存在しない/削除済みフォルダを指すハッシュ**（古いブックマーク、他端末で削除後のリロード等）は、**既存のエラー表示のまま**にする（`useFileList` の取得失敗時に出る「一覧の読み込みに失敗しました・再試行」を流用。ハッシュ層での特別な自動リダイレクトは行わない。ユーザーはパンくずの「ホーム」から手動で復帰できる）
- ハッシュを**唯一の情報源（single source of truth）**とする。`path` state は `hashchange` イベント経由でのみ更新し、`navigate()` は `location.hash` を書き換えるだけで state を直接更新しない。これにより、state と hash を両方更新することによる不整合・無限ループ回避ロジックが不要になる
- 同一パスへの重複ナビゲーションは、`location.hash` に同じ値を代入してもブラウザが no-op（新規履歴エントリ・`hashchange` イベントとも発生しない）にする既定動作にそのまま委ねる。アプリ側で明示的な重複チェックは書かない

## スコープ外

- **`MoveDialog` 内の移動先フォルダ選択**（`browsePath`、コンポーネント内ローカル state）はハッシュと非連動のまま。一時的なUI状態であり、URLに残す意味がないため
- **プレビューモーダルの開閉状態**はハッシュに含めない（`docs/superpowers/specs/2026-07-11-preview-modal-navigation-design.md` で既にディープリンク非対応と決定済み）
- **ソート順・グリッド/テーブル表示モード**はハッシュに含めない。表示モードは既存どおり `localStorage`（`nas-fm:view-mode`）のまま
- サーバー側の変更は無し

## 設計

### `useHashPath`（新規: `apps/web/src/features/file-list/hooks/useHashPath.ts`）

```ts
function encodeHashPath(path: string): string {
  if (!path) return "";
  return "/" + path.split("/").map(encodeURIComponent).join("/");
}

function decodeHashPath(hash: string): string {
  const trimmed = hash.replace(/^#\/?/, "");
  if (!trimmed) return "";
  try {
    return trimmed.split("/").map(decodeURIComponent).join("/");
  } catch {
    return "";
  }
}

export function useHashPath(): [string, (path: string) => void] {
  const [path, setPath] = useState(() => decodeHashPath(window.location.hash));

  useEffect(() => {
    function handleHashChange() {
      setPath(decodeHashPath(window.location.hash));
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigate(next: string) {
    window.location.hash = encodeHashPath(next);
  }

  return [path, navigate];
}
```

`encodeHashPath` / `decodeHashPath` はテスト容易性のためモジュール内で個別に定義するが、外部には `useHashPath` のみを公開する（feature の公開境界は `useHashPath` 単体で十分。エンコード関数はフックの実装詳細）。

### `FileBrowser.tsx` の変更（最小差分）

```tsx
// 変更前
const [path, setPath] = useState("");
function openDir(name: string) {
  setPath(path ? `${path}/${name}` : name);
}
<Breadcrumbs path={path} onNavigate={setPath} />

// 変更後
const [path, navigate] = useHashPath();
function openDir(name: string) {
  navigate(path ? `${path}/${name}` : name);
}
<Breadcrumbs path={path} onNavigate={navigate} />
```

`path` を参照している他の箇所（`useFileList(path)` / `rel()` / `UploadDropzone` の `path` prop / `MoveDialog` の `currentPath`）は `path` の型・意味（フォルダの相対パス文字列）が変わらないため無変更。

### セキュリティ

ハッシュ経由でセットされる `path` は、ブラウザ上でユーザーが自由に書き換え可能な信頼できない入力である。これは既存の `path` state（パンくずクリック等で生成される値）と本質的に同じ扱いで、`api.list(path)` 等のAPI呼び出しを経て**サーバー側の既存の `safeResolve` / `PATH_TRAVERSAL` ガードがそのまま適用される**。ハッシュ層で新たなバリデーションを追加する必要は無い。

## テスト（Vitest）

- `useHashPath.test.ts`（新規。`@testing-library/react` の `renderHook` を使用）
  - 初期ハッシュ無し（`location.hash === ""`）→ 返り値の `path === ""`
  - 初期ハッシュ `#/docs/2024` → `path === "docs/2024"`
  - 日本語・スペースを含むセグメント（例: `#/%E6%97%A5%E6%9C%AC%E8%AA%9E`）のデコードが正しい文字列になる
  - 不正な `%` エンコード（例: `#/%zz`）のハッシュ → `path === ""` にフォールバック
  - `navigate("docs")` 呼び出し後、`window.location.hash === "#/docs"` になる
  - `navigate("")` 呼び出し後、`window.location.hash === ""` になる
  - `hashchange` イベントを発火させる（`window.location.hash` を直接書き換えて `dispatchEvent(new HashChangeEvent("hashchange"))`）と、返り値の `path` が新しいハッシュに追従する（ブラウザの戻る/進む相当の検証）
- `FileBrowser.test.tsx`（追記。既存の `afterEach` に `window.location.hash = ""` のリセットを追加し、テスト間の汚染を防ぐ）
  - `window.location.hash = "#/docs"` を事前セットしてマウントすると、`api.list` が `"docs"` で呼ばれる
  - フォルダをクリックして開くと `window.location.hash` に新しいセグメントが追加される
  - `hashchange` を発火させて1つ前のハッシュ値に戻すと、対応するフォルダの一覧表示に戻る（戻るボタン相当の検証）

## 影響範囲

- 新規: `apps/web/src/features/file-list/hooks/useHashPath.ts` / `useHashPath.test.ts`
- 変更: `apps/web/src/features/file-list/components/FileBrowser.tsx`（`useState` → `useHashPath` への置き換え、`setPath` 呼び出し箇所を `navigate` に変更）
- 変更なし: `MoveDialog.tsx`、`Breadcrumbs.tsx`（`onNavigate` のシグネチャは `(path: string) => void` のまま変わらない）、サーバー側一式、`api.ts`
- 依存追加: なし
