import ArgentKit
import ArgentProtocol
import Foundation

// Prefer the ArgentKit wrapper to keep gateway request payloads consistent.
typealias AnyCodable = ArgentKit.AnyCodable
typealias InstanceIdentity = ArgentKit.InstanceIdentity

extension AnyCodable {
    var stringValue: String? { self.value as? String }
    var boolValue: Bool? { self.value as? Bool }
    var intValue: Int? { self.value as? Int }
    var doubleValue: Double? { self.value as? Double }
    var dictionaryValue: [String: AnyCodable]? { self.value as? [String: AnyCodable] }
    var arrayValue: [AnyCodable]? { self.value as? [AnyCodable] }

    var foundationValue: Any {
        switch self.value {
        case let dict as [String: AnyCodable]:
            dict.mapValues { $0.foundationValue }
        case let array as [AnyCodable]:
            array.map(\.foundationValue)
        default:
            self.value
        }
    }
}

extension ArgentProtocol.AnyCodable {
    var stringValue: String? { self.value as? String }
    var boolValue: Bool? { self.value as? Bool }
    var intValue: Int? { self.value as? Int }
    var doubleValue: Double? { self.value as? Double }
    var dictionaryValue: [String: ArgentProtocol.AnyCodable]? { self.value as? [String: ArgentProtocol.AnyCodable] }
    var arrayValue: [ArgentProtocol.AnyCodable]? { self.value as? [ArgentProtocol.AnyCodable] }

    var foundationValue: Any {
        switch self.value {
        case let dict as [String: ArgentProtocol.AnyCodable]:
            dict.mapValues { $0.foundationValue }
        case let array as [ArgentProtocol.AnyCodable]:
            array.map(\.foundationValue)
        default:
            self.value
        }
    }
}
