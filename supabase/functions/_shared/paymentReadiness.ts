// Whether the calling user may move money, from get_my_payment_readiness()
// (migration 0040), the same rule the checkout and the app's Verification page
// use. Needs a client created with the user's own Authorization header.

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export const VERIFICATION_REQUIRED_MESSAGE =
  "Verify your account first: open Verification in your account menu.";

// The requirement codes still missing (empty when ready), or null when the
// database doesn't have the check yet (migration 0040 not applied), so
// functions keep working as before. Other errors are thrown: a failed check
// must not let the action through.
export async function missingPaymentRequirements(userClient: RpcClient): Promise<string[] | null> {
  const { data, error } = await userClient.rpc("get_my_payment_readiness");
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "PGRST202" || code === "42883") return null;
    throw error;
  }
  const missing = (data as { missing?: unknown } | null)?.missing;
  return Array.isArray(missing) ? missing.filter((item): item is string => typeof item === "string") : [];
}
