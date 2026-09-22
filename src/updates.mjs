export const GITHUB_URL = "https://github.com/Jady891213/markshot";
export const RELEASES_URL = `${GITHUB_URL}/releases`;

const LATEST_RELEASE_API = "https://api.github.com/repos/Jady891213/markshot/releases/latest";
const REQUEST_TIMEOUT_MS = 10_000;
const STABLE_VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseVersion(value) {
  if (typeof value !== "string" || value.length > 256) return null;
  const match = STABLE_VERSION.exec(value);
  if (!match) return null;
  return { version: value.replace(/^v/, ""), parts: match.slice(1, 4).map(BigInt) };
}

function isNewer(candidate, current) {
  for (let index = 0; index < 3; index += 1) {
    if (candidate.parts[index] !== current.parts[index]) {
      return candidate.parts[index] > current.parts[index];
    }
  }
  return false;
}

function updateError(code) {
  return Object.assign(new Error(code), { code });
}

/** Check official releases only. This never downloads or installs an update. */
export function createUpdateChecker({ currentVersion, fetchImpl = globalThis.fetch, onChange } = {}) {
  const current = parseVersion(currentVersion);
  if (!current) throw updateError("UPDATE_INVALID_VERSION");

  let state = {
    currentVersion: current.version,
    latestVersion: null,
    releaseUrl: RELEASES_URL,
    status: "idle",
    hasUpdate: false,
    errorCode: null,
  };
  let pending = null;
  const getState = () => ({ ...state });

  function publish(changes) {
    state = { ...state, ...changes };
    // Notification consumers must not turn a successful check into a network error.
    try { onChange?.(getState()); } catch { /* The checker owns its state. */ }
  }

  async function requestLatest() {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(updateError("UPDATE_TIMEOUT"));
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    });
    const request = async () => {
      let response;
      try {
        response = await fetchImpl(LATEST_RELEASE_API, {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `MarkShot/${current.version}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw updateError("UPDATE_NETWORK");
      }
      if (!response?.ok) {
        throw updateError([403, 429].includes(response?.status) ? "UPDATE_RATE_LIMIT" : "UPDATE_HTTP");
      }
      let release;
      try { release = await response.json(); } catch { throw updateError("UPDATE_INVALID_RELEASE"); }
      const latest = parseVersion(release?.tag_name);
      if (!latest || release.draft !== false || release.prerelease !== false) {
        throw updateError("UPDATE_INVALID_RELEASE");
      }
      return { latest, tag: release.tag_name };
    };
    try {
      // Race covers both response headers and a stalled response body. Mock or custom
      // fetch implementations need not support abort for the timeout to settle.
      return await Promise.race([request(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  function check() {
    if (pending) return pending;
    // Set pending before notifying listeners, so reentrant/manual checks share it.
    pending = Promise.resolve().then(async () => {
      publish({ status: "checking", errorCode: null });
      try {
        const { latest, tag } = await requestLatest();
        const hasUpdate = isNewer(latest, current);
        publish({
          latestVersion: latest.version,
          releaseUrl: `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`,
          status: hasUpdate ? "available" : "current",
          hasUpdate,
          errorCode: null,
        });
      } catch (error) {
        publish({
          status: state.hasUpdate ? "available" : "error",
          errorCode: error.code || "UPDATE_NETWORK",
        });
      }
      return getState();
    }).finally(() => { pending = null; });
    return pending;
  }

  return { getState, check };
}
