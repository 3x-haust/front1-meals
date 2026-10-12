import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const tokenSchema = z.string().max(128).regex(/^\d{6,}:[A-Za-z0-9_-]{25,}$/);

export function createProvisionHandler(
  challenge: string,
  store: (value: string) => Promise<void>,
): (request: Request) => Promise<Response> {
  let consumed = false;
  const expected = Buffer.from(`Bearer ${challenge}`);
  return async (request) => {
    if (new URL(request.url).pathname !== "/telegram") {
      return new Response(null, { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }
    const provided = Buffer.from(request.headers.get("authorization") ?? "");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return new Response(null, { status: 401 });
    }
    if (consumed) return new Response(null, { status: 410 });
    const token = tokenSchema.safeParse(await request.text());
    if (!token.success) return new Response(null, { status: 400 });
    // Claim the one-use challenge before awaiting the native credential store.
    consumed = true;
    await store(token.data);
    return new Response(null, { status: 204 });
  };
}
