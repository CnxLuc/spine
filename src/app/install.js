// Puts chrome.* in place before any of the reader's code runs. The app fills in
// hooks once it has drawn itself.
import { installChrome } from './shim.js';

export const hooks = { signIn() {}, options() {} };
export const tell = installChrome({ signIn: () => hooks.signIn(), options: () => hooks.options() });
