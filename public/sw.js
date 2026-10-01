/* TT Alarms service worker: receives Web Push reminders and opens the match on click. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "TT Alarms", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Match reminder";
  // Computers: keep the notification on screen, re-alert on repeats and offer
  // "Bet placed" / "Skip" buttons. Phones: one normal notification.
  const ring = Boolean(data.requireAck);
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    // Same tag => the OS replaces rather than duplicates a notification.
    tag: data.tag || undefined,
    renotify: ring && Boolean(data.tag),
    requireInteraction: ring,
    silent: false,
    vibrate: ring ? [400, 150, 400, 150, 400] : [200, 100, 200],
    timestamp: Date.now(),
    actions: ring && data.alarmId
      ? [
          { action: "placed", title: "✅ Bet placed" },
          { action: "skip", title: "Skip" },
        ]
      : [],
    data: { url: data.url || "/", matchId: data.matchId || null, alarmId: data.alarmId || null },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Let open tabs refresh their in-app notification list immediately.
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: "push-received", tag: data.tag }));
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  // "Bet placed" / "Skip" buttons: confirm the alarm without opening the app.
  if ((event.action === "placed" || event.action === "skip") && data.alarmId) {
    event.waitUntil(
      (async () => {
        try {
          await fetch(`/api/alarms/${data.alarmId}/ack`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: event.action === "placed" ? "placed" : "skipped" }),
          });
        } catch (err) {
          console.warn("ack failed", err);
        }
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        clients.forEach((c) => c.postMessage({ type: "alarm-acknowledged", alarmId: data.alarmId }));
      })(),
    );
    return;
  }

  const target = new URL(data.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "navigate" in client) {
          await client.focus();
          return client.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

// If the browser rotates the push subscription, re-register it with the server.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch("/api/push/config");
        const config = await res.json();
        if (!config.publicKey) return;
        const padding = "=".repeat((4 - (config.publicKey.length % 4)) % 4);
        const raw = atob((config.publicKey + padding).replace(/-/g, "+").replace(/_/g, "/"));
        const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await fetch("/api/push/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch (err) {
        console.warn("pushsubscriptionchange failed", err);
      }
    })(),
  );
});
