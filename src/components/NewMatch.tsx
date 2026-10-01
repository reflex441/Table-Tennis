"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { api, ApiClientError } from "@/lib/client-api";
import { MatchEditor, type MatchFormValues } from "./MatchEditor";
import { useSettings } from "./SettingsProvider";
import { useNotifications } from "./NotificationProvider";

interface CreateResponse {
  results: { status: string; message?: string; existingId?: string; match?: { id: string } }[];
}

/** Manual match entry, for matches that aren't in a screenshot. */
export function NewMatch() {
  const { settings } = useSettings();
  const { notify } = useNotifications();
  const router = useRouter();

  const submit = async (v: MatchFormValues) => {
    const send = (allowSimilar: boolean) =>
      api<CreateResponse>("/api/matches", { method: "POST", json: { matches: [{ ...v, screenshotIds: [], allowSimilar }] } });
    let res = await send(false);
    let r = res.results[0];
    if (r.status === "similar" && window.confirm(`${r.message}\n\nCreate it anyway?`)) {
      res = await send(true);
      r = res.results[0];
    }
    if (r.status !== "created" || !r.match) throw new ApiClientError(r.message ?? "Could not create the match.", 409, r.status);
    notify("Alarm created", `${v.player1} vs ${v.player2}`);
    router.push(`/matches/${r.match.id}`);
    router.refresh();
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <Link href="/" className="flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>
      <div className="card p-4">
        <h1 className="mb-3 text-lg font-semibold">Add a match manually</h1>
        <MatchEditor timezone={settings.timezone} defaultReminder={settings.defaultReminderMinutes} submitLabel="Create alarm" onSubmit={submit} />
      </div>
    </div>
  );
}
