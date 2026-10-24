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
if operation == "configure" {
    guard isatty(STDIN_FILENO) == 1, let pointer = getpass("OpenAI API key for Treatable (hidden): ") else {
        finish(1, "Run credential setup in an interactive terminal. No key was saved.")
    }
    let length = strlen(pointer)
    defer { memset(pointer, 0, length) }
    guard length >= 13 && length <= 503,
          let text = String(validatingUTF8: pointer),
          text.range(of: "^sk-[A-Za-z0-9_-]{10,500}$", options: .regularExpression) != nil else {
        finish(1, "The key format was not accepted. No key was saved.")
    }
    var data = Data(bytes: pointer, count: length)
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
