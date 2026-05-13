export type DonationVerificationStatus = "pending" | "verified" | "rejected";

export type DonationBeneficiary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  verification_status: DonationVerificationStatus;
  payout_reference?: string | null;
  metadata: Record<string, unknown> | null;
};

export type DonationSettlementMode = "split_processor" | "ledger_batch";

export type DonationSettings = {
  id: string;
  is_default: boolean;
  settlement_mode: DonationSettlementMode;
  default_percentage: number;
  round_up_enabled: boolean;
  fiscal_sponsor_name: string | null;
  fiscal_sponsor_account_id: string | null;
  fiscal_sponsor_url: string | null;
  metadata: Record<string, unknown> | null;
};

export type AdminDonationBeneficiaryListResponse = {
  beneficiaries: DonationBeneficiary[];
  storefront_context: { organization_id?: string; storefront_id?: string } | null;
};

export type AdminDonationSettingsResponse = {
  settings: DonationSettings;
};

export type DonationImportError = {
  row: number;
  field: string;
  message: string;
};

export type DonationImportResult = {
  total_rows: number;
  valid_rows: number;
  errors: DonationImportError[];
};

export type TenancyOrganization = {
  id: string;
  name: string;
  slug?: string;
};

export type TenancyStorefront = {
  id: string;
  name: string;
  slug?: string;
  organization_id?: string;
  metadata: Record<string, unknown> | null;
};

export type TenancyStorefrontTemplate = {
  key: string;
  name: string;
  tier: string;
};
