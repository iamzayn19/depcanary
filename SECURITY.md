# Security Policy

## Scope

This policy covers security issues **in DepCanary itself** — for example:

- a way to make DepCanary execute code from a target npm package;
- an archive-extraction path that escapes DepCanary's temporary directory or
  overwrites arbitrary host files;
- a way to bypass tarball integrity verification;
- a way to leak registry credentials to an unintended host;
- a way to inject terminal control sequences into DepCanary's own output that
  isn't sanitized;
- a denial-of-service caused by DepCanary's own resource limits being
  insufficient or bypassable.

## Out of scope

DepCanary analyzes third-party npm packages but does not vet them. If you
believe a **specific npm package** is malicious, that is not a DepCanary
vulnerability — please report it to the npm security team
(https://www.npmjs.com/support) or the package's own maintainers, not to
this project.

## Reporting a vulnerability

This repository does not yet have a dedicated security contact email.
Please use **GitHub's private vulnerability reporting** for this repository
(the "Security" tab → "Report a vulnerability") so the report is not
publicly visible until it's addressed. The maintainer should enable this
feature in the repository settings if it is not already on.

Please do not open a public issue for a suspected vulnerability, and please
give the maintainer a reasonable window to investigate and fix the issue
before publishing exploit details.

## Supported versions

DepCanary is currently pre-1.0 (`0.x`). Until a `1.0` release, security fixes
are made against the latest published `0.x` version only.
