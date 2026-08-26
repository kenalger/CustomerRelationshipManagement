import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


/** Compact relative time — reps scan these, they don't read them. */
export function timeAgo(date: Date | string): string {
  const then = new Date(date).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

/**
 * The forward-facing sibling of `timeAgo`, for a deadline rather than a past
 * event.
 *
 * `timeAgo` cannot do this: a future date runs its subtraction negative and it
 * renders "-180m ago". Kept here beside it because this is where the clock is
 * read for display — a component that calls `Date.now()` in its own body is
 * impure and the React lint rejects it.
 */
export function timeUntil(date: Date | string): string {
  const then = new Date(date).getTime();
  const mins = Math.round((then - Date.now()) / 60000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `in ${days}d`;
  return new Date(date).toLocaleDateString();
}
