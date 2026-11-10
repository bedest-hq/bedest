/** Accepted client request ids [FEAT-04]. */
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

interface IRequestInfo {
  id: string;
  startedAt: number;
}

const requests = new WeakMap<Request, IRequestInfo>();

/** Per-request id and start time, keyed by the Request object [FEAT-04]. */
export class UtilRequestId {
  /** Registers the request: keeps a valid `x-request-id`, else a UUID. */
  static begin(request: Request): IRequestInfo {
    const incoming = request.headers.get("x-request-id");
    const info = {
      id:
        incoming && REQUEST_ID_RE.test(incoming)
          ? incoming
          : crypto.randomUUID(),
      startedAt: performance.now(),
    };
    requests.set(request, info);
    return info;
  }

  static info(request: Request): IRequestInfo | undefined {
    return requests.get(request);
  }

  static idOf(request: Request): string | undefined {
    return requests.get(request)?.id;
  }
}
