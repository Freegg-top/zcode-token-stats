# Security

This project modifies local ZCode desktop resources:

- `resources/app.asar` in the ZCode installation
- `resources/glm/zcode.cjs` for full local usage aggregation

It does not send telemetry or upload session data. The installer creates timestamped backups next to both files.

## Reporting

Please report a security issue privately through the repository's GitHub Security Advisory or by contacting the maintainer listed in the repository profile. Do not paste access tokens, cookies, session databases, or full logs into a public issue.

## Trust boundary

Only install release archives from the official repository and verify the published SHA256. A local resource modification can be overwritten by a ZCode update; rerun the installer after major upgrades and use `uninstall.cmd` to restore the backups.
