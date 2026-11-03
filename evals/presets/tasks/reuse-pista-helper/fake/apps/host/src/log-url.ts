import { maskUserinfo } from "./network.ts";

/** The URL as a string that is safe to log: userinfo masked, `<invalid URL>` when it cannot be parsed. */
export function logUrl(raw: string): string {
  try {
    return maskUserinfo(new URL(raw)).toString();
  } catch {
    return "<invalid URL>";
  }
}
