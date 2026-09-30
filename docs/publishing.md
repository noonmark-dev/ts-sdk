# Publishing @noonmark/sdk

Maintainer notes. Releases are cut with a script, published by GitHub Actions
through npm trusted publishing (OIDC). There is no `NPM_TOKEN` anywhere.

- npm package: `@noonmark/sdk` (scope `@noonmark`, public)
- GitHub repo: `noonmark-dev/ts-sdk` (must be public: npm provenance is not
  supported for private repositories, and `package.json` `repository` must match it)
- Release workflow file: `.github/workflows/release.yml`

## One-time setup (only you can do these)

1. **npm org.** On npmjs.com create the free public org `noonmark`
   (Add Organization, "Unlimited public packages" is free). The scope `@noonmark`
   is then yours. If the name is taken, pick another scope and change `name` in
   `package.json`, the README and the docs.
2. **GitHub repo.** From this directory:
   ```bash
   gh repo create noonmark-dev/ts-sdk --public --source . --remote origin
   git push -u origin main
   ```
   Settings to check on GitHub:
   - Repo is **public**.
   - Actions are enabled (Settings, Actions, General).
   - Optional: an environment (for example `npm`) if you want a manual approval
     gate. If you use one, add the same name in the trusted publisher on npm and
     `environment: npm` to the `publish` job.
   - Recommended: tag protection (Settings, Rules, Rulesets, new tag ruleset
     targeting `v*`) so only maintainers can create release tags.
3. **First publish (manual, once).** npm's trusted-publisher settings live on the
   package's own page, and the npm docs (docs.npmjs.com/trusted-publishers) only
   describe configuring it for an existing package. They do not say a not-yet-published
   package can be configured (UNVERIFIED for your account: check the npm UI). So the
   dependable path is one manual publish from a logged-in machine:
   ```bash
   npm login
   npm ci && npm run typecheck && npm run build && npm test && npm run smoke
   npm publish --access public
   ```
   Publishing from your laptop has no provenance; that is fine for the first
   version. Use a version that the workflow will not need again (for example the
   current `0.2.0`), then cut the next one through the script.
   If the org enforces 2FA you will be asked for an OTP.
4. **Register the trusted publisher.** npmjs.com, package `@noonmark/sdk`,
   Settings, Trusted Publisher, GitHub Actions:
   - Organization or user: `noonmark-dev`
   - Repository: `ts-sdk`
   - Workflow filename: `release.yml` (filename only)
   - Environment: empty (or the environment name from step 2)
   Recommended after it works: Settings, Publishing access, "Require two-factor
   authentication and disallow tokens".

## Cut a release

```bash
git switch main && git pull
npm run release -- patch          # or minor, major, or an exact x.y.z
npm run release -- patch --dry-run   # prints the plan, changes nothing
```

The script refuses on a dirty tree, a branch that is not `main`, a `HEAD` that is
not `origin/main`, an existing tag, or a version already on npm. It runs
typecheck, build, tests and the smoke test, bumps `package.json`, commits
`chore: release v<version>`, creates the annotated tag `v<version>`, and prints:

```bash
git push origin main v<version>
```

Run that yourself. The tag push starts `release.yml`, which checks that the tag
equals `v` + the `package.json` version, re-runs the checks, and runs
`npm publish --provenance --access public`. Watch it under Actions, then confirm
with `npm view @noonmark/sdk version`.

If the release commit goes through a pull request instead, tag the merge commit
by hand (`git tag -a v<version> <sha> -m "..."`) after it lands on `main`.

## Deprecate or unpublish

```bash
npm deprecate @noonmark/sdk@"0.2.0" "reason, use >=0.2.1"   # preferred
npm unpublish @noonmark/sdk@0.2.0                            # only within 72 hours, or if nothing depends on it
```

A version number can never be reused after an unpublish. Fix forward with a new
patch release.

## Troubleshooting

- **E404 on publish (scope not found / not in this registry).** The `@noonmark`
  org does not exist yet or your account is not a member with publish rights.
  Create the org (step 1), then check `npm org ls noonmark`.
- **E403 "two-factor authentication ... required".** Manual publish from a
  machine: pass `--otp=<code>`. In CI this means trusted publishing is not set
  up, or the publisher fields do not match exactly (owner, repo, workflow
  filename, environment).
- **E403 "cannot publish over the previously published versions".** That
  version exists; bump.
- **Provenance fails / "repository is private".** `gh repo view
  noonmark-dev/ts-sdk --json visibility` must say `PUBLIC`. The release workflow
  stops early with a clear error if the repo is private.
- **`repository.url` mismatch.** Provenance requires `package.json` `repository.url`
  to match the GitHub repo exactly (case-sensitive).
- **Trusted publishing ignored / ENEEDAUTH.** Needs npm >= 11.5.1 and Node >= 22.14;
  the workflow installs `npm@latest` and prints `npm -v`. Confirm `id-token: write`.
- **Tag/version mismatch.** The workflow fails if `v<tag>` differs from
  `package.json`. Delete the wrong tag (`git tag -d`, `git push origin :refs/tags/<tag>`),
  fix, retag.

## After first publish: follow-ups in the main noonmark repo

These are tracked in the main repo (`docs/publishing-sdk.md` there). Summary:
the SDK claims on the site stay "not on npm" until `npm view @noonmark/sdk`
succeeds; then flip them, and remove `packages/sdk` (and the `sdk:build` script
in the root `package.json`) from the noonmark repo, since this repo is now the
source of truth.
