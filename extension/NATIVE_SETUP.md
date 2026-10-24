# Current native setup

The current MVP uses a typed **stdio-only OpenAI bridge**, not the earlier Ollama HTTP helper.

Follow [native/API_SETUP.md](native/API_SETUP.md) for build, installation, secure Keychain configuration, required API permissions, lifecycle and provider-retention limits. Use only the dedicated terminal prompt; never provide an API key in chat or Chrome.

Neither a configured credential nor mocked tests prove live API access. No real patient data is accepted by this bridge; only compiled fictional fixtures and fixed public study records are supported.
