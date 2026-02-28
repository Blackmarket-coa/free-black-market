import { MedusaRequest } from "@medusajs/framework/http";

export const parseDateRange = (req: MedusaRequest) => {
  const startDateRaw = String(req.query.start_date || "");
  const endDateRaw = String(req.query.end_date || "");

  const startDate = startDateRaw ? new Date(startDateRaw) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const endDate = endDateRaw ? new Date(endDateRaw) : new Date();

  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) {
    throw new Error("Invalid start_date or end_date provided");
  }

  return { startDate, endDate };
};

export const parseStorefront = (req: MedusaRequest) =>
  req.query.storefront_id ? String(req.query.storefront_id) : undefined;
