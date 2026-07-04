import { AuthGate, LogoutButton } from "@/features/auth";
import { FileBrowser } from "@/features/file-list";
import { Providers } from "./providers";

export function App() {
  return (
    <Providers>
      <div className="min-h-screen bg-background text-foreground">
        <header className="flex items-center justify-between border-b px-6 py-4">
          <h1 className="text-xl font-semibold">NAS-FileManager</h1>
        </header>
        <main className="p-6">
          <AuthGate>
            <div className="mb-4 flex justify-end">
              <LogoutButton />
            </div>
            <FileBrowser />
          </AuthGate>
        </main>
      </div>
    </Providers>
  );
}
