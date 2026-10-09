"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { PublicProfile } from "@/lib/profiles";
import { Avatar } from "./Avatar";
import { ProfitPage } from "./ProfitPage";

/** Another account's profit page, read-only (from the leaderboard). */
export function UserProfilePage({ profile }: { profile: PublicProfile }) {
  const { account } = profile;
  return (
    <div className="flex flex-col gap-5">
      <Link href="/leaderboard" className="inline-flex items-center gap-1 self-start text-xs text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Leaderboard
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={account.name} url={account.avatarUrl} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{account.name}</h1>
          <p className="text-sm text-muted">
            {account.summary.bets} bet{account.summary.bets === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <ProfitPage initial={profile.bets} title={`${account.name}'s profit`} readOnly />
    </div>
  );
}
