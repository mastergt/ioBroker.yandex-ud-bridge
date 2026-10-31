# Security policy

Do not post vulnerabilities or credentials in public Issues.

If GitHub private vulnerability reporting is enabled for this repository, use **Security > Report a vulnerability** to report a suspected issue privately. Otherwise contact the repository owner by a private channel established in the repository description.

Sensitive information includes OAuth client secrets, local sign-in credentials, callback tokens, access/refresh tokens and the plaintext configuration backup exported by the adapter. Do not upload these files to the repository or a public issue.

Supported versions: the maintainer will state support policy when the first public GitHub release is published. Do not assume security support for older builds.

Before deploying, configure TLS at a trusted reverse proxy, restrict local listener exposure, and keep ioBroker and Node.js patched.
