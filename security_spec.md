# Security Specification - Ảnh Xe THD

## Data Invariants
1. A session must have a valid `plateNumber` (string, max 20 chars).
2. A session must have at least one image URL.
3. `createdAt` must be set by the server.
4. `imageCount` must match the length of `imageUrls`.

## The "Dirty Dozen" Payloads (Denial Expected)
1. Write with missing `plateNumber`.
2. Write with non-array `imageUrls`.
3. Write with future `createdAt`.
4. Update `plateNumber` after creation.
5. Delete session by non-authenticated user.
6. Write enormous string in `note` field (> 5000 chars).
7. Inject HTML in `note`.
8. Write session with `imageCount` < 1.
9. Write session with malicious `plateNumber` (too long).
10. Update `thumbnailUrl` to an external malicious domain.
11. Read session data without being signed in.
12. Attempt to write to a collection not defined in the blueprint.

## Test Cases
- [x] Create session as auth user: OK
- [x] Create session as guest: DENY
- [x] List sessions as guest: DENY
- [x] Update plateNumber: DENY
- [x] Delete session as guest: DENY
