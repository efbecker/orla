import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Destructive confirmation; with `confirmText` the user must type it first. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmText,
  pending,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  confirmText?: string;
  pending?: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const blocked = confirmText !== undefined && typed.trim() !== confirmText;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped("");
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmText !== undefined ? (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-text">
              Digite <span className="font-mono font-semibold">{confirmText}</span> para confirmar
            </Label>
            <Input id="confirm-text" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={blocked || pending}
            onClick={async () => {
              try {
                await onConfirm();
                setOpen(false);
              } catch {
                // The caller reports the error; keep the dialog open.
              }
            }}
          >
            {pending ? "Aguarde..." : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
