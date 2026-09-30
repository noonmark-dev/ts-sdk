export type NoonmarkOptions = {
  apiKey: string;
  /** Origin of the Noonmark app, e.g. http://localhost:3000 */
  baseUrl?: string;
};

export type SubmitOptions = {
  /**
   * Makes a retry safe. Sent as the `Idempotency-Key` header: a second submit
   * with the same key on the same Form stores nothing new and resolves with the
   * first Submission's id (the server answers 200 instead of 201). Use one key
   * per thing your user did — an order id, a UUID made when the screen opened —
   * and reuse it only to retry that. 1 to 200 printable ASCII characters,
   * trimmed; anything else is refused with a 400.
   */
  idempotencyKey?: string;
  /**
   * A Cloudflare Turnstile token, for a Form whose bot protection has Turnstile
   * on. Sent as the `X-Noonmark-Turnstile` header. Tokens are single-use, so a
   * retry needs a fresh one.
   */
  turnstileToken?: string;
};

export type SubmissionResult = {
  ok: true;
  id: string;
};

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "url"
  | "number"
  | "scale"
  | "satisfaction"
  | "select"
  | "multiselect"
  | "emoji";

export type FormKind = "feedback" | "survey";

/** Shows a Field only when an earlier Field matches: any of `is`, or within `min`..`max`. */
export type Condition = { key: string; is?: string[]; min?: number; max?: number };

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** select, multiselect, emoji — the allowed values. */
  options?: string[];
  /** scale — inclusive bounds. */
  min?: number;
  max?: number;
  /** satisfaction — captions under the first and last face. */
  minLabel?: string;
  maxLabel?: string;
  /** Written to the Submission when the payload leaves the key out. */
  default?: FieldValue;
  /** The Form's value, always: ingest writes `default` and refuses anything else. */
  locked?: boolean;
  /** No input on the public page; the value comes from the link or the default. */
  hidden?: boolean;
  /** Shown, and required, only when the rule matches. Points at a Field above it. */
  when?: Condition;
  /** The survey page starts a new step here. A rendering hint; ingest ignores it. */
  step?: boolean;
};

export type FormDefinition = {
  id: string;
  name: string;
  kind: FormKind;
  fields: Field[];
};

/** The value shape each Field type accepts in a Submission. */
export type FieldValue = string | number | string[];

export class NoonmarkError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfter?: number;

  constructor(message: string, status: number, body?: unknown, retryAfter?: number) {
    super(message);
    this.name = "NoonmarkError";
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

export class Noonmark {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: NoonmarkOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new Error("Noonmark: apiKey is required");
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async parse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private fail(response: Response, data: unknown, fallback: string): never {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `${fallback} (${response.status})`;
    const retryAfterRaw = response.headers.get("retry-after");
    const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
    throw new NoonmarkError(
      message,
      response.status,
      data,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }

  /**
   * Read the Form's definition so the client can render it. Useful for
   * `kind: "survey"`, where the Studio owns the Field list; a `feedback` Form
   * usually hardcodes its own screen and never needs this.
   */
  async form(): Promise<FormDefinition> {
    const response = await fetch(`${this.baseUrl}/api/v1/form`, {
      method: "GET",
      headers: this.headers(),
    });

    const data = await this.parse(response);
    if (!response.ok) this.fail(response, data, "Noonmark form failed");

    if (
      !data ||
      typeof data !== "object" ||
      !("fields" in data) ||
      !Array.isArray((data as FormDefinition).fields)
    ) {
      throw new NoonmarkError("unexpected response", response.status, data);
    }

    return data as FormDefinition;
  }

  /**
   * Sends a Submission to `POST /api/v1/submit`. Resolves with its id, or
   * throws a `NoonmarkError`. Pass `idempotencyKey` to make a retry safe: the
   * same key resolves with the same id and stores one Submission.
   */
  async submit(
    payload: Record<string, FieldValue | null | undefined>,
    options: SubmitOptions = {},
  ): Promise<SubmissionResult> {
    const headers = this.headers();
    if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;
    if (options.turnstileToken !== undefined) headers["X-Noonmark-Turnstile"] = options.turnstileToken;
    const response = await fetch(`${this.baseUrl}/api/v1/submit`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const data = await this.parse(response);
    if (!response.ok) this.fail(response, data, "Noonmark submit failed");

    if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string") {
      throw new NoonmarkError("unexpected response", response.status, data);
    }

    return { ok: true, id: data.id };
  }
}
