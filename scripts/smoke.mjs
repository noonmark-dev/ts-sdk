// Packs the SDK, installs the tarball in a temp dir OUTSIDE the repo, then
// loads it as ESM and as CJS and calls submit() against a stub fetch.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const work = mkdtempSync(join(tmpdir(), "noonmark-sdk-smoke-"));
try {
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  run("npm", ["pack", "--pack-destination", packDir, "--silent"], pkgDir);
  const tarball = join(packDir, readdirSync(packDir).find((f) => f.endsWith(".tgz")));

  const app = join(work, "app");
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "smoke", private: true }));
  run("npm", ["install", "--no-audit", "--no-fund", "--silent", tarball], app);

  const body = `
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, id: "sub_smoke" }), { status: 201 });
    };
    const client = new Noonmark({ apiKey: "frm_smoke", baseUrl: "https://stub.test" });
    const result = await client.submit({ message: "hi" }, { idempotencyKey: "k1" });
    if (result.id !== "sub_smoke" || calls[0].url !== "https://stub.test/api/v1/submit") {
      throw new Error("unexpected result " + JSON.stringify({ result, calls }));
    }
    if (typeof NoonmarkError !== "function") throw new Error("NoonmarkError missing");
  `;
  writeFileSync(join(app, "esm.mjs"), `import { Noonmark, NoonmarkError } from "@noonmark/sdk";\n${body}\nconsole.log("esm ok");\n`);
  writeFileSync(join(app, "cjs.cjs"), `const { Noonmark, NoonmarkError } = require("@noonmark/sdk");\n(async () => {${body}\nconsole.log("cjs ok");})().catch((e) => { console.error(e); process.exit(1); });\n`);

  process.stdout.write(run("node", ["esm.mjs"], app));
  process.stdout.write(run("node", ["cjs.cjs"], app));
  console.log("PASS");
} finally {
  rmSync(work, { recursive: true, force: true });
}
