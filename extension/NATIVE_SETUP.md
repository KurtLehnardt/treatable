# Local model setup for the Chrome extension

Treatable uses a small Chrome native-messaging helper and your installed Ollama binary. Patient text passes from the extension to the helper through Chrome's native-messaging pipe, then to a dedicated loopback-only Ollama process with `OLLAMA_NO_CLOUD=1`. There is no cloud fallback and no extra public HTTP endpoint. The existing Treatable website API is not used or relaxed.

## macOS

1. Install Node.js and Ollama if they are not already installed. Model/software downloads are separate setup operations; do not put patient text in download commands.
2. Install a local **chat** model with Ollama. Embedding-only models are not offered. Select an installed model suited to your RAM. A tiny model is useful for testing but can produce poor medical summaries; Treatable keeps structured screening separate from narration.
3. Build/load the unpacked extension as described in the extension README.
4. From the durable project directory, run:

```sh
node extension/native/install.mjs --manifest extension/dist/manifest.json
```

The installer copies its executable files into `~/Library/Application Support/Treatable/native-host` and registers only the pinned Treatable extension ID (`lmgmjeabbalehlcakdbolielnfgchojf`) under Chrome's `NativeMessagingHosts`. It resolves an absolute Node executable path, so Chrome does not need your terminal's PATH or a git worktree. It does not change existing Ollama settings, start a global daemon, or download a model. Restart the extension after installation.

Use `--ollama /absolute/path/to/ollama` if needed. Use `--models-dir /absolute/path/to/models` for an existing custom model store; that directory must contain `manifests` and `blobs`. The helper uses only models with positively verified local weight files, completion capability, and no remote metadata. Cloud tags and unknown aliases are rejected.

If the helper or a usable model is missing, local search and deterministic screening continue. The panel explains setup rather than sending data elsewhere. Local generation has a 60-second deadline and Stop cancels the request. Each native connection owns a separate temporary loopback daemon, which is stopped when the connection closes.

## Privacy boundaries

- The helper does not log prompts, profiles or generated text; Ollama subprocess output is discarded and debug logging is disabled.
- Profile/page text never goes to OpenAI or another cloud provider through this helper. The dedicated daemon explicitly disables Ollama cloud execution. Runtime/model names alone are returned during status checks.
- No patient information belongs in filenames, URL parameters or error messages. Model download/setup traffic is separate from matching.
- Ordinary browsing of an external website still uses that website's network. The extension's private analysis does not conceal that browsing from the site.
- Native messaging does not protect against malicious software already running as the same OS user. Extension-local storage is not a promise of encrypted-at-rest storage.

## Uninstall

```sh
node extension/native/install.mjs --uninstall
```

This removes the exact helper registration and copied helper files. It retains local model downloads and browser data; clear patient data inside the extension separately.

## Verification

```sh
node --test extension/native/test/*.test.mjs
```

The native protocol is length-prefixed UTF-8 JSON. Operations are restricted to status, local generation, and cancellation. Invalid origins, unsupported operations, oversized messages and nonlocal models are rejected without exposing patient content in errors.
