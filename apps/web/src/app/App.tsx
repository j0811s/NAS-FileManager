import { AuthGate, LogoutButton, useAuth } from "@/features/auth";
import { FileBrowser } from "@/features/file-list";
import { Providers } from "./providers";

function Header() {
  const { data } = useAuth();
  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <h1 className="text-xl font-semibold">NAS-FileManager</h1>
      {data?.authenticated && <LogoutButton />}
    </header>
  );
}

export function App() {
  return (
    <Providers>
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main className="p-6">
          <AuthGate>
            <FileBrowser />
          </AuthGate>
        </main>
      </div>
    </Providers>
  );
}
