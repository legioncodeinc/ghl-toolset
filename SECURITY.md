<!--
Grounded in raw/get-started--security-policy--effective-security-policy-tenthirtyam.md.
This file must live at repo root, docs/SECURITY.md, or .github/SECURITY.md:
GitHub checks those three locations in that order. This repo names GitHub
Private Vulnerability Reporting as the primary channel below; enable that
feature on the repository (Security tab > Reporting > Privately report a
vulnerability) before publishing this file, or the instructions will be wrong
the moment someone needs them.
-->

# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.x | :white_check_mark: |
| < 0.1 | :x: |

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Instead, report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/legioncodeinc/ghl-toolset/security/advisories/new) for this repository.

If private vulnerability reporting is unavailable or unusable for your report, email the maintainers at marioaldayuz315@gmail.com.

When reporting a vulnerability, please include:

- The affected version, tag, or commit SHA
- A description of the issue and why you believe it is security-sensitive
- Steps to reproduce, or a proof of concept
- Any relevant logs, payloads, or screenshots
- The potential impact
- Any suggested mitigations or fixes, if known

## What to Expect

You can expect an acknowledgment within 3 business days.

After acknowledgment, we will assess the report and follow up with next steps. If the issue is confirmed, we will work on a fix and coordinate disclosure timing with the reporter when appropriate.

If a report is validated, we may publish a GitHub Security Advisory once remediation details are ready to share publicly.

## Scope

In scope: the browser-extension code in this repository.

Out of scope: HighLevel's own platform (report platform issues to HighLevel), and the contents of any sub-account you do not own or operate. Note that these tools intentionally never handle credentials — a report that a session token was mishandled would be treated as high severity precisely because the design promise is that it never happens.
