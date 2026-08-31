import "@testing-library/jest-dom/vitest";
// jsdom ships no IndexedDB. The recorder's local backup buffer is required to
// survive navigation, so it cannot be faked with a module-level variable —
// which means the tests need a real IndexedDB implementation, not a stub.
import "fake-indexeddb/auto";
