# Browser colony saves

Browser colonies use IndexedDB on the current origin. Existing localStorage saves are read only when no primary save exists. A validated old save is copied on the first successful save; its localStorage copy is retained. Subsequent loads prefer IndexedDB. JSON export/import keeps the same portable colony format and 16,000,000-byte admission limit. The independent elements lab is unchanged.

Save and import messages appear after the storage transaction completes. A failed or aborted write leaves the previous committed colony intact. If storage rejects an imported or new colony, that active colony can still be exported. An invalid original text save remains exportable while its initial fallback is shown, and autosave stays blocked until an explicit replacement succeeds. A malformed non-text database value remains untouched and protected, but cannot be offered as an original JSON export.

If IndexedDB exists but access/open/read fails, the game protects the save and does not silently load a stale legacy colony. Browsers without the API retain the synchronous localStorage fallback. Browser storage remains device/origin specific, can be denied or cleared, and is not cloud backup. Use Export save for a portable copy. Hiding or leaving the page attempts a final save; a browser may terminate before asynchronous work finishes. Use Save and wait for its success message before closing when the latest state matters.

## Adapter contract

`loadBrowserColony()` returns a promise for the existing session shape: state, fresh, error and original. Injectable `indexedDB` and `legacyStorage` getters allow focused checks without dependencies. The database is `spacefortress`, version1, with object store `saves` and the existing `spacefortress-save-v1` key.

`storeBrowserColony(session, state, replace=false)` captures serialized state at invocation and queues writes in request order within that session. Its promise resolves only on transaction completion; callers receive failures. A failed write does not poison later requests. `flushBrowserColony(session)` waits for accepted requests to settle; it does not replace each request's error handling or guarantee browser shutdown completion. Separate tabs do not share a write queue.

The browser app waits for startup and suppresses notices from superseded save/import requests. The synchronous adapter in persistence.js remains available to existing local callers, and exportColony remains shared. No colony schema, region, observation, recording, dependency or network change is required. [Verification](verification-status.md) records the bounded storage checks; new-sector travel and long-term colony endurance remain separate work.
