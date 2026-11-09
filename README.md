# xcodebuild

A GitHub Action that wraps `xcrun xcodebuild` to build, archive, and export an Xcode project or workspace. Designed to compose with the rest of the Apple-Actions suite:

- [`Apple-Actions/import-codesign-certs`](https://github.com/Apple-Actions/import-codesign-certs)
- [`Apple-Actions/download-provisioning-profiles`](https://github.com/Apple-Actions/download-provisioning-profiles)
- [`Apple-Actions/upload-testflight-build`](https://github.com/Apple-Actions/upload-testflight-build)
- [`Apple-Actions/notarize`](https://github.com/Apple-Actions/notarize)

See [`Apple-Actions/Example-macOS`](https://github.com/Apple-Actions/Example-macOS) for a full macOS workflow that ships to TestFlight and as a notarized Developer ID DMG.

## Usage

### Simulator build (unsigned)

```yaml
- uses: Apple-Actions/xcodebuild@v1
  with:
    workspace: ios/MyApp.xcworkspace
    scheme: MyApp
    sdk: iphonesimulator
    build-number: ${{ github.run_number }}
```

### Device archive + IPA export

```yaml
- id: build
  uses: Apple-Actions/xcodebuild@v1
  with:
    workspace: ios/MyApp.xcworkspace
    scheme: MyApp
    sdk: iphoneos
    action: archive
    archive-path: .build/Archives/MyApp.xcarchive
    export-options-plist: ios/ExportOptions.plist
    build-number: ${{ github.run_number }}
```

### Automatic signing with App Store Connect API Key

Pass App Store Connect API key credentials directly to automatically update or download provisioning profiles during archive and export:

```yaml
- id: build
  uses: Apple-Actions/xcodebuild@v1
  with:
    project: App.xcodeproj
    scheme: App
    action: archive
    archive-path: .build/Archives/App.xcarchive
    export-options-plist: ExportOptions.plist
    build-number: ${{ github.run_number }}
    allow-provisioning-updates: true
    authentication-key-path: ${{ steps.setup.outputs.auth-key-path }}
    authentication-key-id: ${{ secrets.APPSTORE_API_KEY_ID }}
    authentication-key-issuer-id: ${{ secrets.APPSTORE_ISSUER_ID }}
```

### Build for testing, then run tests

Split compile and XCTest into two steps in the same job so build failures and test failures show separately. Both steps share the default DerivedData (`.build/DerivedData`); override `log-path` or `result-bundle-path` only if you need distinct artifacts beyond the defaults.

```yaml
- name: Build
  uses: Apple-Actions/xcodebuild@v1
  with:
    project: App.xcodeproj
    scheme: App
    configuration: Debug
    sdk: iphonesimulator
    destination: platform=iOS Simulator,OS=latest,name=iPhone 17
    action: build-for-testing

- name: Run Tests
  uses: Apple-Actions/xcodebuild@v1
  with:
    project: App.xcodeproj
    scheme: App
    configuration: Debug
    sdk: iphonesimulator
    destination: platform=iOS Simulator,OS=latest,name=iPhone 17
    action: test-without-building
```

### macOS: Mac App Store and Developer ID from one archive

Archive once and export twice. The notarized DMG then holds the same binary you upload to TestFlight, and the dSYMs in the archive symbolicate crashes from both.

`action: export` runs only `xcodebuild -exportArchive` against an existing archive, so one archive can be exported with several methods. `workspace` and `project` aren't needed in this mode.

```yaml
- id: build
  uses: Apple-Actions/xcodebuild@v1
  with:
    project: App.xcodeproj
    scheme: App
    action: archive
    archive-path: .build/Artifacts/App.xcarchive
    export-options-plist: ExportOptions.plist # method: app-store-connect
    build-number: ${{ github.run_number }}

- id: developer-id
  uses: Apple-Actions/xcodebuild@v1
  with:
    scheme: App
    action: export
    archive-path: ${{ steps.build.outputs.archive-path }}
    export-options-plist: ExportOptions-DeveloperID.plist
    export-path: .build/Artifacts/developer-id

- uses: Apple-Actions/upload-testflight-build@v5
  with:
    app-path: ${{ steps.build.outputs.pkg-path }}
    app-type: macos
    backend: altool
    issuer-id: ${{ vars.APPSTORE_ISSUER_ID }}
    api-key-id: ${{ vars.APPSTORE_API_KEY_ID }}
    api-private-key: ${{ secrets.APPSTORE_API_PRIVATE_KEY }}

# Package ${{ steps.developer-id.outputs.app-path }} into a DMG, then notarize it.
```

Use the `pkg-path` and `app-path` outputs rather than hard-coding paths inside the export directories. See [`Apple-Actions/Example-macOS`](https://github.com/Apple-Actions/Example-macOS) for the full workflow, including DMG packaging with [`notarize`](https://github.com/Apple-Actions/notarize).

Example `ExportOptions-DeveloperID.plist`:

```xml
<dict>
	<key>method</key>
	<string>developer-id</string>
	<key>provisioningProfiles</key>
	<dict>
		<key>com.example.app</key>
		<string>DeveloperID com.example.app</string>
	</dict>
	<key>signingCertificate</key>
	<string>Developer ID Application</string>
	<key>signingStyle</key>
	<string>manual</string>
	<key>teamID</key>
	<string>ABCDE12345</string>
</dict>
```

In an App Store macOS `ExportOptions.plist`, `installerSigningCertificate` is `3rd Party Mac Developer Installer`. Keychain Access shows the same certificate as "Mac Installer Distribution".

## Inputs

| Name | Description | Default |
| --- | --- | --- |
| `workspace` | Path to the `.xcworkspace`. Mutually exclusive with `project`. Required unless `action` is `export`. | — |
| `project` | Path to the `.xcodeproj`. Mutually exclusive with `workspace`. Required unless `action` is `export`. | — |
| `scheme` | Scheme to build. **Required.** | — |
| `configuration` | Build configuration. | `Release` |
| `sdk` | SDK to build against (e.g. `iphoneos`, `iphonesimulator`, `macosx`). | — |
| `destination` | Destination specifier, e.g. `generic/platform=iOS`. | — |
| `action` | xcodebuild action: `build`, `archive`, `test`, `build-for-testing`, `test-without-building`, `clean`, or `export`. `export` only runs `-exportArchive` on an existing `archive-path` and requires `export-options-plist`. | `build` |
| `archive-path` | Output path for the `.xcarchive`. Required when `action` is `archive` or `export`. | — |
| `export-options-plist` | Path to an `ExportOptions.plist`. When set, the archive is exported. | — |
| `export-path` | Export directory for the IPA. | `<result-bundle-dir>/<scheme>.ipa` |
| `derived-data-path` | Derived data directory. | `.build/DerivedData` |
| `result-bundle-path` | Path for the `.xcresult` bundle. | `.build/Artifacts/<scheme>.xcresult` |
| `build-number` | Value passed as `CURRENT_PROJECT_VERSION`. | — |
| `build-settings` | Additional `KEY=VALUE` build settings, one per line. | — |
| `extra-arguments` | Additional arguments passed verbatim to `xcodebuild`. Also forwarded to `-exportArchive` unless `export-extra-arguments` is specified. | — |
| `export-extra-arguments` | Additional arguments passed verbatim to `xcodebuild -exportArchive`. Defaults to `extra-arguments` if omitted. | — |
| `allow-provisioning-updates` | Pass `-allowProvisioningUpdates` to `xcodebuild` during build, archive, and export. | `false` |
| `allow-provisioning-device-registration` | Pass `-allowProvisioningDeviceRegistration` to `xcodebuild`. Only takes effect if `allow-provisioning-updates` is `true`. | `false` |
| `authentication-key-path` | Path to an App Store Connect API authentication key (`.p8`). Passed as `-authenticationKeyPath`. | — |
| `authentication-key-id` | App Store Connect API key ID. Passed as `-authenticationKeyID`. | — |
| `authentication-key-issuer-id` | App Store Connect API issuer ID. Passed as `-authenticationKeyIssuerID`. | — |
| `output-formatter` | Command to pipe output through (`xcbeautify`, `xcpretty`, or empty). The default enables xcbeautify's `github-actions` renderer so compile errors/warnings surface as inline PR annotations. | `xcbeautify --renderer github-actions` |
| `log-path` | Path to write the raw xcodebuild log. | `.build/<scheme>-<action>.log` |
| `parallelize-targets` | Pass `-parallelizeTargets`. | `true` |
| `show-build-timing-summary` | Pass `-showBuildTimingSummary`. | `true` |
| `disable-automatic-package-resolution` | Pass `-disableAutomaticPackageResolution`. | `true` |
| `zip-result-bundle` | Zip the `.xcresult` bundle next to itself. | `false` |
| `zip-archive` | Zip the `.xcarchive` next to itself. | `false` |
| `working-directory` | Working directory to run `xcodebuild` in. | — |

## Outputs

| Name | Description |
| --- | --- |
| `archive-path` | Resolved `.xcarchive` path, if any. |
| `export-path` | Resolved directory containing the exported IPA, if any. |
| `ipa-path` | First `.ipa` found inside `export-path`, if any. |
| `app-path` | First `.app` found inside `export-path`, if any (e.g. Developer ID). |
| `pkg-path` | First `.pkg` found inside `export-path`, if any (e.g. Mac App Store). |
| `result-bundle-path` | Resolved `.xcresult` path. Not set when `action` is `export`. |
| `log-path` | Resolved raw log path. |

## Requirements

- A macOS runner with Xcode installed (e.g. `runs-on: macos-14` or newer).
- The chosen `output-formatter` must be on `PATH`. `xcbeautify` is pre-installed on GitHub-hosted macOS runners; install it with `brew install xcbeautify` elsewhere, or set `output-formatter: ''` to disable.

## Troubleshooting

### `error: exportArchive "App.app" requires a provisioning profile.`

**Cause:** an archive signed with a Mac App Store profile carries the `com.apple.application-identifier` and `com.apple.developer.team-identifier` entitlements, so any re-export of it, including Developer ID, needs a profile for that method. An app with no profile-only entitlements, archived without a profile, wouldn't need one. That's why the export often works locally and fails in CI.

**Fix:** create a `MAC_APP_DIRECT` (Developer ID) profile for the bundle ID with the Developer ID Application certificate, download it with [`download-provisioning-profiles`](https://github.com/Apple-Actions/download-provisioning-profiles#macos-app-store-and-developer-id), and map it under `provisioningProfiles` in `ExportOptions-DeveloperID.plist`.

## Development

```sh
yarn install
yarn build   # bundles dist/index.js via @vercel/ncc
```

The bundled `dist/` directory is committed so the action can be consumed without a build step, matching the Apple-Actions convention.

## Release

`package.json` `version` is the version currently queued for the next release. Merge work to `main`, then ship with **Actions → Release → Run workflow** (default branch). CI tags `vX.Y.Z`, moves the major `vX` tag, creates a GitHub Release, and bumps `package.json` to the next minor so later changes queue for that version. Consumers on `@vN` pick up the new tip when the major tag moves.

For a major or patch instead of the queued minor, edit `package.json` on a PR first, merge, then run Release.

## License

MIT
