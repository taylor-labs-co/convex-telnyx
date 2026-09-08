import type TelnyxSDK from "telnyx";
import { requestTelnyx } from "../transport.js";
import {
  createFunctionHandle,
  httpActionGeneric,
  type GenericActionCtx,
  type GenericDataModel,
  type FunctionReference,
  type HttpRouter,
  type PaginationOptions,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import {
  messageStatus,
  jsonValue,
  type SendMessageParams,
  type DialParams,
  type CallCommand,
  type CallCommandParams,
  type VerificationChannel,
  type VerificationParams,
  type WebhookEvent,
} from "../shared.js";
import {
  readBody,
  verifyWebhook,
  WebhookVerificationError,
} from "./webhooks.js";
export { verifyWebhook, WebhookVerificationError } from "./webhooks.js";
export {
  callCommands,
  webhookEventValidator,
  sentMessageCallbackArgs,
} from "../shared.js";
export type {
  SendMessageParams,
  DialParams,
  CallCommand,
  CallCommandParams,
  VerificationChannel,
  VerificationParams,
  WebhookEvent,
} from "../shared.js";
export type { TelnyxSDK };
type QueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type MutationCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;
type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runMutation" | "runQuery"
>;
export interface OperationOptions {
  scope: string;
  idempotencyKey: string;
  /** Unix milliseconds; omitted means now. */ runAt?: number;
}
type ProviderActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runMutation" | "runAction"
>;
export type MessageSentHandler = FunctionReference<
  "mutation",
  "internal",
  { scope: string; operationId: string; message: any },
  unknown
>;
export type SendGroupMmsParams = Omit<
  Parameters<TelnyxSDK["messages"]["sendGroupMms"]>[0],
  "from"
> & { from?: string };
export interface SendOptions extends OperationOptions {
  /** null disables the default callback for this send. */ callback?: MessageSentHandler | null;
}
export class MessageSendError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly status: string,
    message: string,
  ) {
    super(message);
    this.name = "MessageSendError";
  }
}
export interface TelnyxOptions {
  defaultFrom?: string;
  defaultMessagingProfileId?: string;
  defaultOutgoingMessageCallback?: MessageSentHandler;
  /** Absolute HTTPS endpoint, or use CONVEX_SITE_URL plus webhookPath. */
  webhookUrl?: string;
  webhookPath?: string;
  /** Used only by direct verification/read helpers. Queued work reads the component's bound environment. */ apiKey?: string;
}
export interface WebhookOptions {
  path?: string;
  /** Resolve keys at request time to support rotation without redeploying. */
  publicKey: string | readonly string[] | (() => string | readonly string[]);
  /** Map VERIFIED events to a trusted tenant. Never take scope from client input. */
  scope:
    | string
    | ((
        ctx: GenericActionCtx<GenericDataModel>,
        event: WebhookEvent,
      ) => Promise<string>);
  onEvent?: FunctionReference<
    "mutation",
    "internal",
    { scope: string; event: WebhookEvent },
    unknown
  >;
}
/** Durable Telnyx operations and reactive state. Authenticate and derive scope in your app. */
export class Telnyx {
  constructor(
    public readonly component: ComponentApi,
    private readonly options: TelnyxOptions = {},
  ) {}
  private request(path: string, body?: unknown) {
    return requestTelnyx(
      this.options.apiKey ?? process.env.TELNYX_API_KEY,
      path,
      body === undefined ? "GET" : "POST",
      body,
    );
  }
  private routePath() {
    return (
      this.options.webhookPath ??
      (this.options.webhookUrl
        ? new URL(this.options.webhookUrl).pathname
        : "/telnyx/webhook")
    );
  }
  getWebhookUrl(): string {
    const base = process.env.CONVEX_SITE_URL;
    const url =
      this.options.webhookUrl ??
      (base ? base.replace(/\/$/, "") + this.routePath() : undefined);
    if (!url)
      throw new Error("Set CONVEX_SITE_URL or the Telnyx webhookUrl option");
    if (new URL(url).protocol !== "https:")
      throw new Error(
        "Telnyx webhooks need a public HTTPS URL; set webhookUrl to your tunnel for local development",
      );
    return url;
  }
  private messageParams<
    T extends {
      from?: string;
      messaging_profile_id?: string;
      webhook_url?: string;
      use_profile_webhooks?: boolean;
    },
  >(params: T): T {
    return jsonValue({
      ...params,
      // Explicit number-pool selection must not accidentally acquire the default sender.
      from:
        params.from ??
        (params.messaging_profile_id ? undefined : this.options.defaultFrom),
      messaging_profile_id:
        params.messaging_profile_id ?? this.options.defaultMessagingProfileId,
      webhook_url:
        params.webhook_url ??
        (params.use_profile_webhooks ? undefined : this.getWebhookUrl()),
    });
  }
  private async enqueue(
    ctx: MutationCtx,
    method: string,
    request: unknown,
    options: SendOptions,
    target?: string,
    immediate = false,
  ): Promise<string> {
    const send = [
      "messages.send",
      "messages.sendGroupMms",
      "messages.schedule",
    ].includes(method);
    const callback = send
      ? options.callback === undefined
        ? this.options.defaultOutgoingMessageCallback
        : options.callback
      : undefined;
    const callbackHandle = callback
      ? await createFunctionHandle(callback)
      : undefined;
    return ctx.runMutation(
      this.component.operations.enqueue,
      jsonValue({
        scope: options.scope,
        key: options.idempotencyKey,
        method,
        request,
        target,
        runAt: options.runAt,
        callback: callbackHandle,
        immediate,
      }),
    );
  }
  sendMessage(
    ctx: MutationCtx,
    params: SendMessageParams,
    options: SendOptions,
  ) {
    return this.enqueue(
      ctx,
      "messages.send",
      this.messageParams(params),
      options,
    );
  }
  sendGroupMms(
    ctx: MutationCtx,
    params: SendGroupMmsParams,
    options: SendOptions,
  ) {
    return this.enqueue(
      ctx,
      "messages.sendGroupMms",
      this.messageParams(params),
      options,
    );
  }
  scheduleMessage(
    ctx: MutationCtx,
    params: Parameters<TelnyxSDK["messages"]["schedule"]>[0],
    options: SendOptions,
  ) {
    return this.enqueue(
      ctx,
      "messages.schedule",
      this.messageParams(params),
      options,
    );
  }
  /** Immediate submission from an action. Confirmed retries return the stored provider message. */
  async sendMessageNow(
    ctx: ActionCtx & Pick<GenericActionCtx<GenericDataModel>, "runAction">,
    params: SendMessageParams,
    options: Omit<SendOptions, "runAt">,
  ): Promise<
    NonNullable<Awaited<ReturnType<TelnyxSDK["messages"]["send"]>>["data"]>
  > {
    const id = await this.enqueue(
      ctx,
      "messages.send",
      this.messageParams(params),
      options,
      undefined,
      true,
    );
    const operation = await ctx.runAction(this.component.worker.sendNow, {
      scope: options.scope,
      id,
    });
    if (operation.status !== "succeeded" || !operation.result)
      throw new MessageSendError(
        id,
        operation.status,
        operation.error?.message ??
          "Immediate send is pending, canceled, or its result was redacted. It was not resent.",
      );
    return operation.result;
  }
  cancelScheduledMessage(
    ctx: MutationCtx,
    messageId: string,
    options: OperationOptions,
  ) {
    return this.enqueue(
      ctx,
      "messages.cancelScheduled",
      {},
      options,
      messageId,
    );
  }
  dial(ctx: MutationCtx, params: DialParams, options: OperationOptions) {
    return this.enqueue(ctx, "calls.dial", params, options);
  }
  callCommand<C extends CallCommand>(
    ctx: MutationCtx,
    callControlId: string,
    command: C,
    params: CallCommandParams<C>,
    options: OperationOptions,
  ) {
    return this.enqueue(
      ctx,
      `calls.${command}`,
      params,
      options,
      callControlId,
    );
  }
  startVerification<C extends VerificationChannel>(
    ctx: MutationCtx,
    channel: C,
    params: VerificationParams[C],
    options: OperationOptions,
  ) {
    return this.enqueue(ctx, `verification.${channel}`, params, options);
  }
  /** Check codes only from authenticated, rate-limited actions. Codes are never persisted by this helper. */
  async checkVerification(
    ctx: ActionCtx,
    args: { scope: string; verificationId: string; code: string },
  ) {
    const own = await this.getVerification(
      ctx,
      args.scope,
      args.verificationId,
    );
    if (!own) throw new Error("Verification not found in scope");
    const response = await this.request(
      `/verifications/${encodeURIComponent(args.verificationId)}/actions/verify`,
      { code: args.code },
    );
    const data = jsonValue(response.data ?? {});
    await ctx.runMutation(
      this.component.resources.sync,
      jsonValue({
        scope: args.scope,
        kind: "verification",
        externalId: args.verificationId,
        status: (data as { status?: string }).status,
        at: Date.now(),
        data,
      }),
    );
    return data;
  }
  async refreshMessage(ctx: ActionCtx, scope: string, messageId: string) {
    if (!(await this.getMessage(ctx, scope, messageId)))
      throw new Error("Message not found in scope");
    const data = jsonValue(
      (await this.request(`/messages/${encodeURIComponent(messageId)}`)).data ??
        {},
    );
    await ctx.runMutation(
      this.component.resources.sync,
      jsonValue({
        scope,
        kind: "message",
        externalId: messageId,
        status: messageStatus(data),
        at: Date.now(),
        data,
      }),
    );
    return data;
  }
  /** Provider read only; query results are not persisted automatically. */
  lookupNumber(phoneNumber: string) {
    return this.request(`/number_lookup/${encodeURIComponent(phoneNumber)}`);
  }
  getOperation(ctx: QueryCtx, scope: string, id: string) {
    return ctx.runQuery(this.component.operations.get, { scope, id });
  }
  listOperations(
    ctx: QueryCtx,
    scope: string,
    paginationOpts: PaginationOptions,
  ) {
    return ctx.runQuery(this.component.operations.list, {
      scope,
      paginationOpts,
    });
  }
  cancelOperation(ctx: MutationCtx, scope: string, id: string) {
    return ctx.runMutation(this.component.operations.cancel, { scope, id });
  }
  getMessage(ctx: QueryCtx, scope: string, messageId: string) {
    return ctx.runQuery(this.component.resources.get, {
      scope,
      kind: "message",
      externalId: messageId,
    });
  }
  getCall(ctx: QueryCtx, scope: string, callControlId: string) {
    return ctx.runQuery(this.component.resources.get, {
      scope,
      kind: "call",
      externalId: callControlId,
    });
  }
  getVerification(ctx: QueryCtx, scope: string, verificationId: string) {
    return ctx.runQuery(this.component.resources.get, {
      scope,
      kind: "verification",
      externalId: verificationId,
    });
  }
  listMessages(
    ctx: QueryCtx,
    scope: string,
    paginationOpts: PaginationOptions,
  ) {
    return ctx.runQuery(this.component.resources.list, {
      scope,
      kind: "message",
      paginationOpts,
    });
  }
  listCalls(ctx: QueryCtx, scope: string, paginationOpts: PaginationOptions) {
    return ctx.runQuery(this.component.resources.list, {
      scope,
      kind: "call",
      paginationOpts,
    });
  }
  listVerifications(
    ctx: QueryCtx,
    scope: string,
    paginationOpts: PaginationOptions,
  ) {
    return ctx.runQuery(this.component.resources.list, {
      scope,
      kind: "verification",
      paginationOpts,
    });
  }
  listEvents(
    ctx: QueryCtx,
    scope: string,
    paginationOpts: PaginationOptions,
    resourceId?: string,
  ) {
    return ctx.runQuery(
      this.component.events.list,
      jsonValue({ scope, paginationOpts, resourceId }),
    );
  }
  redriveEvent(ctx: MutationCtx, scope: string, id: string) {
    return ctx.runMutation(this.component.events.redrive, { scope, id });
  }
  listIncoming(
    ctx: QueryCtx,
    scope: string,
    paginationOpts: PaginationOptions,
  ) {
    return ctx.runQuery(this.component.messages.listByDirection, {
      scope,
      direction: "inbound",
      paginationOpts,
    });
  }
  listOutgoing(
    ctx: QueryCtx,
    scope: string,
    paginationOpts: PaginationOptions,
  ) {
    return ctx.runQuery(this.component.messages.listByDirection, {
      scope,
      direction: "outbound",
      paginationOpts,
    });
  }
  getMessagesTo(
    ctx: QueryCtx,
    scope: string,
    to: string,
    paginationOpts: PaginationOptions,
  ) {
    return ctx.runQuery(this.component.messages.listByAddress, {
      scope,
      role: "to",
      address: to,
      paginationOpts,
    });
  }
  getMessagesFrom(
    ctx: QueryCtx,
    scope: string,
    from: string,
    paginationOpts: PaginationOptions,
  ) {
    return ctx.runQuery(this.component.messages.listByAddress, {
      scope,
      role: "from",
      address: from,
      paginationOpts,
    });
  }
  getMessagesByCounterparty(
    ctx: QueryCtx,
    scope: string,
    counterparty: string,
    paginationOpts: PaginationOptions,
  ) {
    return ctx.runQuery(this.component.messages.listByAddress, {
      scope,
      role: "counterparty",
      address: counterparty,
      paginationOpts,
    });
  }
  redriveSendCallback(ctx: MutationCtx, scope: string, id: string) {
    return ctx.runMutation(this.component.callbacks.redrive, { scope, id });
  }
  backfillMessageIndexes(
    ctx: MutationCtx,
    scope: string,
    paginationOpts: PaginationOptions,
  ) {
    return ctx.runMutation(this.component.messages.backfillIndexes, {
      scope,
      paginationOpts,
    });
  }
  /** Authorize profile ownership first. This updates webhooks for ALL numbers sharing the profile. */
  async configureMessagingProfile(
    ctx: ProviderActionCtx,
    args: {
      scope: string;
      messagingProfileId?: string;
      webhookFailoverUrl?: string;
    },
  ) {
    const profileId =
      args.messagingProfileId ?? this.options.defaultMessagingProfileId;
    if (!args.scope.trim() || !profileId?.trim())
      throw new Error("scope and messagingProfileId are required");
    const webhookUrl = this.getWebhookUrl();
    if (
      args.webhookFailoverUrl &&
      new URL(args.webhookFailoverUrl).protocol !== "https:"
    )
      throw new Error("Failover URL must use HTTPS");
    await requestTelnyx(
      this.options.apiKey ?? process.env.TELNYX_API_KEY,
      `/messaging_profiles/${encodeURIComponent(profileId)}`,
      "PATCH",
      jsonValue({
        webhook_url: webhookUrl,
        webhook_api_version: "2",
        webhook_failover_url: args.webhookFailoverUrl,
      }),
    );
    await ctx.runMutation(
      this.component.configuration.saveProfile,
      jsonValue({
        scope: args.scope,
        externalId: profileId,
        webhookUrl,
        webhookFailoverUrl: args.webhookFailoverUrl,
      }),
    );
    return { messagingProfileId: profileId, webhookUrl };
  }
  /** Configure the existing number's messaging profile and attach it; does not purchase numbers. */
  async registerIncomingSmsHandler(
    ctx: ProviderActionCtx,
    args: {
      scope: string;
      phoneNumberId: string;
      messagingProfileId?: string;
      webhookFailoverUrl?: string;
    },
  ) {
    if (!args.scope.trim() || !args.phoneNumberId.trim())
      throw new Error("scope and phoneNumberId are required");
    let profileId =
      args.messagingProfileId ?? this.options.defaultMessagingProfileId;
    if (!profileId) {
      const current = await this.request(
        `/phone_numbers/${encodeURIComponent(args.phoneNumberId)}/messaging`,
      );
      profileId = current.data?.messaging_profile_id;
    }
    if (!profileId)
      throw new Error(
        "This number has no messaging profile; provide messagingProfileId",
      );
    const profile = await this.configureMessagingProfile(ctx, {
      ...args,
      messagingProfileId: profileId,
    });
    const response = await requestTelnyx(
      this.options.apiKey ?? process.env.TELNYX_API_KEY,
      `/phone_numbers/${encodeURIComponent(args.phoneNumberId)}/messaging`,
      "PATCH",
      { messaging_profile_id: profileId },
    );
    await ctx.runMutation(
      this.component.configuration.saveNumber,
      jsonValue({
        scope: args.scope,
        externalId: args.phoneNumberId,
        phoneNumber: response.data?.phone_number,
        messagingProfileId: profileId,
      }),
    );
    return { ...profile, phoneNumberId: args.phoneNumberId };
  }
  getMessagingProfile(ctx: QueryCtx, scope: string, id: string) {
    return ctx.runQuery(this.component.configuration.getProfile, {
      scope,
      externalId: id,
    });
  }
  getPhoneNumber(ctx: QueryCtx, scope: string, id: string) {
    return ctx.runQuery(this.component.configuration.getNumber, {
      scope,
      externalId: id,
    });
  }
  registerRoutes(http: HttpRouter, options: WebhookOptions) {
    if (options.path && options.path !== this.routePath())
      throw new Error(
        "Set the constructor webhookPath to match registerRoutes.path so automatic send callbacks use the same route",
      );
    http.route({
      path: this.routePath(),
      method: "POST",
      handler: httpActionGeneric(async (ctx, request) => {
        let body: string;
        try {
          body = await readBody(request);
        } catch {
          return new Response("Invalid or oversized body", { status: 413 });
        }
        const keys =
          typeof options.publicKey === "function"
            ? options.publicKey()
            : options.publicKey;
        if (!keys || (Array.isArray(keys) && !keys.length))
          return new Response("Webhook key is not configured", { status: 503 });
        let event: WebhookEvent;
        try {
          event = verifyWebhook(body, request.headers, keys);
        } catch (error) {
          if (error instanceof WebhookVerificationError)
            return new Response("Invalid webhook", { status: 401 });
          throw error;
        }
        const scope =
          typeof options.scope === "function"
            ? await options.scope(ctx, event)
            : options.scope;
        if (!scope.trim())
          return new Response("Unmapped webhook", { status: 422 });
        const handler = options.onEvent
          ? await createFunctionHandle(options.onEvent)
          : undefined;
        await ctx.runMutation(
          this.component.events.ingest,
          jsonValue({ scope, event, handler }),
        );
        return new Response(null, { status: 204 });
      }),
    });
  }
}
