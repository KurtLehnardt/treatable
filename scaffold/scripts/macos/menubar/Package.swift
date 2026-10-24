// swift-tools-version:5.9
//
// Treatable's macOS menu-bar helper: the counterpart of the Windows tray's
// NotifyIcon (scaffold/scripts/windows/treatable-tray.ps1). A small native
// AppKit executable rather than an Electron tray, so running Treatable in the
// background costs about what it costs on Windows -- where the tray is a
// scripted native icon, not a second long-lived runtime.
//
// Built with the Swift toolchain that ships with the Xcode Command Line
// Tools; there is no Xcode project and none is needed:
//
//   swift build -c release --package-path scaffold/scripts/macos/menubar
//
// scaffold/scripts/macos/treatable-tray.sh runs exactly that the first time
// Treatable starts in the background, and CI builds it the same way.
import PackageDescription

let package = Package(
  name: "treatable-menubar",
  platforms: [.macOS(.v12)],
  products: [
    .executable(name: "treatable-menubar", targets: ["TreatableMenuBar"])
  ],
  targets: [
    .executableTarget(name: "TreatableMenuBar", path: "Sources/TreatableMenuBar")
  ]
)
