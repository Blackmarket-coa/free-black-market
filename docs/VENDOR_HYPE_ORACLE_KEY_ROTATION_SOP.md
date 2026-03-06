# Vendor Hype Oracle Key Rotation SOP

## Purpose
Define a repeatable process for rotating oracle signing keys used by prediction settlement verification.

## Rotation cadence
- Standard cadence: every 90 days.
- Emergency cadence: immediate rotation for suspected compromise.

## Procedure
1. Generate new Ed25519 keypair in managed KMS/HSM environment.
2. Register new public key with `POST /admin/vendor-hype/oracle-keys`.
3. Rotate active key with `POST /admin/vendor-hype/oracle-keys/rotate` using a signed rotation note.
4. Keep previous key in `retiring` status during propagation window.
5. Verify settlement signatures are accepted under new key and receipts are recorded.
6. Move previous key to `retired` once propagation is complete.

## Controls
- All key changes require admin actor context and audit metadata.
- Rotation note must include reason, ticket id, and approver.
- Replay protection is enforced via oracle nonce uniqueness in receipts.

## Rollback
- If verification failures exceed threshold, switch prior key to `active`, mark new key `retiring`, investigate signer configuration.

## Evidence artifacts
- Rotation request payloads and responses
- Settlement verification receipts during cutover
- Incident ticket linkage for emergency rotations
