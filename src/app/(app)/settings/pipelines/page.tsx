import { SectionHeader } from "@/components/section-header";
import { Callout } from "@/components/ui/callout";
import { requireCtx } from "@/server/context";
import { listPipelines } from "@/server/services/settings";
import { NewPipelineForm, PipelineEditor } from "./pipeline-editor";

export const metadata = { title: "Pipelines · CRM" };

export default async function PipelinesSettingsPage() {
  const ctx = await requireCtx();
  const pipelines = await listPipelines(ctx);
  const canManage = ctx.role === "OWNER" || ctx.role === "ADMIN";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
        <SectionHeader
          title="Pipelines"
          description="A pipeline is the set of stages a deal moves through. Most teams need one; add another if you sell something with a genuinely different process, like renewals."
          action={canManage ? <NewPipelineForm /> : undefined}
        />

        {!canManage ? (
          <Callout tone="info">Only an owner or admin can change pipelines.</Callout>
        ) : null}

        {pipelines.map((pipeline) => (
          <PipelineEditor
            key={pipeline.id}
            canManage={canManage}
            pipeline={{
              id: pipeline.id,
              name: pipeline.name,
              isDefault: pipeline.isDefault,
              stages: pipeline.stages.map((stage) => ({
                id: stage.id,
                name: stage.name,
                probability: stage.probability,
                outcome: stage.isWon ? "won" : stage.isLost ? "lost" : "open",
                deals: stage._count.deals,
              })),
            }}
          />
        ))}

        <p className="text-[13px] text-muted">
          A stage still holding deals cannot be deleted — move those deals to another stage first.
        </p>
    </div>
  );
}
