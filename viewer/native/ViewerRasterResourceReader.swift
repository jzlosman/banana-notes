import Darwin
import Foundation

struct ViewerDirectoryIdentity: Equatable {
    let device: UInt64
    let inode: UInt64
}

struct ViewerFileContents {
    let data: Data
    let fingerprint: ViewerFileFingerprint
}

struct ViewerRasterImage {
    let data: Data
    let mimeType: String
}

/// Pins a canonical document directory before reading its Markdown or images.
/// All child access is relative to that descriptor and refuses symlinks.
final class ViewerRasterResourceReader {
    static let maximumBytes = 16 * 1024 * 1024
    private let rootDescriptor: Int32
    let directoryPath: String
    let directoryIdentity: ViewerDirectoryIdentity

    init(canonicalDocumentDirectory: URL) throws {
        let path = canonicalDocumentDirectory.path
        guard canonicalDocumentDirectory.isFileURL, path.hasPrefix("/"),
              path.split(separator: "/").allSatisfy({ $0 != "." && $0 != ".." }) else {
            throw ViewerError.invalidResource
        }
        let pinned = try Self.openPinnedDirectory(path)
        rootDescriptor = pinned.descriptor
        directoryPath = path
        directoryIdentity = pinned.identity
    }

    deinit { Darwin.close(rootDescriptor) }

    func readDocument(filename: String, maximumBytes: Int) throws -> ViewerFileContents {
        guard (1...Self.maximumBytes).contains(maximumBytes) else { throw ViewerError.unavailable }
        let descriptor = try openFile(filename)
        defer { Darwin.close(descriptor) }
        return try readFile(descriptor, maximumBytes: maximumBytes, oversized: .tooLarge)
    }

    func fingerprint(filename: String) throws -> ViewerFileFingerprint {
        let descriptor = try openFile(filename)
        defer { Darwin.close(descriptor) }
        return try Self.fileFingerprint(descriptor)
    }

    func replaceDocumentAtomically(filename: String, data: Data, maximumBytes: Int) throws {
        guard !filename.isEmpty, filename != ".", filename != "..", !filename.contains("/"),
              !filename.contains("\\"), !filename.contains("\0") else { throw ViewerFileWriteError.unknown }
        guard data.count <= maximumBytes else { throw ViewerFileWriteError.tooLarge }
        let current = filename.withCString { openat(rootDescriptor, $0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK) }
        guard current >= 0 else { throw Self.writeError(errno) }
        defer { Darwin.close(current) }
        var info = stat()
        guard fstat(current, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { throw ViewerFileWriteError.unknown }
        let mode = mode_t(info.st_mode & mode_t(0o7777))
        guard (mode & mode_t(0o222)) != 0 else { throw ViewerFileWriteError.readOnlyFile }

        let temporary = ".banana-viewer-\(UUID().uuidString).tmp"
        let output = temporary.withCString { openat(rootDescriptor, $0, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, mode) }
        guard output >= 0 else { throw Self.writeError(errno) }
        var keepTemporary = true
        defer {
            Darwin.close(output)
            if keepTemporary { temporary.withCString { _ = unlinkat(rootDescriptor, $0, 0) } }
        }
        guard fchmod(output, mode) == 0 else { throw Self.writeError(errno) }
        try data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < rawBuffer.count {
                let written = Darwin.write(output, base.advanced(by: offset), rawBuffer.count - offset)
                if written < 0 {
                    if errno == EINTR { continue }
                    throw Self.writeError(errno)
                }
                guard written > 0 else { throw ViewerFileWriteError.unknown }
                offset += written
            }
        }
        guard fsync(output) == 0 else { throw Self.writeError(errno) }
        let renamed = temporary.withCString { source in filename.withCString { target in renameat(rootDescriptor, source, rootDescriptor, target) } }
        guard renamed == 0 else { throw Self.writeError(errno) }
        keepTemporary = false
        guard fsync(rootDescriptor) == 0 else { throw Self.writeError(errno) }
    }

    func read(_ path: ViewerRasterPath) throws -> ViewerRasterImage {
        guard !path.components.isEmpty else { throw ViewerError.invalidResource }
        var directory = dup(rootDescriptor)
        guard directory >= 0 else { throw ViewerError.invalidResource }
        defer { Darwin.close(directory) }

        for component in path.components.dropLast() {
            let next = try Self.openAtDirectory(parent: directory, name: component)
            Darwin.close(directory)
            directory = next
        }
        let descriptor = try path.components.last!.withCString { name in
            let value = openat(directory, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
            guard value >= 0 else { throw ViewerError.invalidResource }
            return value
        }
        defer { Darwin.close(descriptor) }
        let file = try readFile(descriptor, maximumBytes: Self.maximumBytes, oversized: .invalidResource)
        return ViewerRasterImage(data: file.data, mimeType: path.mimeType)
    }

    private func openFile(_ filename: String) throws -> Int32 {
        guard !filename.isEmpty, filename != ".", filename != "..",
              !filename.contains("/"), !filename.contains("\\"), !filename.contains("\0") else {
            throw ViewerError.unavailable
        }
        let descriptor = filename.withCString { name in
            openat(rootDescriptor, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
        }
        guard descriptor >= 0 else { throw ViewerError.unavailable }
        return descriptor
    }

    private func readFile(_ descriptor: Int32, maximumBytes: Int, oversized: ViewerError) throws -> ViewerFileContents {
        let before = try Self.fileFingerprint(descriptor)
        guard before.size <= maximumBytes else { throw oversized }
        var data = Data()
        while data.count <= maximumBytes {
            let countToRead = min(64 * 1024, maximumBytes + 1 - data.count)
            var buffer = [UInt8](repeating: 0, count: countToRead)
            let count = buffer.withUnsafeMutableBytes { bytes -> Int in
                guard let baseAddress = bytes.baseAddress else { return 0 }
                return Darwin.read(descriptor, baseAddress, bytes.count)
            }
            if count < 0 {
                if errno == EINTR { continue }
                throw ViewerError.unavailable
            }
            if count == 0 { break }
            data.append(contentsOf: buffer.prefix(count))
        }
        let after = try Self.fileFingerprint(descriptor)
        guard data.count <= maximumBytes, before == after, data.count == after.size else {
            if data.count > maximumBytes { throw oversized }
            throw ViewerError.unavailable
        }
        return ViewerFileContents(data: data, fingerprint: after)
    }

    private static func writeError(_ code: Int32) -> ViewerFileWriteError {
        if code == EACCES || code == EPERM || code == EROFS { return .permissionDenied }
        return .unknown
    }

    private static func fileFingerprint(_ descriptor: Int32) throws -> ViewerFileFingerprint {
        var info = stat()
        guard fstat(descriptor, &info) == 0 else { throw ViewerError.unavailable }
        if (info.st_mode & S_IFMT) == S_IFDIR { throw ViewerError.directory }
        guard (info.st_mode & S_IFMT) == S_IFREG, info.st_size >= 0 else { throw ViewerError.unavailable }
        let modifiedAt = TimeInterval(info.st_mtimespec.tv_sec) + TimeInterval(info.st_mtimespec.tv_nsec) / 1_000_000_000
        return ViewerFileFingerprint(size: Int(info.st_size), modifiedAt: modifiedAt,
                                     device: UInt64(info.st_dev), inode: UInt64(info.st_ino))
    }

    private static func openPinnedDirectory(_ path: String) throws -> (descriptor: Int32, identity: ViewerDirectoryIdentity) {
        let flags = O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW
        var descriptor = open("/", flags)
        guard descriptor >= 0 else { throw ViewerError.unavailable }
        do {
            for component in path.split(separator: "/") {
                let next = try openAtDirectory(parent: descriptor, name: String(component))
                Darwin.close(descriptor)
                descriptor = next
            }
        } catch {
            Darwin.close(descriptor)
            throw error
        }
        var info = stat()
        guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR else {
            Darwin.close(descriptor)
            throw ViewerError.unavailable
        }
        return (descriptor, ViewerDirectoryIdentity(device: UInt64(info.st_dev), inode: UInt64(info.st_ino)))
    }

    private static func openAtDirectory(parent: Int32, name: String) throws -> Int32 {
        let descriptor = name.withCString { component in
            openat(parent, component, O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW)
        }
        guard descriptor >= 0 else { throw ViewerError.unavailable }
        return descriptor
    }
}
