import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual."),
    newPassword: z.string().min(10, "A nova senha deve ter pelo menos 10 caracteres.").max(200),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, { path: ["confirmPassword"], message: "As senhas não conferem." });

type Values = z.infer<typeof schema>;

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { logout } = useAuth();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });
  const mutation = useMutation({
    mutationFn: (values: Values) =>
      api("/auth/change-password", { method: "POST", body: { currentPassword: values.currentPassword, newPassword: values.newPassword } }),
    onSuccess: () => {
      toast.success("Senha alterada. Entre de novo com a nova senha.");
      form.reset();
      onOpenChange(false);
      void logout();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const { errors } = form.formState;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar senha</DialogTitle>
          <DialogDescription>Por segurança, todas as sessões serão encerradas, inclusive esta, e você entrará de novo com a nova senha.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          <FormField id="currentPassword" label="Senha atual" error={errors.currentPassword?.message}>
            <Input id="currentPassword" type="password" autoComplete="current-password" aria-invalid={!!errors.currentPassword} {...form.register("currentPassword")} />
          </FormField>
          <FormField id="newPassword" label="Nova senha" hint="Pelo menos 10 caracteres." error={errors.newPassword?.message}>
            <Input id="newPassword" type="password" autoComplete="new-password" aria-invalid={!!errors.newPassword} {...form.register("newPassword")} />
          </FormField>
          <FormField id="confirmPassword" label="Confirme a nova senha" error={errors.confirmPassword?.message}>
            <Input id="confirmPassword" type="password" autoComplete="new-password" aria-invalid={!!errors.confirmPassword} {...form.register("confirmPassword")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando..." : "Alterar senha"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
