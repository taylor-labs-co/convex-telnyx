import { defineApp } from "convex/server";
import { v } from "convex/values";
import telnyx from "convex-telnyx/convex.config";
const app = defineApp({ env: { TELNYX_API_KEY: v.optional(v.string()) } });
app.use(telnyx, { env: { TELNYX_API_KEY: app.env.TELNYX_API_KEY } });
export default app;
