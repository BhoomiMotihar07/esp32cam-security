/**
 * IoT Hub ingest. The trigger reads the hub's built-in Event Hub-compatible endpoint.
 * The device identity is taken from the system property, never from the JSON body.
 */
import { app, type InvocationContext } from "@azure/functions";
import { ingestMessage } from "../domain/ingest.js";
import { getServices } from "../services.js";

interface SystemProps { "iothub-connection-device-id"?: string }

app.eventHub("iothub-ingest", {
  connection: "IOTHUB_EVENTHUB_CONNECTION",
  eventHubName: "%IOTHUB_EVENTHUB_NAME%",
  consumerGroup: "$Default",
  cardinality: "many",
  handler: async (messages: unknown[], context: InvocationContext) => {
    const svc = getServices();
    const sysProps = (context.triggerMetadata?.["systemPropertiesArray"] as SystemProps[] | undefined) ?? [];
    for (let i = 0; i < messages.length; i++) {
      const deviceId = sysProps[i]?.["iothub-connection-device-id"];
      if (!deviceId) { context.warn("message without device id skipped"); continue; }
      const body = typeof messages[i] === "string" ? safeJson(messages[i] as string) : messages[i];
      const result = await ingestMessage(svc, deviceId, body);
      if (!result.accepted) context.warn(`dropped message from ${deviceId}: ${result.reason}`);
    }
  },
});

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
