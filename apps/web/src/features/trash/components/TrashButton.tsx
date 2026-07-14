import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrashDialog } from "./TrashDialog";

export function TrashButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label="ゴミ箱" onClick={() => setOpen(true)}>
        <Trash2 size={16} />
      </Button>
      <TrashDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
