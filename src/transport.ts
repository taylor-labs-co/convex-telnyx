export class TelnyxRequestError extends Error {
  constructor(
    public status: number | undefined,
    public retryAfter: string | null = null,
  ) {
    super(
      status ? `Telnyx HTTP ${status}` : "Telnyx response was not confirmed",
    );
  }
}
/** No hidden retries. The durable worker owns retry decisions. */
export async function requestTelnyx(
  apiKey: string | undefined,
  path: string,
  method: string,
  body?: unknown,
): Promise<any> {
  if (!apiKey) throw new Error("TELNYX_API_KEY is required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`https://api.telnyx.com/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "convex-telnyx/0.1.0",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new TelnyxRequestError(
        response.status,
        response.headers.get("retry-after"),
      );
    if (response.status === 204) return { data: null };
    return await response.json();
  } catch (error) {
    if (error instanceof TelnyxRequestError) throw error;
    throw new TelnyxRequestError(undefined);
  } finally {
    clearTimeout(timer);
  }
}
