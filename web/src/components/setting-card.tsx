import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Cloudflare-style setting: title and explanation on the left, control on the right. */
export function SettingCard({
  title,
  description,
  control,
  children,
  className,
}: {
  title: ReactNode;
  description: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-2xl">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        </div>
        {control ? <div className="flex shrink-0 items-center gap-3">{control}</div> : null}
      </div>
      {children ? <div className="border-t px-5 py-4">{children}</div> : null}
    </Card>
  );
}
