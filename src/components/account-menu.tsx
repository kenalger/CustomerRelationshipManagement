"use client";

import { LogOut, Settings, Users } from "lucide-react";
import { useTransition } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { signOutAction } from "@/server/actions/auth";

/**
 * Account menu, pinned to the top-right of the app bar.
 *
 * Top-right is the convention nearly every workspace product follows —
 * Airtable, Gmail, GitHub, Stripe, Vercel, Linear, Salesforce, HubSpot. Notion
 * is the notable exception, keeping it in the sidebar, and copying that put it
 * somewhere people do not look for it.
 *
 * The trigger is the avatar alone: an identity control does not need to repeat
 * a name that is already in the menu it opens.
 */
export function AccountMenu({
  userName,
  userEmail,
  role,
}: {
  userName: string | null;
  userEmail: string;
  role: string;
}) {
  const [, startSignOut] = useTransition();
  const display = userName ?? userEmail;

  return (
    <Menu
      label="Account"
      align="end"
      trigger={({ open }) => (
        <span
          className={`flex size-8 items-center justify-center rounded-full transition-shadow ${
            open ? "ring-2 ring-accent ring-offset-1" : "hover:ring-2 hover:ring-border-strong"
          }`}
        >
          <Avatar name={display} size={28} />
          <span className="sr-only">Account and settings for {display}</span>
        </span>
      )}
    >
      <div className="flex items-center gap-2.5 px-2 py-2">
        <Avatar name={display} size={32} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-[510]">{display}</p>
          <p className="truncate text-[12px] text-muted">{userEmail}</p>
          <p className="truncate text-[12px] capitalize text-muted">
            {role.replace("_", " ").toLowerCase()}
          </p>
        </div>
      </div>

      <MenuSeparator />

      <MenuItem href="/settings/organization" icon={<Settings size={15} strokeWidth={1.75} />}>
        Settings
      </MenuItem>
      <MenuItem href="/settings/team" icon={<Users size={15} strokeWidth={1.75} />}>
        Members
      </MenuItem>

      <MenuSeparator />

      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="text-[14px]">Appearance</span>
        <ThemeToggle />
      </div>

      <MenuSeparator />

      <MenuItem
        danger
        icon={<LogOut size={15} strokeWidth={1.75} />}
        onSelect={() => startSignOut(() => signOutAction())}
      >
        Sign out
      </MenuItem>
    </Menu>
  );
}
