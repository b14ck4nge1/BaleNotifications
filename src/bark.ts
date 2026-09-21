import type { Env } from "./runtime.ts";
import type { BaleIncomingMessage } from "./bale.ts";

export interface BarkSenderProfile {
  name: string;
  iconUrl?: string;
}

function previewEnabled(env: Env): boolean {
  return (env.MESSAGE_PREVIEW ?? "true").toLowerCase() !== "false";
}

function cleanPreview(value: string, maxLength = 500): string {
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

export function barkGroupName(baseGroup: string | undefined, senderId?: string): string {
  const namespace = baseGroup?.trim() || "BaleNotifications";
  return senderId ? `${namespace}:sender:${senderId}` : `${namespace}:system`;
}

export async function sendBark(
  env: Env,
  message?: BaleIncomingMessage,
  profile?: BarkSenderProfile,
  test = false,
): Promise<void> {
  const endpoint = new URL(env.BARK_URL);
  if (endpoint.protocol !== "https:") throw new Error("BARK_URL must use HTTPS");

  const title = test
    ? "BaleNotifications test"
    : cleanPreview(profile?.name || `Bale user ${message?.senderId ?? "unknown"}`, 100);
  const body = test
    ? "Cloudflare can reach your Bark device."
    : previewEnabled(env)
      ? cleanPreview(message?.text ?? "New message")
      : "New Bale message";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      body,
      group: barkGroupName(env.BARK_GROUP, message?.senderId),
      level: "active",
      ...(profile?.iconUrl ? { icon: profile.iconUrl } : {}),
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Bark returned HTTP ${response.status}: ${responseText.slice(0, 200)}`);
  }

  try {
    const result = JSON.parse(responseText) as { code?: number; message?: string };
    if (result.code !== undefined && result.code !== 200) {
      throw new Error(`Bark rejected the push: ${result.message ?? `code ${result.code}`}`);
    }
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
}
