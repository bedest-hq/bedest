export interface IRequestIpSource {
  requestIP(request: Request): { address: string } | null;
}

export class UtilClientIp {
  /**
   * Client address for rate limiting and auditing.
   *
   * With `trustProxyHops = 0` the socket address is used and
   * `X-Forwarded-For` is ignored (it is client-controlled). With `n > 0`
   * the entry at position `-n` of `X-Forwarded-For` is used: each trusted
   * proxy appends the address it received the request from, so entries to
   * the left of that position can be spoofed and are never trusted.
   */
  static resolve(
    request: Request,
    server: IRequestIpSource | null | undefined,
    trustProxyHops: number,
  ): string {
    if (trustProxyHops > 0) {
      const header = request.headers.get("x-forwarded-for");
      if (header) {
        const hops = header
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        const candidate = hops[hops.length - trustProxyHops];
        if (candidate) {
          return candidate;
        }
      }
    }

    return server?.requestIP(request)?.address ?? "unknown";
  }
}
