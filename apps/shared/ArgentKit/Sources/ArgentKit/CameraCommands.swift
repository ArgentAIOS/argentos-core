import Foundation

public enum ArgentCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum ArgentCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum ArgentCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum ArgentCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct ArgentCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: ArgentCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: ArgentCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: ArgentCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: ArgentCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct ArgentCameraClipParams: Codable, Sendable, Equatable {
    public var facing: ArgentCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: ArgentCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: ArgentCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: ArgentCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
