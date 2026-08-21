// Injected into the HighLevel page's MAIN world by chrome.scripting.executeScript.
// Serialized and re-parsed there, so this must be entirely self-contained: no
// imports, no closure variables.
//
// Why the MAIN world: the app keeps its authenticated HTTP client on
// window.SHELL_STORE.$http, whose interceptor attaches the session token. By
// borrowing that client we never read, store, or transmit a credential
// ourselves -- requests go out exactly as the app's own requests do.

/** Confirms we are on a HighLevel app page and reports the location in view. */
export function probePage() {
  const findJwt = (node, depth) => {
    if (!node || depth > 4) return null;
    if (typeof node === 'string') {
      return /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(node) ? node : null;
    }
    if (typeof node !== 'object') return null;
    for (const key of Object.keys(node)) {
      const hit = findJwt(node[key], depth + 1);
      if (hit) return hit;
    }
    return null;
  };

  const store = window.SHELL_STORE;
  if (!store) return { ok: false, reason: 'not-highlevel' };

  const fromUrl = location.pathname.match(/\/location\/([A-Za-z0-9]+)/);
  let locationId = fromUrl ? fromUrl[1] : null;
  let locationName = null;
  try {
    const current = store.state.locations.currentLocation;
    locationId = locationId || current.id || current._id;
    locationName = current.name || null;
  } catch (e) { /* location name is cosmetic */ }

  if (!locationId) return { ok: false, reason: 'no-location' };

  const mode = store.$http ? 'client' : (findJwt(store.state && store.state.auth, 0) ? 'token' : null);
  if (!mode) return { ok: false, reason: 'no-auth' };

  return { ok: true, locationId, locationName, mode, origin: location.origin };
}
