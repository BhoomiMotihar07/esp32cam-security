/** Scheduled work: offline detection every minute, alert reminders every 30 s. */
import { app, type InvocationContext } from "@azure/functions";
import { checkOfflineDevices } from "../domain/offline.js";
import { repeatPendingAlerts } from "../domain/alerts.js";
import { getServices } from "../services.js";

app.timer("offline-check", {
  schedule: "0 * * * * *",
  handler: async (_timer, context: InvocationContext) => {
    const flagged = await checkOfflineDevices(getServices());
    if (flagged.length) context.log(`offline: ${flagged.join(", ")}`);
  },
});

app.timer("repeat-alerts", {
  schedule: "*/30 * * * * *",
  handler: async (_timer, context: InvocationContext) => {
    const sent = await repeatPendingAlerts(getServices());
    if (sent) context.log(`alert reminders sent: ${sent}`);
  },
});
