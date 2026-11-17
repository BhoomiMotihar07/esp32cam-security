/* Service worker: makes the app installable and shows Web Push alerts.
   No precaching: evidence photos are signed URLs and the UI must stay fresh. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // required for installability; network-only

self.addEventListener("push", (event) => {
  let data = { title: "Home Security", body: "Alert", url: "/" };
  try { data = { ...data, ...event.data.json() }; } catch { /* non-JSON payload */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag,
      renotify: true,
      data: { url: data.url },
      vibrate: [200, 100, 200],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => "focus" in c);
      if (open) { open.navigate(url); return open.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
