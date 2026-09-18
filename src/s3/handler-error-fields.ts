import { DrimeApiError } from "../drime/client";

/** Stable type + Drime status only. No message, stack, body, cause, tags, or URLs. */
export function safeHandlerErrorFields(error: unknown): {
  errType: string;
  drimeStatus?: number;
} {
  if (error instanceof DrimeApiError) {
    return { errType: error.name, drimeStatus: error.status };
  }
  if (error instanceof Error && error.name.length > 0) {
    return { errType: error.name };
  }
  return { errType: typeof error };
}
