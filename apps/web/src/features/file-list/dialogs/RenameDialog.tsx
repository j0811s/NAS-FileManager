import { useEffect, useState } from "react";
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

export function RenameDialog({
  open,
  onOpenChange,
  currentName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentName: string;
  onSubmit: (newName: string) => void;
}) {
  const [name, setName] = useState(currentName);
  useEffect(() => setName(currentName), [currentName]);
  function submit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) {
      onOpenChange(false);
      return;
    }
    onSubmit(trimmed);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>名前を変更</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename-name">新しい名前</Label>
          <Input id="rename-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={submit}>変更</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
