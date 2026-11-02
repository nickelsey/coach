# Coach iOS app

SwiftUI, iOS 27+. The Xcode project is generated from `project.yml`; don't edit
`Coach.xcodeproj` by hand.

```sh
cd ios
xcodegen                     # after adding/removing files or changing project.yml
open Coach.xcodeproj
xcodebuild test -project Coach.xcodeproj -scheme Coach \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

## Layout

- `Coach/Theme`: NEON//OS design system (colors, fonts, chamfer shapes, panels,
  segmented bars, buttons, grid and scanlines).
- `Coach/Data`: GRDB database. Timestamps are stored as integer milliseconds so
  they round-trip exactly; sync's last-writer-wins depends on that.
- `Coach/Sync`: push queued changes, then pull past the cursor. Same conflict
  rule as the server.
- `Coach/Features`: screens.

## Connecting to the server

Settings (gear on Today) > UPLINK: enter `https://coach.<tailnet>.ts.net` and
the `COACH_API_TOKEN` from `deploy/.env`, then TEST LINK. The token is kept in
the Keychain. The simulator uses the Mac's network, so it reaches the server
whenever the Mac is on the tailnet.

## Running on your iPhone

Set `DEVELOPMENT_TEAM` in `project.yml` (and change the `dev.coach.*` bundle IDs
if you like), run `xcodegen`, then build to the device from Xcode.
