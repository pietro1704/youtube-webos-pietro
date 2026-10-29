/** YouTube resets all element scrolling from a window capture scroll listener.
 * Shield only our page's offset writes during that host callback. Stopping
 * propagation is too late if YouTube registered its capture listener first.
 * Native wheel/focus scrolling and explicit app resets still use the browser's
 * accessor; no global prototype or YouTube-owned element is modified.
 */
export function protectSettingsScroll(win, page) {
  let proto = Object.getPrototypeOf(page);
  let descriptor;
  while (proto && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(proto, 'scrollTop');
    proto = Object.getPrototypeOf(proto);
  }
  if (!descriptor?.get || !descriptor?.set) return;
  Object.defineProperty(page, 'scrollTop', {
    configurable: true,
    get() { return descriptor.get.call(this); },
    set(value) {
      // window.event is supplied by the Chromium versions embedded in webOS.
      const event = win.event;
      if (event?.type === 'scroll' && event.target === this && event.currentTarget === win) return;
      descriptor.set.call(this, value);
    }
  });
}
