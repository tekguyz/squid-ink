import "@testing-library/jest-dom/vitest";
// jsdom ships no IndexedDB. The recorder's local backup buffer is required to
// survive navigation, so it cannot be faked with a module-level variable —
// which means the tests need a real IndexedDB implementation, not a stub.
import "fake-indexeddb/auto";

// jsdom implements no scrolling at all, so Element.prototype.scrollTo simply
// does not exist and calling it throws. note-detail-shell.tsx scrolls the
// transcript pane to the active segment in an effect, which means EVERY test
// that renders the shell dies on it — the failure looks nothing like the
// behaviour under test, which is what makes it worth stubbing centrally rather
// than in each file.
//
// A no-op, not a spy. Nothing asserts on scroll position: what the shell owes
// its reader is the right active segment, which is state, and the smooth
// scroll is presentation jsdom cannot measure anyway.
//
// The typeof guard is required, not defensive. This setup file runs for EVERY
// test, and the transcription and session suites declare
// `@vitest-environment node`, where there is no DOM and `Element` is not
// merely absent from the prototype chain but an undeclared identifier — a
// bare reference is a ReferenceError that fails those ten files at import,
// before a single test runs.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
