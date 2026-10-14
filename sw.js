// Klar Glas intern – Service Worker nur für Push-Benachrichtigungen (kein Offline-Cache)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { text: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.titel || "Klar Glas", {
      body: d.text || "Neue Anfrage",
      icon: "icon-180.png?v=3",
      badge: "icon-180.png?v=3",
      tag: "anfrage",
      renotify: true,
      data: { url: d.url || "./#uebersicht" },
    })
  );
});

// Antippen: offenes Dashboard nach vorn holen, sonst neu öffnen. Das Popup zeigt dann die Anfrage.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const ziel = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenster) => {
      const offen = fenster.find((f) => f.url.startsWith(self.registration.scope));
      if (offen) return offen.focus().then((f) => f && f.navigate ? f.navigate(ziel) : f);
      return self.clients.openWindow(ziel);
    })
  );
});
