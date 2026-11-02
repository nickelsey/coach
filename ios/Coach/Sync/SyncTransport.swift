import Foundation

/// How the sync engine talks to the server. The HTTP implementation is below;
/// tests use a fake.
protocol SyncTransport: Sendable {
    func push(_ changes: Changes) async throws -> PushResult
    func pull(since cursor: Int64, limit: Int) async throws -> PullResult
}

enum SyncError: LocalizedError {
    case notConfigured
    case invalidURL
    case http(status: Int, message: String)
    case badResponse

    var errorDescription: String? {
        switch self {
        case .notConfigured: "Server address or token not set."
        case .invalidURL: "Server address isn't a valid https:// URL."
        case .http(let status, let message): "Server returned \(status): \(message)"
        case .badResponse: "Unexpected response from server."
        }
    }
}

struct HTTPTransport: SyncTransport {
    let baseURL: URL
    let token: String
    var session: URLSession = .shared

    init(config: ServerConfig, session: URLSession = .shared) throws {
        guard config.isComplete else { throw SyncError.notConfigured }
        guard let url = URL(string: config.url.trimmingCharacters(in: .whitespaces)),
            url.scheme == "https", url.host() != nil
        else { throw SyncError.invalidURL }
        self.baseURL = url
        self.token = config.token
        self.session = session
    }

    /// Checks reachability (no auth) and then the token (an empty pull page).
    func check() async throws {
        _ = try await send(URLRequest(url: baseURL.appending(path: "healthz")))
        _ = try await pull(since: Int64.max - 1, limit: 1)
    }

    func push(_ changes: Changes) async throws -> PushResult {
        var req = URLRequest(url: baseURL.appending(path: "v1/sync/push"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try Wire.encoder().encode(changes)
        return try await Wire.decoder().decode(PushResult.self, from: send(authorized(req)))
    }

    func pull(since cursor: Int64, limit: Int) async throws -> PullResult {
        let url = baseURL.appending(path: "v1/sync/pull").appending(queryItems: [
            URLQueryItem(name: "since", value: String(cursor)),
            URLQueryItem(name: "limit", value: String(limit)),
        ])
        return try await Wire.decoder().decode(PullResult.self, from: send(authorized(URLRequest(url: url))))
    }

    private func authorized(_ req: URLRequest) -> URLRequest {
        var req = req
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 20
        return req
    }

    private func send(_ req: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw SyncError.badResponse }
        guard http.statusCode == 200 else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw SyncError.http(status: http.statusCode, message: message ?? "no details")
        }
        return data
    }
}
