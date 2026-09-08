import { defineComponent } from "convex/server";
import { v } from "convex/values";
import workpool from "@convex-dev/workpool/convex.config.js";
const component = defineComponent("telnyx", {
  env: { TELNYX_API_KEY: v.optional(v.string()) },
});
component.use(workpool);
component.use(workpool, { name: "voicePool" });
export default component;
