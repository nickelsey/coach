import Foundation
import Security

/// Where the server is and how to authenticate. The URL lives in
/// UserDefaults; the token lives in the Keychain.
struct ServerConfig: Equatable, Sendable {
    var url: String
    var token: String

    var isComplete: Bool {
        !url.trimmingCharacters(in: .whitespaces).isEmpty && !token.isEmpty
    }
}

struct ServerConfigStore: Sendable {
    private static let urlKey = "server.url"
    private static let keychainService = "dev.coach.api-token"

    func load() -> ServerConfig {
        ServerConfig(
            url: UserDefaults.standard.string(forKey: Self.urlKey) ?? "",
            token: Self.readToken() ?? "")
    }

    func save(_ config: ServerConfig) {
        UserDefaults.standard.set(config.url.trimmingCharacters(in: .whitespaces), forKey: Self.urlKey)
        Self.writeToken(config.token.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: keychainService]
    }

    private static func readToken() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
            let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func writeToken(_ token: String) {
        SecItemDelete(baseQuery as CFDictionary)
        guard !token.isEmpty else { return }
        var query = baseQuery
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(query as CFDictionary, nil)
    }
}
