/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as callbacks from "../callbacks.js";
import type * as lifecycle from "../lifecycle.js";
import type * as lifecycleWorker from "../lifecycleWorker.js";
import type * as configuration from "../configuration.js";
import type * as events from "../events.js";
import type * as maintenance from "../maintenance.js";
import type * as messageIndex from "../messageIndex.js";
import type * as messages from "../messages.js";
import type * as operations from "../operations.js";
import type * as pool from "../pool.js";
import type * as resources from "../resources.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  callbacks: typeof callbacks;
  lifecycle: typeof lifecycle;
  lifecycleWorker: typeof lifecycleWorker;
  configuration: typeof configuration;
  events: typeof events;
  maintenance: typeof maintenance;
  messageIndex: typeof messageIndex;
  messages: typeof messages;
  operations: typeof operations;
  pool: typeof pool;
  resources: typeof resources;
  worker: typeof worker;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {
  workpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"workpool">;
  voicePool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"voicePool">;
};
