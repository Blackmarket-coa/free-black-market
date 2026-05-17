import { useState } from "react";

import { History } from "@medusajs/icons";
import { Container, Heading, Table, Text } from "@medusajs/ui";

import { formatDate } from "@lib/date";

import type { AdminRequest } from "@custom-types/requests";

import { useVendorRequests } from "@hooks/api/requests";

import {
  FilterRequests,
  type FilterState,
} from "@routes/requests/common/components/filter-requests";
import { RequestMenu } from "@routes/requests/common/components/request-menu";
import { getRequestStatusBadge } from "@routes/requests/common/utils/get-status-badge";
import { RequestSellerDetail } from "@routes/requests/request-seller-list/components/request-seller-detail";

const PAGE_SIZE = 20;

export const RequestSellerList = () => {
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRequest, setDetailRequest] = useState<AdminRequest | undefined>(
    undefined,
  );

  const handleDetail = (request: AdminRequest) => {
    setDetailRequest(request);
    setDetailOpen(true);
  };

  const [currentFilter, setCurrentFilter] = useState<FilterState>("");

  const { requests, isLoading, count } = useVendorRequests({
    offset: currentPage * PAGE_SIZE,
    limit: PAGE_SIZE,
    type: "seller",
    status: currentFilter !== "" ? currentFilter : undefined,
  });

  // Safe count value with default
  const totalCount = count ?? 0;
  const pageCount = totalCount > 0 ? Math.ceil(totalCount / PAGE_SIZE) : 1;

  return (
    <Container>
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Seller creation requests</Heading>

          <RequestSellerDetail
            request={detailRequest as never}
            open={detailOpen}
            close={() => {
              setDetailOpen(false);
            }}
          />
          <FilterRequests
            onChange={(val) => {
              setCurrentFilter(val);
            }}
          />
        </div>
      </div>
      <div className="flex size-full flex-col overflow-hidden">
        {isLoading && <Text>Loading...</Text>}
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Email</Table.HeaderCell>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {requests?.map((request) => {
              const requestData = request.data as Record<string, unknown> | undefined;

              // Handle legacy requests with no data
              if (!requestData || Object.keys(requestData).length === 0) {
                return (
                  <Table.Row key={request.id}>
                    <Table.Cell className="text-ui-fg-muted italic">
                      Legacy request - no data
                    </Table.Cell>
                    <Table.Cell className="text-ui-fg-muted italic">
                      Legacy request - no data
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2">
                        <History />
                        {request.created_at ? formatDate(request.created_at) : "N/A"}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      {getRequestStatusBadge(request.status ?? "pending")}
                    </Table.Cell>
                    <Table.Cell>
                      <RequestMenu
                        handleDetail={handleDetail}
                        request={request}
                      />
                    </Table.Cell>
                  </Table.Row>
                );
              }

              // Handle both old and new payload formats
              const sellerName =
                ((requestData?.seller as Record<string, unknown> | undefined)?.name as string) ||
                (requestData?.name as string) ||
                "N/A";

              const memberEmail =
                ((requestData?.member as Record<string, unknown> | undefined)?.email as string) ||
                (requestData?.email as string) ||
                "N/A";

              return (
                <Table.Row key={request.id}>
                  <Table.Cell>{sellerName}</Table.Cell>
                  <Table.Cell>{memberEmail}</Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <History />
                      {request.created_at ? formatDate(request.created_at) : "N/A"}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {getRequestStatusBadge(request.status ?? "pending")}
                  </Table.Cell>
                  <Table.Cell>
                    <RequestMenu
                      handleDetail={handleDetail}
                      request={request}
                    />
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
        <Table.Pagination
          className="w-full"
          canNextPage={PAGE_SIZE * (currentPage + 1) < totalCount}
          canPreviousPage={currentPage > 0}
          previousPage={() => {
            setCurrentPage(currentPage - 1);
          }}
          nextPage={() => {
            setCurrentPage(currentPage + 1);
          }}
          count={totalCount}
          pageCount={pageCount}
          pageIndex={currentPage}
          pageSize={PAGE_SIZE}
        />
      </div>
    </Container>
  );
};
