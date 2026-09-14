import { SettingsShell } from "@/components/settings/settings-shell";
import { getSettingsScreen } from "@/lib/settings/get-settings-screen";

/**
 * Settings, App Surfaces 06. Built 2026-09-13.
 *
 * One page, anchor navigation, per-section components — see
 * components/settings/settings-shell.tsx and docs/DECISIONS.md § Settings.
 * What the drawing shows and this page deliberately does not is listed in
 * docs/KNOWN_GAPS.md.
 */
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  return <SettingsShell screen={await getSettingsScreen()} />;
}
