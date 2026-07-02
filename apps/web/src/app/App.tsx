import type { FileEntry } from "@nas-fm/shared";

const sample: FileEntry = {
  name: "example.txt",
  size: 0,
  mtime: 0,
  type: "file",
};

export function App() {
  return (
    <main>
      <h1>NAS-FileManager</h1>
      <p>{sample.name}</p>
    </main>
  );
}
