import { BaleRelay } from "./relay.ts";
import type { Env, ExecutionContext, ScheduledController } from "./runtime.ts";

export { BaleRelay };

export function autoStartEnabled(env: Pick<Env, "AUTO_START">): boolean {
  return !["false", "0", "no", "off"].includes((env.AUTO_START ?? "true").trim().toLowerCase());
}

function relay(env: Env) {
  return env.BALE_RELAY.get(env.BALE_RELAY.idFromName("primary"));
}

function authorized(request: Request, env: Env): boolean {
  const supplied = request.headers.get("Authorization");
  return Boolean(env.ADMIN_TOKEN) && supplied === `Bearer ${env.ADMIN_TOKEN}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return Response.json({
        service: "bale-notifications",
        ok: true,
        admin: [
          "POST /admin/start",
          "POST /admin/stop",
          "POST /admin/test",
          "GET /admin/status",
          "GET /admin/profile?sender_id=123",
        ],
      });
    }

    if (!url.pathname.startsWith("/admin/")) return new Response("Not found", { status: 404 });
    if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });

    const action = url.pathname.slice("/admin".length);
    const allowed = new Set(["/start", "/stop", "/test", "/status", "/profile"]);
    if (!allowed.has(action)) return new Response("Not found", { status: 404 });
    return relay(env).fetch(`https://relay.internal${action}${url.search}`, {
      method: request.method,
    });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const action = autoStartEnabled(env) ? "start" : "ensure";
    ctx.waitUntil(
      relay(env)
        .fetch(`https://relay.internal/${action}`, { method: "POST" })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Relay ${action} watchdog returned HTTP ${response.status}`);
          }
        }),
    );
  },
};
