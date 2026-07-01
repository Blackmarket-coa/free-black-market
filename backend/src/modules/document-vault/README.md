# document-vault module

Opt-in store of **vendor-uploaded evidence documents** (leases, contracts,
licenses, insurance certificates, practitioner credentials, business plans)
that quests reference as `⚪ vendor-supplied` requirements.

## Table

- `vault_document` — one row per uploaded document, scoped by `seller_id`.

## Design rules

- **Opt-in & decoupled.** Nothing here enrolls a vendor in a quest; a vendor
  can upload documents with no quest, and dropping a quest never deletes rows.
- **Files live in the File module.** We store only `file_id` (from
  `uploadFilesWorkflow` via the `minio-file` provider) plus metadata.
- **Never fabricate verification.** `verified` reflects a real human/admin
  check (`markVerified`); it is never auto-set. This upholds the engine's hard
  constraint that FBM assembles evidence but never invents it.
- **Seller-scoped.** All reads filter by `seller_id`; a vendor's documents are
  never exposed to another vendor. Collective quests read member documents only
  through explicit per-member consent (see the `vendor-quest` module).

Gated by the `DOCUMENT_VAULT_V1` feature flag.
