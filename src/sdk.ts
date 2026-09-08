import TelnyxSDK from "telnyx";
/** Import from convex-telnyx/sdk only inside a Node action module ("use node"). */
export function createTelnyxSDK(
  options: ConstructorParameters<typeof TelnyxSDK>[0] = {},
) {
  return new TelnyxSDK({ ...options, maxRetries: options?.maxRetries ?? 0 });
}
export { TelnyxSDK };
