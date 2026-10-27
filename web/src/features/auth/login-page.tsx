import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation } from "react-router-dom";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { OrlaLogo } from "@/components/orla-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const schema = z.object({
  email: z.string().trim().min(1, "Informe o e-mail.").email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

type Values = z.infer<typeof schema>;

export function LoginPage() {
  const { state, login } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  if (state.status === "authenticated") {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/login" ? from : "/"} replace />;
  }

  const onSubmit = async (values: Values) => {
    setError(null);
    try {
      await login(values.email, values.password);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        <OrlaLogo className="h-10 w-10" />
        <div>
          <p className="text-xl font-semibold leading-tight">Orla</p>
          <p className="text-xs text-muted-foreground">Reverse proxy & edge manager</p>
        </div>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Entrar no painel</CardTitle>
          <CardDescription>Use o e-mail e a senha de administrador.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FormField id="email" label="E-mail" error={errors.email?.message}>
              <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!errors.email} {...form.register("email")} />
            </FormField>
            <FormField id="password" label="Senha" error={errors.password?.message}>
              <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register("password")} />
            </FormField>
            {error ? (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        A senha inicial do administrador fica em <code className="font-mono">/etc/orla/orla.env</code> no servidor.
      </p>
    </div>
  );
}
