import { ArrowLeft, SearchX } from "lucide-react";
import { Link, Outlet, useOutletContext, useParams } from "react-router-dom";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useHost } from "@/lib/queries";
import type { HostDetail } from "@/lib/types";

/** Loads the host of /hosts/:hostId once and hands it to the nested pages. */
export function HostRoute() {
  const { hostId } = useParams();
  const id = Number(hostId);
  const host = useHost(id);

  if (!Number.isInteger(id) || id <= 0 || (host.error instanceof ApiError && host.error.status === 404)) {
    return (
      <EmptyState
        icon={<SearchX />}
        title="Site não encontrado"
        description="Ele pode ter sido excluído por outro usuário."
        action={
          <Button asChild variant="outline">
            <Link to="/hosts">
              <ArrowLeft /> Voltar para Sites
            </Link>
          </Button>
        }
      />
    );
  }
  if (host.isError) return <ErrorBlock error={host.error} onRetry={() => void host.refetch()} />;
  if (!host.data) return <LoadingBlock rows={4} />;
  return <Outlet context={host.data} />;
}

export function useHostContext(): HostDetail {
  return useOutletContext<HostDetail>();
}
