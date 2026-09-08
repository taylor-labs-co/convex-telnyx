"use node";
import { v } from "convex/values";
import { createTelnyxSDK } from "convex-telnyx/sdk";
import { internalAction } from "./convex/_generated/server.js";
// Official SDK access to everything beyond the component's managed APIs.
export const searchAvailableNumbers = internalAction({
  args: { countryCode: v.string() },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const sdk = createTelnyxSDK();
    const result = await sdk.availablePhoneNumbers.list({
      filter: { country_code: args.countryCode },
    });
    return JSON.parse(JSON.stringify(result));
  },
});
