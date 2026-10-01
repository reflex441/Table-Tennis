"use client";

/** Small fetch wrapper for client components. Throws ApiClientError on failure. */
export class ApiClientError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: unknown) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && typeof window !== "undefined" && err?.code === "unauthorized") {
      window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiClientError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? "http_error", err?.details);
  }
  return body as T;
}

/** Upload with progress reporting (fetch has no upload progress events). */
export function uploadWithProgress<T>(url: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as { error?: { message?: string; code?: string } } | null;
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve(body as T);
      } else {
        reject(new ApiClientError(body?.error?.message ?? `Upload failed (${xhr.status})`, xhr.status, body?.error?.code ?? "http_error"));
      }
    };
    xhr.onerror = () => reject(new ApiClientError("Network error during upload", 0, "network_error"));
    xhr.send(form);
  });
}
