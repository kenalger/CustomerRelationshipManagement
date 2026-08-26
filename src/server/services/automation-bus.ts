import type { AutomationEvent } from "@/server/services/automation";

/**
 * The seam between the services that raise events and the engine that runs them.
 *
 * It exists to break an import cycle, and the cycle is not incidental: the
 * engine has to call `createTask` and `notify` to do its work, while those same
 * service modules have to raise events. Importing both ways at module load left
 * one half of the graph half-initialised depending on which file a test
 * happened to import first — 27 suites failed at import with nothing wrong in
 * any of them.
 *
 * The `import type` above is erased at compile time, and the engine is pulled in
 * dynamically at call time, by which point every module is built. Services
 * import THIS file; nothing imports the engine eagerly except the UI layer.
 *
 * Two behaviours belong here rather than at each call site:
 *
 * 1. **Never throws.** A broken rule must not turn a successful ingestion or
 *    stage move into a failure. The `AutomationRun` log is where a rule reports
 *    its own problems.
 * 2. **Called after the transaction commits, never inside one.** A run opens
 *    transactions of its own and this pg adapter cannot interleave them
 *    (`08P01`); it also means a rule never sees a record a rollback erased.
 */
export async function fireAutomation(event: AutomationEvent): Promise<void> {
  try {
    const { dispatch } = await import("@/server/services/automation");
    await dispatch(event);
  } catch {
    // Deliberately swallowed — see (1) above.
  }
}
