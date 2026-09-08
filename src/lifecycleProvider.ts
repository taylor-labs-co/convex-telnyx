import type {
  NumberOrderCreateParams,
  NumberOrderWithPhoneNumbers,
} from "telnyx/resources/number-orders";
import type {
  MessagingProfile,
  MessagingProfileCreateParams,
} from "telnyx/resources/messaging-profiles/messaging-profiles";
import type { BrandRetrieveResponse } from "telnyx/resources/messaging-10dlc/brand/brand";
import type { TelnyxCampaignCsp } from "telnyx/resources/messaging-10dlc/campaign/campaign";
import type { PhoneNumberCampaign } from "telnyx/resources/messaging-10dlc/phone-number-campaigns";
import type { MessagingUpdateParams } from "telnyx/resources/phone-numbers/messaging";
import type { PhoneNumberCampaignCreateParams } from "telnyx/resources/messaging-10dlc/phone-number-campaigns";
import { requestTelnyx, TelnyxRequestError } from "./transport.js";

export type LifecycleRequest =
  | { kind: "profile"; name: string; webhookUrl: string }
  | { kind: "number"; phoneNumber: string; messagingProfileId: string }
  | { kind: "releaseNumber"; resourceId: string }
  | { kind: "deleteProfile"; resourceId: string }
  | {
      kind: "assignCampaign";
      resourceId: string;
      phoneNumber: string;
      campaignId: string;
      brandId: string;
    };

export type LifecycleResult = {
  status: "succeeded" | "pending" | "uncertain" | "failed";
  reference?: string;
  resourceId?: string;
  data?: any;
  noEffect?: boolean;
};

const call = (path: string, method = "GET", body?: unknown) =>
  requestTelnyx(process.env.TELNYX_API_KEY, path, method, body);
const id = encodeURIComponent;
const missing = (error: unknown) =>
  error instanceof TelnyxRequestError && error.status === 404;
async function getOrAbsent(path: string): Promise<any | null> {
  try {
    return await call(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

export async function lookupBrand(
  brandId: string,
): Promise<BrandRetrieveResponse> {
  return await call(`/10dlc/brand/${id(brandId)}`);
}
export async function lookupCampaign(
  campaignId: string,
): Promise<TelnyxCampaignCsp> {
  return await call(`/10dlc/campaign/${id(campaignId)}`);
}

// Recovery requires a complete, uniquely matching result, never a guessed first row.
async function unique<T>(
  path: string,
  matches: (row: T) => boolean,
): Promise<T | undefined> {
  const response = await call(`${path}&page[size]=250&page[number]=1`);
  if (
    !Array.isArray(response.data) ||
    response.meta?.total_pages !== 1 ||
    response.meta?.total_results !== response.data.length ||
    response.data.length >= 250
  )
    return;
  const rows = (response.data as T[]).filter(matches);
  return rows.length === 1 ? rows[0] : undefined;
}

/** One bounded provider step. Submitted creates are reconciled, never replayed. */
export async function advanceLifecycle(
  request: LifecycleRequest,
  reference: string | undefined,
  submitted: boolean,
  correlationId: string,
): Promise<LifecycleResult> {
  let mutationStarted = false;
  let initialPostInFlight = false;
  const previouslySubmitted = submitted || reference !== undefined;
  if (!process.env.TELNYX_API_KEY)
    return {
      status: "failed",
      noEffect: !previouslySubmitted,
      data: { reason: "missing_api_key" },
    };
  const preflightFailure = (reason: string): LifecycleResult => ({
    status: "failed",
    noEffect: !previouslySubmitted,
    data: { reason },
  });
  try {
    if (request.kind === "profile") {
      const name = `${request.name} [${correlationId}]`;
      let profile: MessagingProfile | undefined;
      if (reference) {
        const response = await getOrAbsent(
          `/messaging_profiles/${id(reference)}`,
        );
        if (!response) return { status: "uncertain", reference };
        profile = response.data;
      } else if (submitted) {
        profile = await unique<MessagingProfile>(
          `/messaging_profiles?filter[name][eq]=${id(name)}`,
          (row) => row.name === name,
        );
      } else {
        const body: MessagingProfileCreateParams = {
          name,
          webhook_url: request.webhookUrl,
          enabled: true,
          whitelisted_destinations: ["US"],
        };
        mutationStarted = true;
        initialPostInFlight = true;
        profile = (await call("/messaging_profiles", "POST", body)).data;
        initialPostInFlight = false;
      }
      reference = profile?.id ?? reference;
      if (
        !profile?.id ||
        profile.name !== name ||
        profile.webhook_url !== request.webhookUrl ||
        profile.enabled !== true
      )
        return { status: "uncertain", reference };
      return {
        status: "succeeded",
        reference,
        resourceId: profile.id,
        data: profile,
      };
    }
    if (request.kind === "number") {
      let order: NumberOrderWithPhoneNumbers | undefined;
      if (!reference && !submitted) {
        const body: NumberOrderCreateParams = {
          phone_numbers: [{ phone_number: request.phoneNumber }],
          messaging_profile_id: request.messagingProfileId,
          customer_reference: correlationId,
        };
        mutationStarted = true;
        initialPostInFlight = true;
        order = (await call("/number_orders", "POST", body)).data;
        initialPostInFlight = false;
        reference = order?.id;
        // Persist the order reference before doing any dependent writes.
        return {
          status: reference ? "pending" : "uncertain",
          reference,
          data: order,
        };
      }
      if (!reference) {
        order = await unique<NumberOrderWithPhoneNumbers>(
          `/number_orders?filter[customer_reference]=${id(correlationId)}`,
          (row) => row.customer_reference === correlationId,
        );
        reference = order?.id;
      }
      if (!reference) return { status: "uncertain" };
      const response = await getOrAbsent(`/number_orders/${id(reference)}`);
      if (!response) return { status: "uncertain", reference };
      order = response.data;
      const orderedNumber = order?.phone_numbers?.find(
        (row) => row.phone_number === request.phoneNumber,
      );
      if (
        order?.id !== reference ||
        order?.customer_reference !== correlationId ||
        !orderedNumber
      )
        return { status: "uncertain", reference };
      if (order.status === "failure" || orderedNumber.status === "failure")
        return { status: "failed", reference, data: order };
      if (order.status !== "success" || orderedNumber.status !== "success")
        return { status: "pending", reference, data: order };
      const owned = await unique<{ id: string; phone_number: string }>(
        `/phone_numbers?filter[phone_number]=${id(request.phoneNumber)}`,
        (row) => row.phone_number === request.phoneNumber,
      );
      if (!owned?.id) return { status: "pending", reference };
      const path = `/phone_numbers/${id(owned.id)}/messaging`;
      let settings = (await getOrAbsent(path))?.data;
      if (!settings)
        return { status: "pending", reference, resourceId: owned.id };
      if (settings?.messaging_profile_id !== request.messagingProfileId) {
        mutationStarted = true;
        const body: MessagingUpdateParams = {
          messaging_profile_id: request.messagingProfileId,
        };
        await call(path, "PATCH", body);
        settings = (await getOrAbsent(path))?.data;
      }
      return {
        status:
          settings?.messaging_profile_id === request.messagingProfileId
            ? "succeeded"
            : "pending",
        reference,
        resourceId: owned.id,
        data: settings,
      };
    }
    if (request.kind === "releaseNumber" || request.kind === "deleteProfile") {
      const path = `/${request.kind === "releaseNumber" ? "phone_numbers" : "messaging_profiles"}/${id(request.resourceId)}`;
      if ((await getOrAbsent(path)) === null)
        return { status: "succeeded", resourceId: request.resourceId };
      mutationStarted = true;
      try {
        await call(path, "DELETE");
      } catch (error) {
        if (!missing(error)) throw error;
      }
      return {
        status: (await getOrAbsent(path)) === null ? "succeeded" : "pending",
        resourceId: request.resourceId,
      };
    }
    const campaign = await lookupCampaign(request.campaignId);
    if (
      campaign.brandId !== request.brandId ||
      campaign.campaignId !== request.campaignId
    )
      return preflightFailure("campaign_brand_mismatch");
    // ACTIVE is the default for new campaigns, not evidence of carrier approval.
    if (
      campaign.status !== "ACTIVE" ||
      campaign.campaignStatus !== "MNO_PROVISIONED"
    )
      return preflightFailure("campaign_not_approved");
    const brand = await lookupBrand(request.brandId);
    if (brand.brandId !== request.brandId)
      return preflightFailure("brand_mismatch");
    if (
      brand.identityStatus !== "VERIFIED" &&
      brand.identityStatus !== "VETTED_VERIFIED"
    )
      return preflightFailure("brand_not_verified");
    const owned = (await call(`/phone_numbers/${id(request.resourceId)}`)).data;
    if (owned?.phone_number !== request.phoneNumber)
      return preflightFailure("phone_number_mismatch");
    const path = `/10dlc/phone_number_campaigns/${id(request.phoneNumber)}`;
    let assignment: PhoneNumberCampaign | null = await getOrAbsent(path);
    if (!assignment && !submitted) {
      mutationStarted = true;
      const body: PhoneNumberCampaignCreateParams = {
        phoneNumber: request.phoneNumber,
        campaignId: request.campaignId,
      };
      initialPostInFlight = true;
      await call("/10dlc/phone_number_campaigns", "POST", body);
      initialPostInFlight = false;
      assignment = await getOrAbsent(path);
    }
    if (!assignment) return { status: "uncertain" };
    if (
      assignment.campaignId !== request.campaignId ||
      assignment.brandId !== request.brandId ||
      assignment.phoneNumber !== request.phoneNumber
    )
      return { status: "failed", data: { reason: "assignment_conflict" } };
    return {
      status:
        assignment.assignmentStatus === "ASSIGNED"
          ? "succeeded"
          : assignment.assignmentStatus?.startsWith("FAILED")
            ? "failed"
            : "pending",
      resourceId: request.resourceId,
      data: assignment,
    };
  } catch (error) {
    if (!(error instanceof TelnyxRequestError)) throw error;
    const permanent =
      error.status !== undefined &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 409, 429].includes(error.status);
    return {
      status: permanent ? "failed" : mutationStarted ? "uncertain" : "pending",
      reference,
      ...(!previouslySubmitted &&
      (!mutationStarted || (permanent && initialPostInFlight))
        ? { noEffect: true }
        : {}),
    };
  }
}
