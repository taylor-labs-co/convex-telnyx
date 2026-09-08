import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceLifecycle,
  lookupBrand,
  lookupCampaign,
} from "../src/lifecycleProvider.js";

const fetchMock = vi.fn<typeof fetch>();
const correlation = "operation-1";
const profile = {
  kind: "profile" as const,
  name: "Messages",
  webhookUrl: "https://example.com/webhook",
};
const number = {
  kind: "number" as const,
  phoneNumber: "+12025550123",
  messagingProfileId: "profile-1",
};
const assignment = {
  kind: "assignCampaign" as const,
  resourceId: "number-1",
  phoneNumber: number.phoneNumber,
  campaignId: "campaign-1",
  brandId: "brand-1",
};
const savedProfile = {
  id: "profile-1",
  name: `Messages [${correlation}]`,
  webhook_url: profile.webhookUrl,
  enabled: true,
};
const savedOrder = {
  id: "order-1",
  customer_reference: correlation,
  status: "success",
  phone_numbers: [{ phone_number: number.phoneNumber, status: "success" }],
};
const campaign = {
  campaignId: "campaign-1",
  brandId: "brand-1",
  status: "ACTIVE",
  campaignStatus: "MNO_PROVISIONED",
};
const brand = { brandId: "brand-1", identityStatus: "VERIFIED" };
const assigned = {
  campaignId: "campaign-1",
  brandId: "brand-1",
  phoneNumber: number.phoneNumber,
  assignmentStatus: "ASSIGNED",
};
const list = (data: unknown[]) => ({
  data,
  meta: { total_pages: 1, total_results: data.length },
});
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}
function methods() {
  return fetchMock.mock.calls.map(([, options]) => options?.method);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TELNYX_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("lifecycle provider reconciliation", () => {
  it("fails missing credentials safely without erasing prior submission uncertainty", async () => {
    vi.stubEnv("TELNYX_API_KEY", "");
    expect(
      await advanceLifecycle(number, undefined, false, correlation),
    ).toMatchObject({ status: "failed", noEffect: true });
    expect(
      await advanceLifecycle(number, "order-1", true, correlation),
    ).toMatchObject({ status: "failed", noEffect: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("creates a correlated profile with server credentials", async () => {
    respond({ data: savedProfile });
    expect(
      await advanceLifecycle(profile, undefined, false, correlation),
    ).toMatchObject({ status: "succeeded", resourceId: "profile-1" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telnyx.com/v2/messaging_profiles");
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer test-key",
    });
    expect(JSON.parse(options!.body as string)).toMatchObject({
      name: savedProfile.name,
      webhook_url: profile.webhookUrl,
    });
  });

  it("recovers a submitted profile by exact correlated name without a POST", async () => {
    respond(list([savedProfile]));
    expect(
      await advanceLifecycle(profile, undefined, true, correlation),
    ).toMatchObject({ status: "succeeded", reference: "profile-1" });
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "filter[name][eq]=Messages%20%5Boperation-1%5D",
    );
    expect(methods()).toEqual(["GET"]);
  });

  it.each([
    list([]),
    list([savedProfile, { ...savedProfile, id: "duplicate" }]),
    { data: [savedProfile], meta: { total_pages: 2, total_results: 251 } },
    { data: [savedProfile] },
    { data: [savedProfile], meta: { total_pages: 1 } },
    list([{ ...savedProfile, webhook_url: "https://other.example" }]),
  ])("never replays an ambiguous submitted profile", async (response) => {
    respond(response);
    expect(
      await advanceLifecycle(profile, undefined, true, correlation),
    ).toMatchObject({ status: "uncertain" });
    expect(methods()).toEqual(["GET"]);
  });

  it("persists the order reference before dependent number writes", async () => {
    respond({ data: savedOrder });
    expect(
      await advanceLifecycle(number, undefined, false, correlation),
    ).toMatchObject({ status: "pending", reference: "order-1" });
    expect(methods()).toEqual(["POST"]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      phone_numbers: [{ phone_number: number.phoneNumber }],
      messaging_profile_id: "profile-1",
      customer_reference: correlation,
    });
  });

  it("does not hide purchase retries after a timeout", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(
      await advanceLifecycle(number, undefined, false, correlation),
    ).toEqual({ status: "uncertain", reference: undefined });
    respond(list([]));
    expect(
      await advanceLifecycle(number, undefined, true, correlation),
    ).toEqual({ status: "uncertain" });
    expect(methods()).toEqual(["POST", "GET"]);
  });

  it("recovers an order and confirms owned-number messaging assignment", async () => {
    respond(list([savedOrder]));
    respond({ data: savedOrder });
    respond(list([{ id: "number-1", phone_number: number.phoneNumber }]));
    respond({ data: { messaging_profile_id: null } });
    respond({ data: { messaging_profile_id: "profile-1" } });
    respond({ data: { messaging_profile_id: "profile-1" } });
    expect(
      await advanceLifecycle(number, undefined, true, correlation),
    ).toMatchObject({
      status: "succeeded",
      reference: "order-1",
      resourceId: "number-1",
    });
    expect(methods()).toEqual(["GET", "GET", "GET", "GET", "PATCH", "GET"]);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "filter[customer_reference]=operation-1",
    );
    expect(String(fetchMock.mock.calls[4]![0])).toContain(
      "/phone_numbers/number-1/messaging",
    );
  });

  it("waits for delayed orders without buying again", async () => {
    respond({ data: { ...savedOrder, status: "pending" } });
    expect(
      await advanceLifecycle(number, "order-1", true, correlation),
    ).toMatchObject({ status: "pending" });
    expect(methods()).toEqual(["GET"]);
  });

  it("rejects an unrelated recovered order", async () => {
    respond({ data: { ...savedOrder, customer_reference: "different" } });
    expect(
      await advanceLifecycle(number, "order-1", true, correlation),
    ).toMatchObject({ status: "uncertain" });
    expect(methods()).toEqual(["GET"]);
  });

  it("does not adopt a duplicate correlated order", async () => {
    respond(list([savedOrder, { ...savedOrder, id: "order-2" }]));
    expect(
      await advanceLifecycle(number, undefined, true, correlation),
    ).toEqual({ status: "uncertain" });
    expect(methods()).toEqual(["GET"]);
  });

  it("reports failed orders without another purchase", async () => {
    respond({ data: { ...savedOrder, status: "failure" } });
    expect(
      await advanceLifecycle(number, "order-1", true, correlation),
    ).toMatchObject({ status: "failed", reference: "order-1" });
    expect(methods()).toEqual(["GET"]);
  });

  it("does not trust a messaging PATCH until GET confirms it", async () => {
    respond({ data: savedOrder });
    respond(list([{ id: "number-1", phone_number: number.phoneNumber }]));
    respond({ data: { messaging_profile_id: null } });
    respond({ data: { messaging_profile_id: "profile-1" } });
    respond({ data: { messaging_profile_id: null } });
    expect(
      await advanceLifecycle(number, "order-1", true, correlation),
    ).toMatchObject({ status: "pending", reference: "order-1" });
    expect(methods()).toEqual(["GET", "GET", "GET", "PATCH", "GET"]);
  });

  it("recovers a timed-out deletion by checking absence first", async () => {
    const request = { kind: "releaseNumber" as const, resourceId: "number-1" };
    respond({ data: { id: "number-1" } });
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(
      await advanceLifecycle(request, undefined, false, correlation),
    ).toMatchObject({ status: "uncertain" });
    respond({}, 404);
    expect(
      await advanceLifecycle(request, undefined, true, correlation),
    ).toMatchObject({ status: "succeeded" });
    expect(methods()).toEqual(["GET", "DELETE", "GET"]);
  });

  it.each(["releaseNumber", "deleteProfile"] as const)(
    "confirms %s absence rather than trusting DELETE",
    async (kind) => {
      const request = { kind, resourceId: "resource-1" };
      respond({ data: { id: "resource-1" } });
      respond({ data: {} });
      respond({ data: { id: "resource-1" } });
      expect(
        await advanceLifecycle(request, undefined, false, correlation),
      ).toMatchObject({ status: "pending" });
      respond({}, 404);
      expect(
        await advanceLifecycle(request, undefined, true, correlation),
      ).toMatchObject({ status: "succeeded" });
      expect(methods()).toEqual(["GET", "DELETE", "GET", "GET"]);
    },
  );

  it("does not interpret authorization failure as deletion", async () => {
    respond({}, 403);
    expect(
      await advanceLifecycle(
        { kind: "releaseNumber", resourceId: "number-1" },
        undefined,
        true,
        correlation,
      ),
    ).toMatchObject({ status: "failed" });
    expect(methods()).toEqual(["GET"]);
  });

  it.each([
    { ...campaign, brandId: "other" },
    { ...campaign, campaignStatus: "MNO_PENDING" },
    { ...campaign, campaignStatus: undefined },
  ])("requires campaign brand and actual carrier approval", async (data) => {
    respond(data);
    expect(
      await advanceLifecycle(assignment, undefined, false, correlation),
    ).toMatchObject({ status: "failed" });
    expect(methods()).toEqual(["GET"]);
  });

  it("confirms assignment with GET after POST", async () => {
    respond(campaign);
    respond(brand);
    respond({ data: { phone_number: number.phoneNumber } });
    respond({}, 404);
    respond({ ...assigned, assignmentStatus: "PENDING_ASSIGNMENT" });
    respond(assigned);
    expect(
      await advanceLifecycle(assignment, undefined, false, correlation),
    ).toMatchObject({ status: "succeeded", resourceId: "number-1" });
    expect(methods()).toEqual(["GET", "GET", "GET", "GET", "POST", "GET"]);
  });

  it("never replays an unconfirmed assignment", async () => {
    respond(campaign);
    respond(brand);
    respond({ data: { phone_number: number.phoneNumber } });
    respond({}, 404);
    expect(
      await advanceLifecycle(assignment, undefined, true, correlation),
    ).toEqual({ status: "uncertain" });
    expect(methods()).toEqual(["GET", "GET", "GET", "GET"]);
  });

  it.each([
    ["PENDING_ASSIGNMENT", "pending"],
    ["FAILED_ASSIGNMENT", "failed"],
    ["ASSIGNED", "succeeded"],
  ])(
    "reconciles %s campaign assignment without replay",
    async (assignmentStatus, status) => {
      respond(campaign);
      respond(brand);
      respond({ data: { phone_number: number.phoneNumber } });
      respond({ ...assigned, assignmentStatus });
      expect(
        await advanceLifecycle(assignment, undefined, true, correlation),
      ).toMatchObject({ status });
      expect(methods()).toEqual(["GET", "GET", "GET", "GET"]);
    },
  );

  it("uses the unwrapped 10DLC lookup responses", async () => {
    respond({ brandId: "brand-1" });
    respond(campaign);
    expect(await lookupBrand("brand-1")).toEqual({ brandId: "brand-1" });
    expect(await lookupCampaign("campaign-1")).toEqual(campaign);
  });

  it("allows a fresh submission after a transient campaign preflight", async () => {
    respond({}, 503);
    expect(
      await advanceLifecycle(assignment, undefined, false, correlation),
    ).toMatchObject({ status: "pending", noEffect: true });
    respond(campaign);
    respond(brand);
    respond({ data: { phone_number: number.phoneNumber } });
    respond({}, 404);
    respond(assigned);
    respond(assigned);
    expect(
      await advanceLifecycle(assignment, undefined, false, correlation),
    ).toMatchObject({ status: "succeeded" });
    expect(methods().filter((method) => method === "POST")).toHaveLength(1);
  });

  it.each([0, 1, 2])(
    "marks transient preflight read %s as no-effect only before submission",
    async (step) => {
      for (const submitted of [false, true]) {
        if (step > 0) respond(campaign);
        if (step > 1) respond(brand);
        respond({}, 503);
        const result = await advanceLifecycle(
          assignment,
          undefined,
          submitted,
          correlation,
        );
        expect(result.status).toBe("pending");
        expect(result.noEffect === true).toBe(!submitted);
      }
    },
  );

  it.each([profile, number])(
    "marks a permanently rejected initial create as no-effect",
    async (request) => {
      respond({}, 422);
      expect(
        await advanceLifecycle(request, undefined, false, correlation),
      ).toMatchObject({ status: "failed", noEffect: true });
      expect(methods()).toEqual(["POST"]);
    },
  );

  it.each([408, 409, 429, 500])(
    "does not claim no-effect for ambiguous POST status %s",
    async (status) => {
      respond({}, status);
      const result = await advanceLifecycle(
        number,
        undefined,
        false,
        correlation,
      );
      expect(result.status).toBe("uncertain");
      expect(result.noEffect).not.toBe(true);
    },
  );

  it("does not claim no-effect when confirmation fails after an assignment write", async () => {
    respond(campaign);
    respond(brand);
    respond({ data: { phone_number: number.phoneNumber } });
    respond({}, 404);
    respond(assigned);
    respond({}, 403);
    const result = await advanceLifecycle(
      assignment,
      undefined,
      false,
      correlation,
    );
    expect(result.status).toBe("failed");
    expect(result.noEffect).not.toBe(true);
  });

  it.each([
    { ...brand, brandId: "other" },
    { ...brand, identityStatus: "UNVERIFIED" },
    { ...brand, identityStatus: "SELF_DECLARED" },
    { ...brand, identityStatus: undefined },
  ])(
    "rejects incorrect or unverified brands before writing",
    async (response) => {
      for (const submitted of [false, true]) {
        respond(campaign);
        respond(response);
        expect(
          await advanceLifecycle(assignment, undefined, submitted, correlation),
        ).toMatchObject({ status: "failed", noEffect: !submitted });
      }
      expect(methods()).toEqual(["GET", "GET", "GET", "GET"]);
    },
  );

  it("accepts VETTED_VERIFIED identity", async () => {
    respond(campaign);
    respond({ ...brand, identityStatus: "VETTED_VERIFIED" });
    respond({ data: { phone_number: number.phoneNumber } });
    respond(assigned);
    expect(
      await advanceLifecycle(assignment, undefined, true, correlation),
    ).toMatchObject({ status: "succeeded" });
  });
});
