# Security

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/jzlosman/foldnote/security/advisories/new). Do not open a public issue containing an exploit, credentials, or personal notes.

Include the affected commit, macOS version, reproduction steps using synthetic data, and the expected impact. The latest `main` branch is the supported development version. Response times are not guaranteed.

Foldnote is local-first, but it processes Markdown, media, cached font files, and optional local-model responses. Those boundaries must be treated as untrusted inputs. Public builds are not currently notarized or distributed as signed releases; build from source and back up your notes before testing changes.
