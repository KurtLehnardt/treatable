// Test harness for the Keychain rename migration in ../credential.swift.
// credential-migration.test.mjs compiles both files with -D TREATABLE_CREDENTIAL_TESTS, which leaves out
// the real Keychain backend and the command dispatch, so this binary can only use the in-memory store below.
// It prints one line per check and never prints a secret.
import Foundation
import Security

let fakeKey = Data("sk-fakeMigrationKey_0123456789abcdefXYZ".utf8)
let otherKey = Data("sk-otherFakeKey_9876543210zyxwvuABC".utf8)

final class FakeKeychain: CredentialStore {
    var items: [String: Data] = [:]
    var labels: [String: String] = [:]
    var log: [String] = []
    /// Forced status for copySecret, per service (for example locked or declined).
    var copyStatus: [String: OSStatus] = [:]
    /// Forced status for copySecret of the current item once it exists (the migration read-back).
    var readBackStatus: OSStatus?
    /// Bytes returned for the current item once it exists, instead of what was stored.
    var readBackValue: Data?
    /// Runs before every copySecret, to simulate a concurrent writer.
    var onCopy: ((FakeKeychain, String) -> Void)?
    var addStatus: OSStatus?
    var updateStatus: OSStatus?
    var deleteStatus: [String: OSStatus] = [:]

    func presence(_ service: String) -> OSStatus {
        log.append("presence \(service)")
        return items[service] == nil ? errSecItemNotFound : errSecSuccess
    }
    func copySecret(_ service: String) -> (status: OSStatus, secret: Data?) {
        log.append("copy \(service)")
        onCopy?(self, service)
        if let forced = copyStatus[service] { return (forced, nil) }
        guard let secret = items[service] else { return (errSecItemNotFound, nil) }
        if service == currentService {
            if let forced = readBackStatus { return (forced, nil) }
            if let value = readBackValue { return (errSecSuccess, value) }
        }
        return (errSecSuccess, secret)
    }
    func add(_ service: String, label: String, secret: Data) -> OSStatus {
        log.append("add \(service)")
        if let forced = addStatus { return forced }
        if items[service] != nil { return errSecDuplicateItem }
        items[service] = secret
        labels[service] = label
        return errSecSuccess
    }
    func update(_ service: String, secret: Data) -> OSStatus {
        log.append("update \(service)")
        if let forced = updateStatus { return forced }
        guard items[service] != nil else { return errSecItemNotFound }
        items[service] = secret
        return errSecSuccess
    }
    func delete(_ service: String) -> OSStatus {
        log.append("delete \(service)")
        if let forced = deleteStatus[service] { return forced }
        return items.removeValue(forKey: service) == nil ? errSecItemNotFound : errSecSuccess
    }
    var writes: [String] { log.filter { !$0.hasPrefix("copy ") && !$0.hasPrefix("presence ") } }
}

var failures = 0
var allStores: [FakeKeychain] = []

func store(current: Data? = nil, legacy: Data? = nil) -> FakeKeychain {
    let s = FakeKeychain()
    if let current = current { s.items[currentService] = current; s.labels[currentService] = currentLabel }
    if let legacy = legacy { s.items[legacyService] = legacy; s.labels[legacyService] = "old label" }
    allStores.append(s)
    return s
}
func check(_ name: String, _ condition: Bool) {
    // Names describe the check only; they never include secret bytes.
    print("\(condition ? "ok" : "FAIL") \(name)")
    if !condition { failures += 1 }
}
func found(_ lookup: Lookup, _ expected: Data) -> Bool {
    if case .found(let data) = lookup { return data == expected }
    return false
}
func isMissing(_ lookup: Lookup) -> Bool { if case .missing = lookup { return true }; return false }
func isUnavailable(_ lookup: Lookup) -> Bool { if case .unavailable = lookup { return true }; return false }

@main
struct Harness {
    static func main() {
        do { // Legacy item only: copy, verify, then delete the legacy item.
            let s = store(legacy: fakeKey)
            let (lookup, migration) = loadCredential(s)
            check("legacy-only read returns the legacy key", found(lookup, fakeKey))
            check("legacy-only read migrates", migration == .migrated)
            check("migrated key is in the current item", s.items[currentService] == fakeKey)
            check("migrated item has the neutral label", s.labels[currentService] == "Treatable OpenAI API key")
            check("legacy item deleted after migration", s.items[legacyService] == nil)
            check("migration order is copy legacy, add, verify, delete legacy",
                  s.log == ["copy \(currentService)", "copy \(legacyService)", "add \(currentService)", "copy \(currentService)", "delete \(legacyService)"])
            let again = loadCredential(s)
            check("next read uses the current item without writes", found(again.lookup, fakeKey) && again.migration == .notNeeded && s.writes.count == 2)
            check("status after migration", credentialStatus(s) == CredentialStatus(configured: true, migrationPending: false))
        }
        do { // Current item present: no fallback, no writes, legacy untouched by reads.
            let s = store(current: otherKey, legacy: fakeKey)
            let (lookup, migration) = loadCredential(s)
            check("current item wins over legacy", found(lookup, otherKey) && migration == .notNeeded)
            check("read with both items writes nothing", s.writes.isEmpty && s.items[legacyService] == fakeKey)
        }
        do { // Neither item.
            let s = store()
            let (lookup, migration) = loadCredential(s)
            check("no items reads as missing", isMissing(lookup) && migration == .notNeeded && s.writes.isEmpty)
        }
        do { // Current item locked or declined: never fall back to, or migrate, the legacy item.
            let s = store(current: otherKey, legacy: fakeKey)
            s.copyStatus[currentService] = errSecInteractionNotAllowed
            let (lookup, _) = loadCredential(s)
            check("locked current item is unavailable without fallback", isUnavailable(lookup) && s.writes.isEmpty && !s.log.contains("copy \(legacyService)"))
        }
        do { // Legacy item locked or access declined: nothing changes.
            let s = store(legacy: fakeKey)
            s.copyStatus[legacyService] = errSecUserCanceled
            let (lookup, migration) = loadCredential(s)
            check("declined legacy access is unavailable and changes nothing", isUnavailable(lookup) && migration == .notNeeded && s.writes.isEmpty && s.items[legacyService] == fakeKey)
        }
        do { // Adding the current item fails: keep working from the legacy item.
            let s = store(legacy: fakeKey)
            s.addStatus = errSecIO
            let (lookup, migration) = loadCredential(s)
            check("add failure still returns the legacy key", found(lookup, fakeKey) && migration == .failed)
            check("add failure keeps the legacy item and adds nothing", s.items[legacyService] == fakeKey && s.items[currentService] == nil && !s.log.contains("delete \(legacyService)"))
        }
        do { // A concurrent run already created the current item: this run deletes nothing.
            let s = store(legacy: fakeKey)
            s.addStatus = errSecDuplicateItem
            let (lookup, migration) = loadCredential(s)
            check("duplicate add leaves both items to the other run", found(lookup, fakeKey) && migration == .failed && s.writes == ["add \(currentService)"])
        }
        do { // Read-back mismatch: roll back the new item, keep the legacy item.
            let s = store(legacy: fakeKey)
            s.readBackValue = Data("corrupted".utf8)
            let (lookup, migration) = loadCredential(s)
            check("read-back mismatch returns the legacy key", found(lookup, fakeKey) && migration == .failed)
            check("read-back mismatch removes the new item and keeps the legacy item", s.items[currentService] == nil && s.items[legacyService] == fakeKey && !s.log.contains("delete \(legacyService)"))
            s.readBackValue = nil
            let retry = loadCredential(s)
            check("a later read retries the migration", found(retry.lookup, fakeKey) && retry.migration == .migrated && s.items[legacyService] == nil)
        }
        do { // Read-back error: same as a mismatch.
            let s = store(legacy: fakeKey)
            s.readBackStatus = errSecInteractionNotAllowed
            let (lookup, migration) = loadCredential(s)
            check("read-back error keeps the legacy item", found(lookup, fakeKey) && migration == .failed && s.items[currentService] == nil && s.items[legacyService] == fakeKey)
        }
        do { // A concurrent configure replaced the current item before the read-back: keep its key.
            let s = store(legacy: fakeKey)
            s.readBackValue = otherKey
            let (lookup, migration) = loadCredential(s)
            check("a different accepted key at read-back is not rolled back", found(lookup, fakeKey) && migration == .failed && s.items[currentService] != nil && !s.log.contains("delete \(currentService)") && !s.log.contains("delete \(legacyService)"))
        }
        do { // Read-back error after a concurrent run already deleted the legacy item: keep the current item.
            let s = store(legacy: fakeKey)
            s.onCopy = { fake, service in
                if service == currentService && fake.items[currentService] != nil { fake.items[legacyService] = nil; fake.readBackStatus = errSecInteractionNotAllowed }
            }
            let (_, migration) = loadCredential(s)
            check("no rollback once the legacy item is gone", migration == .failed && s.items[currentService] == fakeKey && !s.log.contains("delete \(currentService)"))
        }
        do { // A concurrent run moved the key between the two lookups: the retry finds the current item.
            let s = store(legacy: fakeKey)
            s.onCopy = { fake, service in
                if service == legacyService && fake.items[legacyService] != nil { fake.items[currentService] = fake.items[legacyService]; fake.items[legacyService] = nil }
            }
            let (lookup, migration) = loadCredential(s)
            check("a key moved concurrently is still found", found(lookup, fakeKey) && migration == .notNeeded && s.writes.isEmpty)
        }
        do { // Legacy delete fails after a verified copy.
            let s = store(legacy: fakeKey)
            s.deleteStatus[legacyService] = errSecIO
            let (lookup, migration) = loadCredential(s)
            check("legacy delete failure still migrates", found(lookup, fakeKey) && migration == .migratedLegacyKept && s.items[currentService] == fakeKey && s.items[legacyService] == fakeKey)
            check("status reports a pending migration while the legacy item remains", credentialStatus(s) == CredentialStatus(configured: true, migrationPending: true))
            s.deleteStatus = [:]
            check("migrate removes the superseded legacy item", runMigration(s) == .legacyRemoved && s.items[legacyService] == nil && s.items[currentService] == fakeKey)
        }
        do { // A legacy secret in an unaccepted format is not copied.
            let s = store(legacy: Data("not-a-key".utf8))
            let (_, migration) = loadCredential(s)
            check("unaccepted legacy secret is not migrated", migration == .legacyRejected && s.writes.isEmpty && s.items[legacyService] != nil)
            check("migrate: unaccepted legacy secret points to configure", migrateResult(runMigration(s)).message.contains("configure") && s.items[legacyService] != nil)
        }
        do { // Status reads metadata only.
            let none = store(), legacy = store(legacy: fakeKey), current = store(current: fakeKey), both = store(current: fakeKey, legacy: otherKey)
            check("status: none", credentialStatus(none) == CredentialStatus(configured: false, migrationPending: false))
            check("status: legacy only is configured and pending", credentialStatus(legacy) == CredentialStatus(configured: true, migrationPending: true))
            check("status: current only", credentialStatus(current) == CredentialStatus(configured: true, migrationPending: false))
            check("status: both", credentialStatus(both) == CredentialStatus(configured: true, migrationPending: true))
            check("status never reads a secret or writes", [none, legacy, current, both].allSatisfy { $0.log.allSatisfy { $0.hasPrefix("presence ") } })
            check("status JSON", statusJSON(CredentialStatus(configured: true, migrationPending: true)) == "{\"configured\":true,\"migrationPending\":true}"
                  && statusJSON(CredentialStatus(configured: false, migrationPending: false)) == "{\"configured\":false,\"migrationPending\":false}")
        }
        do { // configure writes only the current item.
            let s = store(legacy: otherKey)
            check("configure saves and removes the superseded legacy item", saveCredential(s, secret: fakeKey) == .saved && s.items[currentService] == fakeKey && s.items[legacyService] == nil)
            check("configure never writes the legacy item", !s.log.contains("add \(legacyService)") && !s.log.contains("update \(legacyService)"))
            check("configure labels the new item", s.labels[currentService] == currentLabel)
            let existing = store(current: otherKey)
            check("configure replaces an existing current item", saveCredential(existing, secret: fakeKey) == .saved && existing.items[currentService] == fakeKey && existing.log.contains("update \(currentService)") && !existing.log.contains("add \(currentService)"))
            let failing = store(legacy: otherKey)
            failing.addStatus = errSecIO
            check("configure failure keeps the legacy item", saveCredential(failing, secret: fakeKey) == .failed && failing.items[legacyService] == otherKey)
            let stuck = store(legacy: otherKey)
            stuck.deleteStatus[legacyService] = errSecIO
            check("configure reports a legacy item it could not remove", saveCredential(stuck, secret: fakeKey) == .savedLegacyKept && stuck.items[currentService] == fakeKey)
        }
        do { // The explicit migrate operation.
            check("migrate: nothing to migrate", runMigration(store()) == .nothingToMigrate)
            let legacy = store(legacy: fakeKey)
            check("migrate: legacy only moves the key", runMigration(legacy) == .moved(.migrated) && legacy.items[currentService] == fakeKey && legacy.items[legacyService] == nil)
            check("migrate: already current", runMigration(store(current: fakeKey)) == .alreadyCurrent)
            let invalid = store(current: Data("garbage".utf8), legacy: fakeKey)
            check("migrate: invalid current item keeps the legacy item", runMigration(invalid) == .currentInvalid && invalid.items[legacyService] == fakeKey)
            let locked = store(current: fakeKey, legacy: otherKey)
            locked.copyStatus[currentService] = errSecInteractionNotAllowed
            check("migrate: locked current item changes nothing", runMigration(locked) == .unavailable && locked.writes.isEmpty)
            let declined = store(legacy: fakeKey)
            declined.copyStatus[legacyService] = errSecAuthFailed
            check("migrate: declined legacy access changes nothing", runMigration(declined) == .unavailable && declined.writes.isEmpty)
            let rollback = store(legacy: fakeKey)
            rollback.readBackValue = Data("corrupted".utf8)
            check("migrate: failed verification keeps the legacy item", runMigration(rollback) == .moved(.failed) && rollback.items[legacyService] == fakeKey && rollback.items[currentService] == nil)
            let stuck = store(current: fakeKey, legacy: otherKey)
            stuck.deleteStatus[legacyService] = errSecIO
            check("migrate: reports a legacy item it could not remove", runMigration(stuck) == .legacyRemoveFailed)
        }
        do { // remove deletes both items.
            let s = store(current: fakeKey, legacy: otherKey)
            check("remove deletes both items", removeCredentials(s) && s.items.isEmpty)
            check("remove with no items succeeds", removeCredentials(store()))
            let stuck = store(legacy: fakeKey)
            stuck.deleteStatus[legacyService] = errSecIO
            check("remove reports a failure", !removeCredentials(stuck))
        }
        do { // Item attributes match what configure has always used: not synchronizable, dedicated service/account.
            let attributes = addAttributes(currentService, label: currentLabel, secret: fakeKey)
            check("new items are not synchronizable", (attributes[kSecAttrSynchronizable as String] as? Bool) == false)
            check("new items use the current service and account", (attributes[kSecAttrService as String] as? String) == "com.treatable.openai" && (attributes[kSecAttrAccount as String] as? String) == "api-key")
            check("new items carry the neutral label", (attributes[kSecAttrLabel as String] as? String) == "Treatable OpenAI API key")
            check("new items set no other access attributes", Set(attributes.keys) == Set([kSecClass, kSecAttrService, kSecAttrAccount, kSecValueData, kSecAttrLabel, kSecAttrSynchronizable].map { $0 as String }))
        }
        do { // Messages are fixed text: no secret, no legacy service name.
            var messages: [String] = [SaveOutcome.saved, .savedLegacyKept, .failed].map(saveMessage)
            let outcomes: [MigrateOutcome] = [.nothingToMigrate, .alreadyCurrent, .legacyRemoved, .legacyRemoveFailed, .currentInvalid, .unavailable,
                                              .moved(.migrated), .moved(.notNeeded), .moved(.migratedLegacyKept), .moved(.failed), .moved(.legacyRejected)]
            messages += outcomes.map { migrateResult($0).message }
            messages.append(statusJSON(CredentialStatus(configured: true, migrationPending: true)))
            let secrets = [fakeKey, otherKey].map { String(decoding: $0, as: UTF8.self) }
            check("messages never contain a secret", messages.allSatisfy { m in secrets.allSatisfy { !m.contains($0) && !m.contains(String($0.dropFirst(3))) } })
            check("messages never name the legacy service", messages.allSatisfy { !$0.contains(legacyService) && !$0.lowercased().contains("hackathon") })
            check("unfinished migrate outcomes exit non-zero", [MigrateOutcome.legacyRemoveFailed, .currentInvalid, .unavailable, .moved(.migratedLegacyKept), .moved(.failed), .moved(.legacyRejected)].allSatisfy { migrateResult($0).code != 0 })
        }
        check("only the two Treatable services were touched",
              allStores.allSatisfy { $0.log.allSatisfy { $0.hasSuffix(" \(currentService)") || $0.hasSuffix(" \(legacyService)") } })
        print(failures == 0 ? "ALL PASSED" : "FAILURES \(failures)")
        exit(failures == 0 ? 0 : 1)
    }
}
