import { Skeleton } from '../StateBlocks';

/** Esqueleto do painel do cliente: mesma estrutura da tela final, para não "pular" ao carregar. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Carregando seu painel">
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  );
}
