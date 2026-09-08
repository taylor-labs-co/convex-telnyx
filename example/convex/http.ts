import { httpRouter } from "convex/server";
import { internal } from "./_generated/api.js";
import { telnyx } from "./telnyx.js";
const http = httpRouter();
telnyx.registerRoutes(http, {
  publicKey: () => process.env.TELNYX_PUBLIC_KEY ?? "",
  scope: "demo-workspace",
  onEvent: internal.telnyx.onEvent,
});
export default http;
