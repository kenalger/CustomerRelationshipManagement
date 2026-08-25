import { PageSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <TableSkeleton />
    </PageSkeleton>
  );
}
