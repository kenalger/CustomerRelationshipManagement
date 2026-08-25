import { redirect } from "next/navigation";

// /settings has no content of its own — the first section is the landing page.
export default function SettingsIndex() {
  redirect("/settings/organization");
}
