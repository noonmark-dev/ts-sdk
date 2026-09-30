import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Noonmark, NoonmarkError } from "../src/index.ts";

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;

function stub(response: Response): Call[] {
  // a Response body can be read once, so hand out a clone per call
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response.clone();
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const client = () => new Noonmark({ apiKey: "frm_test", baseUrl: "https://example.test/" });

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("constructor", () => {
  it("requires a non-blank apiKey", () => {
    assert.throws(() => new Noonmark({ apiKey: "   " }), /apiKey is required/);
  });

  it("defaults baseUrl to localhost and strips a trailing slash", async () => {
    const calls = stub(json({ fields: [] }));
    await new Noonmark({ apiKey: "k" }).form();
    assert.equal(calls[0].url, "http://localhost:3000/api/v1/form");
    const calls2 = stub(json({ fields: [] }));
    await client().form();
    assert.equal(calls2[0].url, "https://example.test/api/v1/form");
  });
});

describe("submit", () => {
  it("POSTs the payload with a bearer token and resolves with the id", async () => {
    const calls = stub(json({ ok: true, id: "sub_1" }, 201));
    const result = await client().submit({ email: "ana@acme.com", rating: 4 });
    assert.deepEqual(result, { ok: true, id: "sub_1" });
    assert.equal(calls[0].url, "https://example.test/api/v1/submit");
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer frm_test");
    assert.equal(headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { email: "ana@acme.com", rating: 4 });
  });

  it("sends Idempotency-Key and X-Noonmark-Turnstile only when given", async () => {
    const calls = stub(json({ ok: true, id: "sub_1" }));
    await client().submit({ a: "b" });
    await client().submit({ a: "b" }, { idempotencyKey: "order-9", turnstileToken: "tok" });
    const plain = calls[0].init.headers as Record<string, string>;
    const keyed = calls[1].init.headers as Record<string, string>;
    assert.equal("Idempotency-Key" in plain, false);
    assert.equal("X-Noonmark-Turnstile" in plain, false);
    assert.equal(keyed["Idempotency-Key"], "order-9");
    assert.equal(keyed["X-Noonmark-Turnstile"], "tok");
  });

  it("throws NoonmarkError with status, body and the server message", async () => {
    stub(json({ error: "email is invalid" }, 400));
    await assert.rejects(client().submit({ email: "x" }), (error: unknown) => {
      assert.ok(error instanceof NoonmarkError);
      assert.equal(error.name, "NoonmarkError");
      assert.equal(error.status, 400);
      assert.equal(error.message, "email is invalid");
      assert.deepEqual(error.body, { error: "email is invalid" });
      assert.equal(error.retryAfter, undefined);
      return true;
    });
  });

  it("exposes Retry-After in seconds on a 429", async () => {
    stub(json({ error: "slow down" }, 429, { "retry-after": "17" }));
    await assert.rejects(client().submit({}), (error: unknown) => {
      assert.ok(error instanceof NoonmarkError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, 17);
      return true;
    });
  });

  it("falls back to a status message when the error body is not JSON", async () => {
    stub(new Response("<html>bad gateway</html>", { status: 502 }));
    await assert.rejects(client().submit({}), (error: unknown) => {
      assert.ok(error instanceof NoonmarkError);
      assert.equal(error.message, "Noonmark submit failed (502)");
      assert.equal(error.body, null);
      return true;
    });
  });

  it("ignores a non-numeric Retry-After", async () => {
    stub(json({}, 503, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }));
    await assert.rejects(client().submit({}), (error: unknown) => {
      assert.ok(error instanceof NoonmarkError);
      assert.equal(error.retryAfter, undefined);
      return true;
    });
  });

  it("rejects a 2xx without a string id", async () => {
    stub(json({ ok: true }, 201));
    await assert.rejects(client().submit({}), /unexpected response/);
  });
});

describe("form", () => {
  const definition = {
    id: "f1",
    name: "NPS",
    kind: "survey",
    fields: [{ key: "plan", label: "Plan", type: "select", required: true, options: ["free", "pro"] }],
  };

  it("GETs the definition with the bearer token", async () => {
    const calls = stub(json(definition));
    const form = await client().form();
    assert.deepEqual(form, definition);
    assert.equal(calls[0].url, "https://example.test/api/v1/form");
    assert.equal(calls[0].init.method, "GET");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer frm_test");
  });

  it("throws NoonmarkError on a non-2xx", async () => {
    stub(json({ error: "invalid api key" }, 401));
    await assert.rejects(client().form(), (error: unknown) => {
      assert.ok(error instanceof NoonmarkError);
      assert.equal(error.status, 401);
      assert.equal(error.message, "invalid api key");
      return true;
    });
  });

  it("rejects a 2xx whose body has no fields array", async () => {
    stub(json({ name: "x" }));
    await assert.rejects(client().form(), /unexpected response/);
  });
});
