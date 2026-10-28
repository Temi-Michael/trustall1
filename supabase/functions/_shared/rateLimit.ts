// Fixed-window rate limiting backed by the consume_rate_limit database function
// (migration 0035). Needs a service-role client.

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

// True while `key` is within `limit` calls per `windowSeconds`. If the check
// itself fails it allows the request, so a limiter outage never blocks payments.
export async function withinRateLimit(
  admin: RpcClient,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("Rate limit check failed", error);
    return true;
  }
  return data === true;
}

// Best-effort caller address for anonymous endpoints.
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export const TOO_MANY_REQUESTS = "Too many requests. Please wait a few minutes and try again.";
