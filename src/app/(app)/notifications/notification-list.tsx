"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import {
  type NotificationActionState,
  markAllReadAction,
  markReadAction,
} from "@/server/actions/notifications";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity: string | null;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

const TONE: Record<string, "info" | "warning" | "danger"> = {
  LEAD_ASSIGNED: "info",
  LEAD_UNWORKED: "warning",
  CONNECTION_UNHEALTHY: "danger",
  INGESTION_DEAD_LETTERED: "danger",
};

/** Where a notification points. Unknown entities simply get no link. */
function hrefFor(notification: Notification): string | null {
  switch (notification.entity) {
    case "Lead":
      return "/leads";
    case "Connection":
    case "IngestionEvent":
      return "/settings/connections";
    default:
      return null;
  }
}

export function MarkAllReadButton() {
  const [state, action] = useActionState<NotificationActionState, FormData>(
    markAllReadAction,
    {},
  );
  const { pending } = useFormStatus();

  return (
    <form action={action} className="flex items-center gap-2">
      <span aria-live="polite" className="text-xs text-muted">
        {state.message}
      </span>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        Mark all read
      </Button>
    </form>
  );
}

function MarkReadButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="ghost" disabled={pending}>
      {pending ? "…" : "Mark read"}
    </Button>
  );
}

export function NotificationRow({ notification }: { notification: Notification }) {
  const [state, action] = useActionState<NotificationActionState, FormData>(markReadAction, {});
  const href = hrefFor(notification);
  const unread = !notification.readAt;

  return (
    <li className={cn("flex items-start gap-3 p-3", unread && "bg-accent/5")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[notification.type] ?? "neutral"}>
            {notification.type.replaceAll("_", " ").toLowerCase()}
          </Badge>
          <span className={cn("text-sm", unread && "font-semibold")}>{notification.title}</span>
          <time dateTime={new Date(notification.createdAt).toISOString()} className="text-xs text-muted">
            {timeAgo(notification.createdAt)}
          </time>
        </div>

        {notification.body ? (
          <p className="mt-1 text-sm text-muted">{notification.body}</p>
        ) : null}

        {href ? (
          <Link href={href} className="mt-1 inline-block text-xs text-accent hover:underline">
            View
          </Link>
        ) : null}

        {state.error ? (
          <p role="alert" className="mt-1 text-xs text-danger">
            {state.error}
          </p>
        ) : null}
      </div>

      {unread ? (
        <form action={action}>
          <input type="hidden" name="notificationId" value={notification.id} />
          <MarkReadButton />
        </form>
      ) : null}
    </li>
  );
}
