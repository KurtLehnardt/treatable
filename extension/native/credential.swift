import Foundation
import Security
import LocalAuthentication
import Darwin

// Dedicated Treatable items only. Never enumerate or look up another application's credentials.
let account = "api-key"
let currentService = "com.treatable.openai"
let currentLabel = "Treatable OpenAI API key"
// Service name used by earlier releases. The helper never writes to this item: it only reads it to
// copy the key into currentService, and deletes it once that copy has been verified.
let legacyService = "com.treatable.hackathon.openai"

// sk- prefix, 20-503 bytes (the native reader accepts at most sk- plus 500), and only [A-Za-z0-9_-]: no whitespace or control characters.
func acceptedKey(_ bytes: UnsafePointer<CChar>, _ length: Int) -> Bool {
    guard length >= 20 && length <= 503,
          bytes[0] == 0x73, bytes[1] == 0x6B, bytes[2] == 0x2D else { return false }
    for index in 3..<length {
        let c = UInt8(bitPattern: bytes[index])
        let allowed = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x2D || c == 0x5F
        if !allowed { return false }
    }
    return true
}
func acceptedKey(_ data: Data) -> Bool {
    return data.withUnsafeBytes { raw -> Bool in
        guard let base = raw.baseAddress else { return false }
        return acceptedKey(base.assumingMemoryBound(to: CChar.self), raw.count)
    }
}
/// Best-effort zeroing of a secret copy this code owns, then drops it.
func wipeSecret(_ secret: inout Data?) {
    if secret != nil { secret!.resetBytes(in: 0..<secret!.count) }
    secret = nil
}

/// The Keychain operations the helper needs, each scoped to the single generic-password item
/// (service, account "api-key"). SystemKeychain is the production implementation; the migration
/// tests substitute an in-memory store so they never touch a real Keychain.
protocol CredentialStore {
    /// Looks up the item's attributes only: never its secret, and never with user interaction.
    func presence(_ service: String) -> OSStatus
    /// Copies the item's secret. macOS may ask the user to allow access.
    func copySecret(_ service: String) -> (status: OSStatus, secret: Data?)
    /// Adds a new item that is not synchronized to other devices.
    func add(_ service: String, label: String, secret: Data) -> OSStatus
    /// Replaces the secret of an existing item.
    func update(_ service: String, secret: Data) -> OSStatus
    func delete(_ service: String) -> OSStatus
}

enum Lookup {
    case found(Data)
    case missing
    case unavailable
}

enum Migration: Equatable {
    /// The current item was used, or there was nothing to move.
    case notNeeded
    /// The key was copied into the current item, read back identically, and the legacy item was deleted.
    case migrated
    /// The key was copied and verified, but the legacy item could not be deleted.
    case migratedLegacyKept
    /// Nothing was moved. The legacy item is untouched and still in use.
    case failed
    /// The legacy item does not hold an accepted key, so it was neither copied nor deleted.
    case legacyRejected
}

/// Copies the legacy secret into the current item, verifies that it reads back identically, and only
/// then deletes the legacy item. If the copy or its verification fails, the legacy item is left in place
/// and an item this run added is removed again, so the next read keeps working from the legacy item.
func migrate(_ store: CredentialStore, legacySecret: Data) -> Migration {
    guard acceptedKey(legacySecret) else { return .legacyRejected }
    let added = store.add(currentService, label: currentLabel, secret: legacySecret)
    // errSecDuplicateItem means a concurrent run created the current item; that run owns the migration.
    guard added == errSecSuccess else { return .failed }
    let readStatus: OSStatus
    var readBack: Data?
    (readStatus, readBack) = store.copySecret(currentService)
    let verified = readStatus == errSecSuccess && readBack == legacySecret
    // A different accepted key means a concurrent configure replaced the item; it is not ours to remove.
    let replacedByOtherWriter = readStatus == errSecSuccess && readBack.map { acceptedKey($0) } == true && !verified
    wipeSecret(&readBack)
    guard verified else {
        // Roll back only while the legacy item still exists to fall back to. If it is gone, a concurrent
        // run finished the migration and the current item must stay.
        if !replacedByOtherWriter && store.presence(legacyService) == errSecSuccess { _ = store.delete(currentService) }
        return .failed
    }
    let removed = store.delete(legacyService)
    return removed == errSecSuccess || removed == errSecItemNotFound ? .migrated : .migratedLegacyKept
}

/// Returns the secret the native helper should use. The current item wins; when it is missing and a
/// legacy item exists, the legacy secret is returned and migrated. A current item that exists but is
/// locked or declined is reported as unavailable without falling back to the legacy item.
func loadCredential(_ store: CredentialStore) -> (lookup: Lookup, migration: Migration) {
    let current = store.copySecret(currentService)
    if current.status == errSecSuccess, let secret = current.secret { return (.found(secret), .notNeeded) }
    guard current.status == errSecItemNotFound else { return (.unavailable, .notNeeded) }
    let legacy = store.copySecret(legacyService)
    if legacy.status == errSecItemNotFound {
        // A concurrent run may have just moved the key; look at the current item once more.
        let retry = store.copySecret(currentService)
        if retry.status == errSecSuccess, let secret = retry.secret { return (.found(secret), .notNeeded) }
        return (retry.status == errSecItemNotFound ? .missing : .unavailable, .notNeeded)
    }
    guard legacy.status == errSecSuccess, let secret = legacy.secret else { return (.unavailable, .notNeeded) }
    return (.found(secret), migrate(store, legacySecret: secret))
}

struct CredentialStatus: Equatable {
    let configured: Bool
    let migrationPending: Bool
}

func credentialStatus(_ store: CredentialStore) -> CredentialStatus {
    let current = store.presence(currentService) == errSecSuccess
    let legacy = store.presence(legacyService) == errSecSuccess
    return CredentialStatus(configured: current || legacy, migrationPending: legacy)
}

func statusJSON(_ status: CredentialStatus) -> String {
    return "{\"configured\":\(status.configured),\"migrationPending\":\(status.migrationPending)}"
}

enum SaveOutcome: Equatable {
    case saved
    case savedLegacyKept
    case failed
}

/// Writes only the current item. Once it is saved, the superseded legacy item is deleted (best effort).
func saveCredential(_ store: CredentialStore, secret: Data) -> SaveOutcome {
    var status = store.update(currentService, secret: secret)
    if status == errSecItemNotFound { status = store.add(currentService, label: currentLabel, secret: secret) }
    guard status == errSecSuccess else { return .failed }
    let removed = store.delete(legacyService)
    return removed == errSecSuccess || removed == errSecItemNotFound ? .saved : .savedLegacyKept
}

func saveMessage(_ outcome: SaveOutcome) -> String {
    switch outcome {
    case .saved: return "Treatable credential saved in macOS Keychain. API access has not been tested."
    case .savedLegacyKept: return "Treatable credential saved in macOS Keychain. API access has not been tested. The item from an earlier Treatable version could not be removed; run credential setup migrate to retry."
    case .failed: return "Keychain could not save the dedicated Treatable credential."
    }
}

enum MigrateOutcome: Equatable {
    case nothingToMigrate
    case alreadyCurrent
    case legacyRemoved
    case legacyRemoveFailed
    case currentInvalid
    case unavailable
    case moved(Migration)
}

/// The explicit `migrate` operation. Besides moving a legacy-only key, it removes a legacy item that a
/// readable, accepted current item has superseded (for example after an interrupted migration).
func runMigration(_ store: CredentialStore) -> MigrateOutcome {
    let currentStatus: OSStatus
    var currentSecret: Data?
    (currentStatus, currentSecret) = store.copySecret(currentService)
    if currentStatus == errSecSuccess, currentSecret != nil {
        let accepted = acceptedKey(currentSecret!)
        wipeSecret(&currentSecret)
        guard accepted else { return .currentInvalid }
        let removed = store.delete(legacyService)
        if removed == errSecItemNotFound { return .alreadyCurrent }
        return removed == errSecSuccess ? .legacyRemoved : .legacyRemoveFailed
    }
    guard currentStatus == errSecItemNotFound else { return .unavailable }
    let legacyStatus: OSStatus
    var legacySecret: Data?
    (legacyStatus, legacySecret) = store.copySecret(legacyService)
    defer { wipeSecret(&legacySecret) }
    guard legacyStatus == errSecSuccess, let secret = legacySecret else {
        return legacyStatus == errSecItemNotFound ? .nothingToMigrate : .unavailable
    }
    return .moved(migrate(store, legacySecret: secret))
}

/// Exit code and message for `migrate`. Messages never contain the secret.
func migrateResult(_ outcome: MigrateOutcome) -> (code: Int32, message: String) {
    switch outcome {
    case .nothingToMigrate: return (0, "No Keychain item from an earlier Treatable version was found. Nothing to migrate.")
    case .alreadyCurrent: return (0, "The Treatable key is already in the current Keychain item. Nothing to migrate.")
    case .legacyRemoved: return (0, "The Treatable key is already in the current Keychain item. Removed the superseded item from an earlier Treatable version.")
    case .legacyRemoveFailed: return (1, "The Treatable key is already in the current Keychain item, but the item from an earlier Treatable version could not be removed.")
    case .currentInvalid: return (1, "The current Treatable Keychain item does not hold an accepted key. Run credential setup configure to replace it. Nothing else was changed.")
    case .unavailable: return (2, "Keychain is locked or access was declined. Nothing was changed.")
    case .moved(.migrated), .moved(.notNeeded): return (0, "Moved the Treatable key to the current Keychain item and removed the item from an earlier Treatable version.")
    case .moved(.migratedLegacyKept): return (1, "Moved the Treatable key to the current Keychain item, but the item from an earlier Treatable version could not be removed. Run migrate again to retry.")
    case .moved(.failed): return (1, "Could not move the Treatable key. The item from an earlier Treatable version was left in place and is still used.")
    case .moved(.legacyRejected): return (1, "The item from an earlier Treatable version does not hold an accepted key. Run credential setup configure to store a new key.")
    }
}

/// Deletes both the current and the legacy item. Succeeds when neither remains.
func removeCredentials(_ store: CredentialStore) -> Bool {
    let removedCurrent = store.delete(currentService)
    let removedLegacy = store.delete(legacyService)
    return [removedCurrent, removedLegacy].allSatisfy { $0 == errSecSuccess || $0 == errSecItemNotFound }
}

func itemQuery(_ service: String) -> [String: Any] {
    return [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account]
}
/// Attributes for every item the helper creates, by configure and by migration alike: a generic password
/// that is not synchronizable, so iCloud Keychain never syncs it to other devices. These are the same
/// attributes the helper used before the rename.
func addAttributes(_ service: String, label: String, secret: Data) -> [String: Any] {
    var add = itemQuery(service)
    add[kSecValueData as String] = secret
    add[kSecAttrLabel as String] = label
    add[kSecAttrSynchronizable as String] = false
    return add
}

#if !TREATABLE_CREDENTIAL_TESTS
struct SystemKeychain: CredentialStore {
    func query(_ service: String) -> [String: Any] { return itemQuery(service) }
    func presence(_ service: String) -> OSStatus {
        var search = query(service)
        search[kSecReturnAttributes as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        let context = LAContext()
        context.interactionNotAllowed = true
        search[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        return SecItemCopyMatching(search as CFDictionary, &result)
    }
    func copySecret(_ service: String) -> (status: OSStatus, secret: Data?) {
        var search = query(service)
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(search as CFDictionary, &result)
        return (status, status == errSecSuccess ? result as? Data : nil)
    }
    func add(_ service: String, label: String, secret: Data) -> OSStatus {
        return SecItemAdd(addAttributes(service, label: label, secret: secret) as CFDictionary, nil)
    }
    func update(_ service: String, secret: Data) -> OSStatus {
        return SecItemUpdate(query(service) as CFDictionary, [kSecValueData as String: secret] as CFDictionary)
    }
    func delete(_ service: String) -> OSStatus {
        return SecItemDelete(query(service) as CFDictionary)
    }
}

func finish(_ code: Int32, _ message: String) -> Never {
    if !message.isEmpty { FileHandle.standardError.write(Data((message + "\n").utf8)) }
    exit(code)
}
/// Runs one helper operation. Success returns normally (exit status 0); every failure exits through finish.
func runHelper(_ arguments: [String], _ store: CredentialStore) {
    let operation = arguments.count == 2 ? arguments[1] : ""
    if operation == "configure" {
        // getpass truncates at 128 characters; sk-proj- keys are longer. readpassphrase reads from /dev/tty with echo off into a 1 KiB buffer.
        let capacity = 1024
        let buffer = UnsafeMutablePointer<CChar>.allocate(capacity: capacity)
        buffer.initialize(repeating: 0, count: capacity)
        func wipe() { memset(buffer, 0, capacity) }
        defer { wipe(); buffer.deallocate() }
        guard isatty(STDIN_FILENO) == 1,
              readpassphrase("OpenAI API key for Treatable (hidden): ", buffer, capacity, RPP_ECHO_OFF | RPP_REQUIRE_TTY) != nil else {
            wipe()
            finish(1, "Run credential setup in an interactive terminal. No key was saved.")
        }
        var length = strlen(buffer)
        while length > 0 && (buffer[length - 1] == 0x0A || buffer[length - 1] == 0x0D) {
            length -= 1
            buffer[length] = 0
        }
        guard acceptedKey(buffer, length) else {
            wipe()
            finish(1, "The key format was not accepted. No key was saved.")
        }
        var data = Data(bytes: buffer, count: length)
        wipe()
        defer { data.resetBytes(in: 0..<data.count) }
        let outcome = saveCredential(store, secret: data)
        guard outcome != .failed else { finish(1, saveMessage(outcome)) }
        FileHandle.standardOutput.write(Data((saveMessage(outcome) + "\n").utf8))
    } else if operation == "status" {
        FileHandle.standardOutput.write(Data(statusJSON(credentialStatus(store)).utf8))
    } else if operation == "read" {
        guard isatty(STDOUT_FILENO) == 0,
              ProcessInfo.processInfo.environment["TREATABLE_CREDENTIAL_PIPE"] == "1" else {
            finish(1, "Credential reads are restricted to the native helper pipe.")
        }
        guard case .found(var data) = loadCredential(store).lookup else { finish(2, "Treatable credential is missing, locked, or access was declined.") }
        defer { data.resetBytes(in: 0..<data.count) }
        FileHandle.standardOutput.write(data)
    } else if operation == "migrate" {
        let result = migrateResult(runMigration(store))
        guard result.code == 0 else { finish(result.code, result.message) }
        FileHandle.standardOutput.write(Data((result.message + "\n").utf8))
    } else if operation == "remove" {
        guard removeCredentials(store) else { finish(1, "Keychain could not remove the Treatable item.") }
        FileHandle.standardOutput.write(Data("Removed the dedicated Treatable credential.\n".utf8))
    } else {
        finish(1, "Use configure, status, migrate, or remove through the documented setup command.")
    }
}
// A top-level declaration rather than a statement, so the test build can still parse this file as a library.
let helperCompleted: Void = runHelper(CommandLine.arguments, SystemKeychain())
#endif
