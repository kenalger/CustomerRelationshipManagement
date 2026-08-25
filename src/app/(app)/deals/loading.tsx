import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="flex gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="w-[248px] shrink-0 rounded-lg bg-surface p-3">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-2 h-3.5 w-24" />
            <div className="mt-3 space-y-1.5">
              {Array.from({ length: i === 0 ? 2 : 1 }, (_, c) => (
                <Skeleton key={c} className="h-14 w-full rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
