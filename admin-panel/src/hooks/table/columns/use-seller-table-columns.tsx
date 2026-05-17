import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { Badge } from "@medusajs/ui";

import { formatDate } from "@lib/date";
import type { VendorSeller } from "@/types";
import { SellerStatusBadge } from "@components/common/seller-status-badge";
import { VendorTypeLabels } from "@custom-types/domain";

const columnHelper = createColumnHelper<VendorSeller>();

export const useSellersTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.display({
        id: "email",
        header: "Email",
        cell: ({ row }) => row.original.email,
      }),
      columnHelper.display({
        id: "name",
        header: "Name",
        cell: ({ row }) => row.original.name,
      }),
      columnHelper.display({
        id: "vendor_type",
        header: "Vendor Type",
        cell: ({ row }) => {
          const vendorType = row.original.seller_metadata?.vendor_type;
          if (!vendorType) return "-";
          const label = VendorTypeLabels[vendorType as keyof typeof VendorTypeLabels] || vendorType;
          
return <Badge color="blue">{label}</Badge>;
        },
      }),
      columnHelper.display({
        id: "store_status",
        header: "Account Status",
        cell: ({ row }) => (
          <SellerStatusBadge status={row.original.store_status || "-"} />
        ),
      }),
      columnHelper.display({
        id: "verified",
        header: "Verified",
        cell: ({ row }) => {
          const verified = row.original.seller_metadata?.verified;
          
return verified ? (
            <Badge color="green">Yes</Badge>
          ) : (
            <Badge color="orange">No</Badge>
          );
        },
      }),
      columnHelper.display({
        id: "created_at",
        header: "Created",
        cell: ({ row }) => formatDate(row.original.created_at),
      }),
    ],
    []
  );
};
