# Current native setup

The current MVP uses a typed **stdio-only OpenAI bridge**, not the earlier Ollama HTTP helper.

Follow [native/API_SETUP.md](native/API_SETUP.md) for build, installation, secure Keychain configuration, required API permissions, lifecycle and provider-retention limits. Use only the dedicated terminal prompt; never provide an API key in chat or Chrome.

Neither a configured credential nor mocked tests prove live API access. The helper serves two features only: AI-matched results, which sends condition terms and public records after a confirmation for the first OpenAI ranking in a browser session, and the study brief, which sends only public study IDs and record text. Raw private profiles, notes, exact location, arbitrary prompts and endpoints remain rejected.
