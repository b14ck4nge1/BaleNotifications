function numericId(value: unknown): string | undefined {
  const text = typeof value === "number" || typeof value === "bigint" ? String(value) : value;
  return typeof text === "string" && /^\d+$/.test(text) ? text : undefined;
}

export function baleUserIdFromToken(token: string): string | undefined {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return undefined;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
      payload?: { user_id?: unknown };
      user_id?: unknown;
    };
    return numericId(decoded.payload?.user_id ?? decoded.user_id);
  } catch {
    return undefined;
  }
}

export function configuredBaleUserId(value: string | undefined): string | undefined {
  return numericId(value?.trim());
}

