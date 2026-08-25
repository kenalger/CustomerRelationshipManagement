/**
 * A heading inside a page that already has a chrome header.
 *
 * Settings pages sit under the settings layout's own sticky header, so a second
 * `PageHeader` would stack two bars and produce the displaced look. This is a
 * plain in-flow heading instead.
 */
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="t-title">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-[14px] text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}
