# @riao/authn-sso-google - Changelog

## 3.0.0

- Require SSO 3 and IAM 5; validate state when supplied.
- Forward all inherited security options, including protection and encryption.
- Classify expected OAuth/token rejection separately from operational
  failures; validate responses and bound requests with safe error messages.
- Update the server example to store the authenticated principal in session.
- Regenerate lockfile registry integrity for IAM 5 and SSO 3 after their
  coordinated publication; no local package references are shipped.
