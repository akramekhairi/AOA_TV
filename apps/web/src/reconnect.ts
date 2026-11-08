interface Environment {
  page: EventTarget & { readonly hidden: boolean };
  window: EventTarget;
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
}

// Each foreground transition replaces suspended requests. Only the current
// request can schedule another poll; repeated browser events cannot fork loops.
export function revalidate(
  task: (signal: AbortSignal) => Promise<void>,
  failed: (error: unknown) => void,
  resumed: () => void,
  env: Environment = {page: document, window, schedule: setTimeout, cancel: clearTimeout},
) {
  let stopped = false, failures = 0, generation = 0, retryAfterMs = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { generation++; controller?.abort(); if(timer !== undefined) env.cancel(timer); };
  const poll = async () => {
    if(stopped || env.page.hidden) return;
    const current = ++generation;
    controller = new AbortController();
    try { await task(controller.signal); if(current === generation) { failures = 0; retryAfterMs = 0; } }
    catch(error) { if(current === generation && !controller.signal.aborted) { failures++; retryAfterMs = typeof error==='object' && error!==null && 'retryAfterMs' in error ? Number(error.retryAfterMs)||0 : 0; failed(error); } }
    if(!stopped && current === generation && !env.page.hidden) {
      // Fast first recovery attempts, capped at 30 seconds during an outage.
      const delay = Math.max(retryAfterMs, failures ? Math.min(1000 * 2 ** Math.min(failures - 1, 5), 30000) : 10000);
      timer = env.schedule(() => { void poll(); }, delay);
    }
  };
  const resume = () => { cancel(); if(!env.page.hidden && !stopped) { failures = 0; resumed(); void poll(); } };
  env.page.addEventListener('visibilitychange', resume);
  for(const event of ['pageshow', 'online', 'focus']) env.window.addEventListener(event, resume);
  void poll();
  return () => { stopped = true; cancel(); env.page.removeEventListener('visibilitychange', resume); for(const event of ['pageshow', 'online', 'focus']) env.window.removeEventListener(event, resume); };
}
