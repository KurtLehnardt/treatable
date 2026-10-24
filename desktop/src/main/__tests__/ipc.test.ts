import test from "node:test";
import assert from "node:assert/strict";
import { IPC, TREATABLE_API_METHODS } from "../../shared/ipc";
import { createHandlers, registerIpcHandlers, type IpcMainLike } from "../ipc";

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: any[]) => unknown>();
  const ipc: IpcMainLike = {
    handle: (c, l) => void handlers.set(c, l),
    removeHandler: (c) => void handlers.delete(c),
  };
  return { ipc, handlers };
}

test("every contract method has a channel and a registered handler", () => {
  const { ipc, handlers } = fakeIpcMain();
  registerIpcHandlers(ipc, createHandlers({ version: "9.9.9", openExternal: () => {} }));
  assert.deepEqual([...TREATABLE_API_METHODS].sort(), Object.keys(IPC).sort());
  for (const name of TREATABLE_API_METHODS) assert.ok(handlers.has(IPC[name]), name);
});

test("openExternal refuses non-https and opens https", async () => {
  const opened: string[] = [];
  const { ipc, handlers } = fakeIpcMain();
  registerIpcHandlers(ipc, createHandlers({ version: "1.0.0", openExternal: (u) => void opened.push(u) }));
  const call = handlers.get(IPC.openExternal)!;
  assert.equal(await call({}, "http://example.com"), false);
  assert.equal(await call({}, "file:///etc/passwd"), false);
  assert.equal(await call({}, "https://clinicaltrials.gov/study/NCT00000000"), true);
  assert.deepEqual(opened, ["https://clinicaltrials.gov/study/NCT00000000"]);
});

test("placeholder state never exposes a key and reports the version", async () => {
  const h = createHandlers({ version: "1.2.3", openExternal: () => {} });
  const saved = await h.saveKey("sk-test-abcdwxyz");
  assert.equal(saved.last4, "wxyz");
  assert.ok(!JSON.stringify(saved).includes("sk-test"));
  assert.equal((await h.getState()).version, "1.2.3");
  const cleared = await h.clearAll();
  assert.equal(cleared.hasKey, false);
  assert.equal(cleared.settings.minMatch, 80);
  assert.equal((await h.checkForUpdate()).current, "1.2.3");
});
