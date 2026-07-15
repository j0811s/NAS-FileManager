import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchDialog } from "./SearchDialog";

export function SearchButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label="検索" onClick={() => setOpen(true)}>
        <Search size={16} />
      </Button>
      <SearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
