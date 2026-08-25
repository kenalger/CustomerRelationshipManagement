import { PageSkeleton, PanelSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <PanelSkeleton lines={6} />
          <PanelSkeleton lines={3} />
        </div>
        <div className="space-y-4">
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={6} />
        </div>
      </div>
    </PageSkeleton>
  );
}
