"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { CheckCircle2, Clock, ImagePlus, Loader2, Plus, RefreshCw, ScanText, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import type { ScreenshotDTO } from "@/lib/types";
import { api, uploadWithProgress } from "@/lib/client-api";
import { useSettings } from "@/components/SettingsProvider";
import { useNotifications } from "@/components/NotificationProvider";
import { ReminderPicker } from "@/components/ReminderPicker";
import { CandidateForm } from "./CandidateForm";
import {
  candidatesFromExtraction,
  resolveShotTimes,
  candidateToPayload,
  emptyCandidate,
  mergeCandidates,
  validateCandidate,
  type Candidate,
  type ScreenshotContext,
} from "@/lib/review/candidate";
import { suggestMerges } from "@/lib/matching/dedupe";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { useNow } from "@/components/useNow";
import type { SettingsDTO } from "@/lib/validation/settings";

type Phase = "queued" | "uploading" | "uploaded" | "scanning" | "scanned" | "error";

interface UploadItem {
  key: string;
  file: File;
  previewUrl: string;
  progress: number;
  phase: Phase;
  error: string | null;
  screenshot: ScreenshotDTO | null;
  /** When the current Gemini scan started (for the elapsed-time counter). */
  scanStartedAt?: number;
}

const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
const UPLOAD_CONCURRENCY = 3;
const SCAN_CONCURRENCY = 2;

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift()!;
      await fn(next);
    }
  });
  await Promise.all(workers);
}

function shotContext(s: ScreenshotDTO): ScreenshotContext {
  return {
    id: s.id,
    capturedAt: s.capturedAt,
    capturedAtSource: s.capturedAtSource,
    visibleClock: s.extraction?.result.visibleClock ?? null,
    timezoneText: s.extraction?.result.timezoneText ?? null,
  };
}

/** Re-resolve start times (in row order) for the candidates of the given screenshots. */
function reresolve(prev: Candidate[], shots: Map<string, ScreenshotContext>, settings: SettingsDTO): Candidate[] {
  const updated = new Map<string, Candidate>();
  for (const [shotId, ctx] of shots) {
    const own = prev.filter((c) => c.timeSourceId === shotId && !c.result);
    for (const c of resolveShotTimes(own, ctx, settings)) updated.set(c.id, c);
  }
  return prev.map((c) => updated.get(c.id) ?? c);
}

const SOURCE_LABEL: Record<string, string> = {
  EXIF: "from photo metadata",
  FILE_MODIFIED: "from file date (unverified)",
  MANUAL: "entered by you",
  NONE: "unknown",
};

export function UploadReview() {
  const { settings, update: updateSettings } = useSettings();
  const { notify } = useNotifications();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [bulkReminder, setBulkReminder] = useState(settings.defaultReminderMinutes);
  const browserTz = useBrowserTimeZone();
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Release object URLs on unmount.
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.previewUrl)), []);

  const patchItem = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }, []);

  const uploadOne = useCallback(
    async (item: UploadItem) => {
      patchItem(item.key, { phase: "uploading", progress: 0, error: null });
      const form = new FormData();
      form.append("file", item.file);
      form.append("lastModified", String(item.file.lastModified || ""));
      try {
        const res = await uploadWithProgress<{ screenshot: ScreenshotDTO }>("/api/screenshots", form, (p) => patchItem(item.key, { progress: p }));
        patchItem(item.key, { phase: "uploaded", progress: 1, screenshot: res.screenshot });
        return res.screenshot;
      } catch (err) {
        patchItem(item.key, { phase: "error", error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },
    [patchItem],
  );

  // Scanning starts automatically after each upload (no extra click).
  // A ref is used because scanOne is defined further down.
  const scanOneRef = useRef<((item: UploadItem, force: boolean) => Promise<void>) | null>(null);
  const autoScan = settings.geminiKeySource !== "none";
  const uploadAndScan = useCallback(
    async (item: UploadItem) => {
      const shot = await uploadOne(item);
      if (shot && autoScan && scanOneRef.current) await scanOneRef.current({ ...item, screenshot: shot }, false);
    },
    [uploadOne, autoScan],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const accepted = list.filter((f) => ACCEPT.includes(f.type) || /\.(png|jpe?g|webp|heic|heif)$/i.test(f.name));
      if (accepted.length < list.length) notify("Some files were skipped", "Only PNG, JPEG, WebP and HEIC images are supported.");
      const newItems: UploadItem[] = accepted.map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        phase: "queued",
        error: null,
        screenshot: null,
      }));
      setItems((prev) => [...prev, ...newItems]);
      void runPool(newItems, UPLOAD_CONCURRENCY, uploadAndScan);
    },
    [notify, uploadAndScan],
  );

  // Paste screenshots straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const buildCandidates = useCallback(
    (shot: ScreenshotDTO) => {
      if (!shot.extraction) return;
      const ctx = shotContext(shot);
      const fresh = candidatesFromExtraction(shot.extraction.result.matches, ctx, settings);
      setCandidates((prev) => [
        // Replace candidates that came only from this screenshot (rescan).
        ...prev.filter((c) => !(c.screenshotIds.length === 1 && c.screenshotIds[0] === shot.id && !c.result)),
        ...fresh,
      ]);
    },
    [settings],
  );

  const scanOne = useCallback(
    async (item: UploadItem, force: boolean) => {
      const shot = item.screenshot;
      if (!shot) return;
      if (shot.extraction && !force) {
        patchItem(item.key, { phase: "scanned" });
        buildCandidates(shot);
        return;
      }
      patchItem(item.key, { phase: "scanning", error: null, scanStartedAt: Date.now() });
      try {
        const res = await api<{ screenshot: ScreenshotDTO }>(`/api/screenshots/${shot.id}/extract`, { method: "POST" });
        patchItem(item.key, { phase: "scanned", screenshot: res.screenshot });
        buildCandidates(res.screenshot);
      } catch (err) {
        patchItem(item.key, { phase: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },
    [buildCandidates, patchItem],
  );
  useEffect(() => {
    scanOneRef.current = scanOne;
  }, [scanOne]);

  const scanAll = async () => {
    const pending = items.filter((i) => i.phase === "uploaded" || (i.phase === "error" && i.screenshot));
    if (!pending.length) return;
    setScanning(true);
    await runPool(pending, SCAN_CONCURRENCY, (i) => scanOne(i, false));
    setScanning(false);
  };

  const removeItem = (key: string) => {
    const item = items.find((i) => i.key === key);
    if (item) URL.revokeObjectURL(item.previewUrl);
    setItems((prev) => prev.filter((i) => i.key !== key));
    if (item?.screenshot) {
      const id = item.screenshot.id;
      setCandidates((prev) => prev.filter((c) => !(c.screenshotIds.length === 1 && c.screenshotIds[0] === id)));
    }
  };

  const setCaptureTime = async (item: UploadItem, iso: string | null) => {
    if (!item.screenshot) return;
    try {
      const res = await api<{ screenshot: ScreenshotDTO }>(`/api/screenshots/${item.screenshot.id}`, { method: "PATCH", json: { capturedAt: iso } });
      // Keep the extraction we already have in memory.
      const updated = { ...res.screenshot, extraction: res.screenshot.extraction ?? item.screenshot.extraction };
      patchItem(item.key, { screenshot: updated });
      const ctx = shotContext(updated);
      setCandidates((prev) => reresolve(prev, new Map([[updated.id, ctx]]), settings));
    } catch (err) {
      notify("Could not save capture time", err instanceof Error ? err.message : String(err));
    }
  };

  const patchCandidate = (id: string, patch: Partial<Candidate>) =>
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch, result: patch.result !== undefined ? patch.result : c.result?.status === "similar" ? c.result : null } : c)));

  const merge = (primaryId: string, secondaryId: string) => {
    setCandidates((prev) => {
      const a = prev.find((c) => c.id === primaryId);
      const b = prev.find((c) => c.id === secondaryId);
      if (!a || !b) return prev;
      const merged = mergeCandidates(a, b);
      return prev.filter((c) => c.id !== secondaryId).map((c) => (c.id === primaryId ? merged : c));
    });
  };

  // Re-resolve times when the timezone/date-order settings change.
  const settingsKey = `${settings.timezone}|${settings.timezoneConfirmed}|${settings.dateOrder}|${settings.screenshotsAreToday}|${settings.screenshotTimesAreLocal}`;
  const lastSettingsKey = useRef(settingsKey);
  useEffect(() => {
    if (lastSettingsKey.current === settingsKey) return;
    lastSettingsKey.current = settingsKey;
    const shots = new Map(itemsRef.current.filter((i) => i.screenshot).map((i) => [i.screenshot!.id, shotContext(i.screenshot!)]));
    setCandidates((prev) => reresolve(prev, shots, settings));
  }, [settingsKey, settings]);

  const openCandidates = candidates.filter((c) => c.result?.status !== "created");
  const selected = openCandidates.filter((c) => c.include);
  const validations = useMemo(() => new Map(candidates.map((c) => [c.id, validateCandidate(c, settings.timezone)])), [candidates, settings.timezone]);
  const invalidCount = selected.filter((c) => !validations.get(c.id)?.ok).length;

  const suggestions = useMemo(() => {
    const list = suggestMerges(
      openCandidates.map((c) => ({
        id: c.id,
        sourceId: c.screenshotIds.join(","),
        player1: c.player1 || null,
        player2: c.player2 || null,
        startsAt: fromLocalInputValue(c.startsAtLocal, settings.timezone),
      })),
    );
    return list.filter((s) => !dismissed.has(s.ids.join("|")));
  }, [openCandidates, dismissed, settings.timezone]);

  const createAlarms = async () => {
    if (!selected.length) return;
    if (invalidCount) {
      setShowErrors(true);
      notify("Please fix the highlighted fields", `${invalidCount} match(es) need attention before alarms can be created.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<{
        results: { index: number; status: "created" | "duplicate" | "similar" | "invalid"; message?: string; existingId?: string; match?: { id: string }; immediate?: boolean }[];
        created: number;
      }>("/api/matches", { method: "POST", json: { matches: selected.map((c) => candidateToPayload(c, settings.timezone)) } });
      const byId = new Map<string, Candidate["result"]>();
      res.results.forEach((r) => {
        const c = selected[r.index];
        byId.set(c.id, {
          status: r.status,
          message: r.status === "created" ? (r.immediate ? "reminder time already passed - notifying now" : undefined) : r.message,
          matchId: r.match?.id ?? r.existingId,
        });
      });
      setCandidates((prev) => prev.map((c) => (byId.has(c.id) ? { ...c, result: byId.get(c.id)! } : c)));
      const failed = res.results.length - res.created;
      notify(
        res.created ? `${res.created} alarm${res.created === 1 ? "" : "s"} created` : "No alarms created",
        failed ? `${failed} match(es) need attention.` : "You'll be notified before each match.",
        res.created ? "/" : "",
      );
    } catch (err) {
      notify("Could not create alarms", err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const unscanned = items.filter((i) => i.phase === "uploaded" || (i.phase === "error" && i.screenshot)).length;
  const uploading = items.some((i) => i.phase === "uploading" || i.phase === "queued");
  const scannedItems = items.filter((i) => i.screenshot && (i.phase === "scanned" || i.phase === "scanning"));
  const createdCount = candidates.filter((c) => c.result?.status === "created").length;

  const labelFor = (c: Candidate) => `${c.player1 || "?"} vs ${c.player2 || "?"}`;

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Upload screenshots</h1>
        <p className="text-sm text-muted">Drop one or more screenshots. Gemini reads the matches, you review them, and alarms are created.</p>
      </div>

      {settings.geminiKeySource === "none" && (
        <div className="card flex flex-wrap items-center gap-2 border-under/40 bg-under/5 px-3 py-2 text-sm">
          <TriangleAlert className="h-4 w-4 text-under" />
          <span className="flex-1">Add your Gemini API key in Settings before scanning screenshots.</span>
          <Link href="/settings" className="btn-primary py-1 text-xs">
            Open Settings
          </Link>
        </div>
      )}

      {!settings.timezoneConfirmed && browserTz && (
        <div className="card flex flex-wrap items-center gap-2 border-warn/40 bg-warn/5 px-3 py-2 text-sm">
          <TriangleAlert className="h-4 w-4 text-warn" />
          <span className="flex-1">
            Your timezone ({settings.timezone}) is not confirmed, so every time will need manual confirmation.
          </span>
          <button
            className="btn-primary py-1 text-xs"
            onClick={() => void updateSettings({ timezone: browserTz, timezoneConfirmed: true })}
          >
            Use {browserTz}
          </button>
        </div>
      )}

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={`card flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? "border-accent bg-accent/5" : "border-line hover:border-muted/50"
        }`}
      >
        <ImagePlus className="h-8 w-8 text-accent" />
        <p className="text-sm font-medium">Drag & drop screenshots here, or tap to choose</p>
        <p className="text-xs text-muted">PNG, JPEG, WebP or HEIC · up to 8 MB each · you can also paste (Ctrl/⌘+V)</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Thumbnails + progress */}
      {items.length > 0 && (
        <div className="card p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Screenshots ({items.length})</h2>
            <div className="ml-auto flex gap-2">
              <button className="btn-primary" disabled={!unscanned || scanning || uploading} onClick={() => void scanAll()}>
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
                {scanning ? "Scanning…" : `Scan Screenshots${unscanned ? ` (${unscanned})` : ""}`}
              </button>
            </div>
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
            {items.map((item) => (
              <li key={item.key} className="relative overflow-hidden rounded-lg border border-line bg-bg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.previewUrl} alt={item.file.name} className="aspect-[3/4] w-full object-cover object-top" />
                <button
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => removeItem(item.key)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="absolute inset-x-0 bottom-0 bg-black/75 px-1.5 py-1">
                  <PhaseLabel item={item} />
                  {(item.phase === "uploading" || item.phase === "queued") && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
                      <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </div>
                  )}
                  {item.phase === "scanning" && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
                      <div className="h-full w-1/3 animate-[pulse_1s_ease-in-out_infinite] bg-accent" />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {items
            .filter((i) => i.phase === "error")
            .map((item) => (
              <div key={`err-${item.key}`} className="mt-2 flex items-start gap-2 rounded-lg bg-under/10 px-3 py-2 text-xs text-under">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">
                  <b>{item.file.name}:</b> {item.error}
                </span>
                <button
                  className="btn-ghost shrink-0 px-2 py-1 text-xs"
                  disabled={scanning}
                  onClick={() => void (item.screenshot ? scanOne(item, true) : uploadOne(item))}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Merge suggestions */}
      {suggestions.length > 0 && (
        <div className="card border-accent/40 bg-accent/5 p-3">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-accent" /> Possible same match in different screenshots
          </h2>
          <p className="mb-2 text-xs text-muted">Combining fills missing fields from the other screenshot. Nothing is combined unless you confirm.</p>
          <ul className="space-y-1.5">
            {suggestions.map((s) => {
              const a = candidates.find((c) => c.id === s.ids[0]);
              const b = candidates.find((c) => c.id === s.ids[1]);
              if (!a || !b) return null;
              return (
                <li key={s.ids.join("|")} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1">
                    <b>{labelFor(a)}</b> and <b>{labelFor(b)}</b>
                    <span className="text-xs text-muted"> — {s.reason}</span>
                  </span>
                  <button className="btn-primary py-1 text-xs" onClick={() => merge(a.id, b.id)}>
                    Combine
                  </button>
                  <button className="btn-ghost py-1 text-xs" onClick={() => setDismissed((d) => new Set(d).add(s.ids.join("|")))}>
                    Keep separate
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Review: screenshot beside extracted data */}
      {scannedItems.map((item) => {
        const shot = item.screenshot!;
        const own = candidates.filter((c) => c.screenshotIds[0] === shot.id);
        const ex = shot.extraction;
        return (
          <section key={item.key} className="card overflow-hidden">
            <div className="grid gap-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="border-b border-line bg-bg p-2 md:border-b-0 md:border-r">
                <div className="md:sticky md:top-14">
                  <a href={shot.imageUrl} target="_blank" rel="noreferrer" title="Open full size">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.previewUrl} alt={shot.filename} className="max-h-[70vh] w-full rounded-lg object-contain" />
                  </a>
                  <p className="mt-1 truncate text-center text-[11px] text-muted">{shot.filename}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {item.phase === "scanning" ? (
                    <span className="flex items-center gap-1.5 text-sm text-accent">
                      <Loader2 className="h-4 w-4 animate-spin" /> Gemini is reading this screenshot… <Elapsed since={item.scanStartedAt} />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-over" /> {ex?.result.matches.length ?? 0} match(es) detected
                      {ex?.result.layout && <span className="text-xs text-muted">· {ex.result.layout}</span>}
                    </span>
                  )}
                  <button className="btn-ghost ml-auto px-2 py-1 text-xs" disabled={item.phase === "scanning"} onClick={() => void scanOne(item, true)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Rescan
                  </button>
                </div>

                {item.screenshot?.duplicate && (
                  <p className="text-xs text-muted">This screenshot was uploaded before; showing the earlier scan. Use Rescan to read it again.</p>
                )}

                <CaptureTimeEditor item={item} timezone={settings.timezone} onSave={(iso) => void setCaptureTime(item, iso)} />

                {(() => {
                  const unconfirmed = own.filter((c) => !c.result && c.include && c.startsAtLocal && !c.timeConfirmed);
                  if (unconfirmed.length < 2) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn/10 px-2.5 py-2 text-xs text-warn">
                      <span className="flex-1">{unconfirmed.length} start times need a quick check (shown in amber below).</span>
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() => {
                          const ids = new Set(unconfirmed.map((c) => c.id));
                          setCandidates((prev) => prev.map((c) => (ids.has(c.id) ? { ...c, timeConfirmed: true } : c)));
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> I checked them - confirm all {unconfirmed.length}
                      </button>
                    </div>
                  );
                })()}

                {ex && ex.warnings.length > 0 && (
                  <details className="rounded-lg bg-warn/10 px-2 py-1.5 text-xs text-warn">
                    <summary className="cursor-pointer">{ex.warnings.length} value(s) were discarded during validation</summary>
                    <ul className="mt-1 list-disc pl-4">
                      {ex.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {own.length === 0 && item.phase === "scanned" && (
                  <p className="rounded-lg bg-panel-2 px-3 py-4 text-center text-sm text-muted">
                    No matches found in this screenshot. You can add one manually or combine its data with another screenshot.
                  </p>
                )}

                {own.map((c, idx) => (
                  <CandidateForm
                    key={c.id}
                    candidate={c}
                    index={idx}
                    validation={validations.get(c.id)!}
                    timezone={settings.timezone}
                    showErrors={showErrors && c.include}
                    mergeTargets={openCandidates.filter((o) => o.id !== c.id).map((o) => ({ id: o.id, label: labelFor(o) }))}
                    onChange={(patch) => patchCandidate(c.id, patch)}
                    onRemove={() => setCandidates((prev) => prev.filter((x) => x.id !== c.id))}
                    onMergeInto={(targetId) => merge(targetId, c.id)}
                  />
                ))}

                <button className="btn-ghost self-start py-1 text-xs" onClick={() => setCandidates((prev) => [...prev, emptyCandidate(shot.id, settings)])}>
                  <Plus className="h-3.5 w-3.5" /> Add match manually
                </button>
              </div>
            </div>
          </section>
        );
      })}

      {/* Sticky action bar */}
      {(openCandidates.length > 0 || createdCount > 0) && (
        <div className="fixed inset-x-0 bottom-14 z-30 border-t border-line bg-bg/95 px-3 py-2 backdrop-blur sm:bottom-0">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Reminder for all:</span>
              <ReminderPicker
                compact
                value={bulkReminder}
                onChange={(m) => {
                  setBulkReminder(m);
                  setCandidates((prev) => prev.map((c) => (c.result?.status === "created" ? c : { ...c, reminderMinutes: m })));
                }}
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {createdCount > 0 && (
                <Link href="/" className="btn-ghost">
                  View dashboard ({createdCount})
                </Link>
              )}
              <button className="btn-primary" disabled={!selected.length || submitting} onClick={() => void createAlarms()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                Create {selected.length} alarm{selected.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
          {showErrors && invalidCount > 0 && (
            <p className="mx-auto mt-1 max-w-6xl text-xs text-under">{invalidCount} selected match(es) have errors — see the highlighted fields.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseLabel({ item }: { item: UploadItem }) {
  const text: Record<Phase, string> = {
    queued: "Waiting…",
    uploading: `Uploading ${Math.round(item.progress * 100)}%`,
    uploaded: item.screenshot?.extraction ? "Scanned before" : "Ready to scan",
    scanning: "Scanning…",
    scanned: `${item.screenshot?.extraction?.result.matches.length ?? 0} match(es)`,
    error: item.error ?? "Error",
  };
  return (
    <p className={`truncate text-[10px] font-medium ${item.phase === "error" ? "text-rose-300" : item.phase === "scanned" ? "text-emerald-300" : "text-white"}`} title={text[item.phase]}>
      {text[item.phase]}
    </p>
  );
}

function CaptureTimeEditor({ item, timezone, onSave }: { item: UploadItem; timezone: string; onSave: (iso: string | null) => void }) {
  const shot = item.screenshot!;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(toLocalInputValue(shot.capturedAt, timezone));
  const clock = shot.extraction?.result.visibleClock;
  return (
    <div className="rounded-lg bg-panel-2 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Screenshot taken:</span>
        <span className="font-medium">
          {shot.capturedAt ? DateTime.fromISO(shot.capturedAt).setZone(timezone).toFormat("ccc d LLL yyyy, HH:mm") : "unknown"}
        </span>
        <span className={`chip ${shot.capturedAtSource === "EXIF" || shot.capturedAtSource === "MANUAL" ? "bg-over/10 text-over" : "bg-warn/10 text-warn"}`}>
          {SOURCE_LABEL[shot.capturedAtSource]}
        </span>
        {clock && <span className="text-muted">· status bar clock {clock}</span>}
        <div className="ml-auto flex gap-1">
          <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => onSave(new Date().toISOString())} title="Use this if you took the screenshot just now">
            Taken just now
          </button>
          <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setEditing((e) => !e)}>
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-2 flex items-center gap-2">
          <input type="datetime-local" className="input w-auto py-1 text-xs" value={value} onChange={(e) => setValue(e.target.value)} />
          <button
            className="btn-primary px-2 py-1 text-xs"
            onClick={() => {
              onSave(fromLocalInputValue(value, timezone));
              setEditing(false);
            }}
          >
            Save
          </button>
          {shot.capturedAt && (
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onSave(null)}>
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted">Relative times like “Today” or “Starts in 45 minutes” are calculated from this capture time.</p>
    </div>
  );
}

/** Seconds since a scan started, updated every second. */
function Elapsed({ since }: { since?: number }) {
  const now = useNow();
  if (!since || !now) return null;
  return <span className="tabular text-xs text-muted">{Math.max(0, Math.round((now - since) / 1000))}s</span>;
}
