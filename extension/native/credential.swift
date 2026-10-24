import Foundation
import Security
import LocalAuthentication
import Darwin

// Dedicated Treatable item only. Never enumerate or look up another application's credentials.
let service = "com.treatable.hackathon.openai"
let account = "api-key"
let operation = CommandLine.arguments.count == 2 ? CommandLine.arguments[1] : ""
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                            kSecAttrService as String: service,
                            kSecAttrAccount as String: account]
func finish(_ code: Int32, _ message: String) -> Never {
    if !message.isEmpty { FileHandle.standardError.write(Data((message + "\n").utf8)) }
    exit(code)
}
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
    let update = [kSecValueData as String: data]
    var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrLabel as String] = "Treatable hackathon OpenAI API key"
        add[kSecAttrSynchronizable as String] = false
        status = SecItemAdd(add as CFDictionary, nil)
    }
    guard status == errSecSuccess else { finish(1, "Keychain could not save the dedicated Treatable credential.") }
    FileHandle.standardOutput.write(Data("Treatable credential saved in macOS Keychain. API access has not been tested.\n".utf8))
} else if operation == "status" {
    var search = query
    search[kSecReturnAttributes as String] = true
    search[kSecMatchLimit as String] = kSecMatchLimitOne
    let context = LAContext()
    context.interactionNotAllowed = true
    search[kSecUseAuthenticationContext as String] = context
    var result: CFTypeRef?
    let status = SecItemCopyMatching(search as CFDictionary, &result)
    let configured = status == errSecSuccess
    FileHandle.standardOutput.write(Data((configured ? "{\"configured\":true}" : "{\"configured\":false}").utf8))
} else if operation == "read" {
    guard isatty(STDOUT_FILENO) == 0,
          ProcessInfo.processInfo.environment["TREATABLE_CREDENTIAL_PIPE"] == "1" else {
        finish(1, "Credential reads are restricted to the native helper pipe.")
    }
    var search = query
    search[kSecReturnData as String] = true
    search[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(search as CFDictionary, &result)
    guard status == errSecSuccess, var data = result as? Data else { finish(2, "Treatable credential is missing, locked, or access was declined.") }
    defer { data.resetBytes(in: 0..<data.count) }
    FileHandle.standardOutput.write(data)
} else if operation == "remove" {
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { finish(1, "Keychain could not remove the Treatable item.") }
    FileHandle.standardOutput.write(Data("Removed the dedicated Treatable credential.\n".utf8))
} else {
    finish(1, "Use configure, status, or remove through the documented setup command.")
}
