// Source uses window timers and window.crypto for Obsidian popout compatibility.
// The Node test environment has no window, so alias it to the global object.
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = globalThis;
}
