import { useEffect, useState } from "react";

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
