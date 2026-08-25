import { PageSkeleton, PanelSkeleton, StatRowSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <StatRowSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <PanelSkeleton lines={6} />
        <PanelSkeleton lines={6} />
      </div>
      <PanelSkeleton lines={5} />
    </PageSkeleton>
  );
}
