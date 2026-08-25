import { ArrowRightLeft, Mail, MessageSquare, Phone, Users } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { timeAgo } from "@/lib/utils";

type Activity = {
  id: string;
  type: string;
  subject: string | null;
  body: string | null;
  occurredAt: Date;
  user: { name: string | null; email: string } | null;
};

const KIND = {
  CALL: { Icon: Phone, cls: "bg-info-muted text-info" },
  EMAIL: { Icon: Mail, cls: "bg-info-muted text-info" },
  MEETING: { Icon: Users, cls: "bg-warning-muted text-warning" },
  NOTE: { Icon: MessageSquare, cls: "bg-sunken text-secondary" },
  STAGE_CHANGE: { Icon: ArrowRightLeft, cls: "bg-success-muted text-success" },
} as const;

export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-[12px] text-muted">
        Nothing logged yet. Every call and email you record here shows up on the account too.
      </p>
    );
  }

  return (
    <ol className="relative space-y-0">
      {activities.map((a, i) => {
        const kind = KIND[a.type as keyof typeof KIND] ?? KIND.NOTE;
        const last = i === activities.length - 1;

        return (
          <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* The rail makes the sequence readable at a glance. */}
            {!last ? (
              <span
                aria-hidden
                className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-border-subtle"
              />
            ) : null}

            <span
              className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full ${kind.cls}`}
            >
              <kind.Icon size={12} strokeWidth={2} aria-hidden />
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[12px] font-medium">
                  {a.subject ?? a.type.replaceAll("_", " ").toLowerCase()}
                </span>
                <time
                  dateTime={new Date(a.occurredAt).toISOString()}
                  className="text-[12px] text-muted"
                >
                  {timeAgo(a.occurredAt)}
                </time>
              </div>

              {a.body ? (
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-[18px] text-secondary">
                  {a.body}
                </p>
              ) : null}

              {a.user ? (
                <span className="mt-1.5 flex items-center gap-1.5">
                  <Avatar name={a.user.name ?? a.user.email} size={16} />
                  <span className="text-[12px] text-muted">{a.user.name ?? a.user.email}</span>
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
