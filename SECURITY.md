# Security

AgentBoard is under active development. Use a trusted local workspace until
your deployment has been reviewed. The local JSON adapter supports one writer
process; stop the server before seed or password-reset commands. PostgreSQL is
available, but this release does not claim independent production hardening.

Do not disclose vulnerabilities with working credentials or private board data
in a public issue. Use the repository Security tab's private vulnerability
reporting option when available. If that option is unavailable, open an issue
requesting a private contact without publishing exploit details.

Keep provider keys and encryption keys in private environment files. Model
output and board HTML are untrusted: schemas, permissions, version checks,
outbound address restrictions, and iframe sandboxing remain server boundaries.
Rotate any credential accidentally disclosed in a report or commit.
