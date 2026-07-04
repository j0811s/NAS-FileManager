import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MkdirDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  function handleOpenChange(v: boolean) {
    if (!v) setName("");
    onOpenChange(v);
  }
  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setName("");
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新しいフォルダ</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="mkdir-name">フォルダ名</Label>
          <Input id="mkdir-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={submit}>作成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
