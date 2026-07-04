import { Fragment } from "react";
import { Button } from "@/components/ui/button";

export function Breadcrumbs({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const segments = path ? path.split("/") : [];
  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="パンくず">
      <Button variant="ghost" size="sm" onClick={() => onNavigate("")}>
        ホーム
      </Button>
      {segments.map((seg, i) => {
        const target = segments.slice(0, i + 1).join("/");
        return (
          <Fragment key={target}>
            <span className="text-muted-foreground">/</span>
            <Button variant="ghost" size="sm" onClick={() => onNavigate(target)}>
              {seg}
            </Button>
          </Fragment>
        );
      })}
    </nav>
  );
}
