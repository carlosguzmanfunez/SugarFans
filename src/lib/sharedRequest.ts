// The menu, the bottom bar and the page often ask for the same data as they open
// (notifications, Reserve requests, Créditos...). Requests with the same key share
// one trip to the server while it is on its way, so a slow phone connection sends
// it once instead of three times.
//
// A normal load reuses any request already on its way. A fresh load (after saving
// something, or a reload) only reuses a request started in the same instant, so it
// never gets data from before the change.
const inflight = new Map<string, { promise: Promise<unknown>; tick: number }>();

let tick = 0;
let ticking = false;
const currentTick = () => {
  if (!ticking) {
    ticking = true;
    queueMicrotask(() => {
      tick += 1;
      ticking = false;
    });
  }
  return tick;
};

export function sharedRequest<T>(key: string, load: () => Promise<T>, fresh = false): Promise<T> {
  const now = currentTick();
  const hit = inflight.get(key);
  if (hit && (!fresh || hit.tick === now)) return hit.promise as Promise<T>;
  const promise = load();
  inflight.set(key, { promise, tick: now });
  const clear = () => {
    if (inflight.get(key)?.promise === promise) inflight.delete(key);
  };
  promise.then(clear, clear);
  return promise;
}
