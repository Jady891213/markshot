import assert from "node:assert/strict";
import test from "node:test";
import { createUpdateChecker, GITHUB_URL, RELEASES_URL } from "../src/updates.mjs";

const release = (tag_name = "v0.7.0", rest = {}) => ({ tag_name, draft: false, prerelease: false, ...rest });
const response = (body) => ({ ok: true, json: async () => body });
const checkerFor = (body, options = {}) => createUpdateChecker({
  currentVersion: "0.6.0", fetchImpl: async () => response(body), ...options,
});

test("update checks use the fixed public API and construct trusted release links", async () => {
  const states = [];
  const checker = checkerFor(release(), {
    onChange: (state) => states.push(state),
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.github.com/repos/Jady891213/markshot/releases/latest");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Accept, "application/vnd.github+json");
      assert.equal(options.headers.Authorization, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      return response(release("v0.7.0", { html_url: "https://evil.example/download" }));
    },
  });
  assert.equal(checker.getState().status, "idle");
  assert.equal(GITHUB_URL, "https://github.com/Jady891213/markshot");
  assert.equal(checker.getState().releaseUrl, RELEASES_URL);
  const result = await checker.check();
  assert.deepEqual(states.map((state) => state.status), ["checking", "available"]);
  assert.equal(result.latestVersion, "0.7.0");
  assert.equal(result.hasUpdate, true);
  assert.equal(result.releaseUrl, `${RELEASES_URL}/tag/v0.7.0`);
  result.hasUpdate = false;
  assert.equal(checker.getState().hasUpdate, true);
});

test("stable versions compare numerically and ignore build metadata", async () => {
  for (const [tag, currentVersion, status] of [
    ["v0.6.0", "0.6.0", "current"],
    ["0.5.9", "0.6.0", "current"],
    ["0.10.0", "v0.9.0", "available"],
    ["1.0.0", "0.99.99", "available"],
    ["0.6.1", "0.6.0", "available"],
    ["0.6.0+new", "0.6.0+old", "current"],
  ]) {
    const result = await checkerFor(release(tag), { currentVersion }).check();
    assert.equal(result.status, status, tag);
  }
});

test("malformed tags, drafts and prereleases never offer updates", async () => {
  for (const body of [
    ...["v0.7", "01.0.0", "v0.7.0-beta.1", "latest", "0.7.0/../../evil", " 0.7.0", "1.0.0+", null].map((tag) => release(tag)),
    release("1.0.0", { draft: true }),
    release("1.0.0", { prerelease: true }),
    { tag_name: "1.0.0" },
    null,
  ]) {
    const result = await checkerFor(body).check();
    assert.equal(result.status, "error");
    assert.equal(result.errorCode, "UPDATE_INVALID_RELEASE");
    assert.equal(result.hasUpdate, false);
    assert.equal(result.releaseUrl, RELEASES_URL);
  }
  assert.throws(() => createUpdateChecker({ currentVersion: "garbage" }), { code: "UPDATE_INVALID_VERSION" });
});

test("duplicate and reentrant checks share one pending request", async () => {
  let complete;
  let requests = 0;
  let reentrant;
  const checker = createUpdateChecker({
    currentVersion: "0.6.0",
    fetchImpl: () => { requests += 1; return new Promise((resolve) => { complete = resolve; }); },
    onChange: (state) => { if (state.status === "checking") reentrant = checker.check(); },
  });
  const first = checker.check();
  assert.equal(checker.check(), first);
  await Promise.resolve();
  assert.equal(reentrant, first);
  assert.equal(requests, 1);
  complete(response(release()));
  await first;
  const next = checker.check();
  await Promise.resolve();
  assert.equal(requests, 2);
  complete(response(release()));
  await next;
});

test("failed checks use stable error codes and retain a known available update", async () => {
  for (const [fetchImpl, code] of [
    [async () => { throw new Error("private network details"); }, "UPDATE_NETWORK"],
    [async () => ({ ok: false, status: 500 }), "UPDATE_HTTP"],
    [async () => ({ ok: false, status: 403 }), "UPDATE_RATE_LIMIT"],
    [async () => ({ ok: false, status: 429 }), "UPDATE_RATE_LIMIT"],
    [async () => ({ ok: true, json: async () => { throw new Error("bad JSON"); } }), "UPDATE_INVALID_RELEASE"],
  ]) {
    const result = await checkerFor(null, { fetchImpl }).check();
    assert.equal(result.status, "error");
    assert.equal(result.errorCode, code);
  }
  let fail = false;
  const checker = checkerFor(null, { fetchImpl: async () => {
    if (fail) throw new Error("offline");
    return response(release());
  } });
  const known = await checker.check();
  fail = true;
  const failed = await checker.check();
  assert.equal(failed.status, "available");
  assert.equal(failed.hasUpdate, true);
  assert.equal(failed.latestVersion, known.latestVersion);
  assert.equal(failed.releaseUrl, known.releaseUrl);
  assert.equal(failed.errorCode, "UPDATE_NETWORK");
  fail = false;
  assert.equal((await checker.check()).errorCode, null);
});

test("request and response body time out at ten seconds and abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const stallBody of [false, true]) {
    let signal;
    const checker = checkerFor(null, { fetchImpl: async (_url, options) => {
      signal = options.signal;
      const never = new Promise(() => {});
      return stallBody ? { ok: true, json: () => never } : never;
    } });
    const pending = checker.check();
    await Promise.resolve();
    t.mock.timers.tick(9_999);
    assert.equal(checker.getState().status, "checking");
    t.mock.timers.tick(1);
    const result = await pending;
    assert.equal(result.status, "error");
    assert.equal(result.errorCode, "UPDATE_TIMEOUT");
    assert.equal(signal.aborted, true);
  }
});
