/** User-facing message when Drime is unreachable from the status probe. */
export function formatDrimeStatusError(raw: string): string {
  const lower = raw.toLowerCase();

  if (
    lower.includes("unable to connect") ||
    lower.includes("connection refused") ||
    lower.includes("connectionrefused") ||
    lower.includes("econnrefused") ||
    lower.includes("network unreachable")
  ) {
    return "Cannot connect to the Drime API at the configured base URL. Check DRIME_API_BASE_URL and that this host can reach it.";
  }

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "The Drime API did not respond in time. Check DRIME_API_BASE_URL and network access from this host.";
  }

  if (
    lower.includes("certificate") ||
    lower.includes("tls") ||
    lower.includes("ssl")
  ) {
    return "TLS error connecting to the Drime API. Verify DRIME_API_BASE_URL and trust settings on this host.";
  }

  if (lower.includes("dns") || lower.includes("getaddrinfo")) {
    return "Could not resolve the Drime API hostname. Check DRIME_API_BASE_URL and DNS from this host.";
  }

  return raw;
}
