import { useState } from "react";

import { History } from "@medusajs/icons";
import type { ProductDTO } from "@medusajs/types";
import { Container, Heading, Table, Text } from "@medusajs/ui";

import { formatDate } from "@lib/date";
import { useNavigate } from "react-router-dom";

import type { AdminRequest } from "@custom-types/requests";

import { useVendorRequests } from "@hooks/api/requests";

import {
  FilterRequests,
  type FilterState,
} from "@routes/requests/common/components/filter-requests";
import { RequestMenu } from "@routes/requests/common/components/request-menu";
import { getRequestStatusBadge } from "@routes/requests/common/utils/get-status-badge";

const PAGE_SIZE = 20;

export const RequestProductUpdateList = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState<number>(0);

  const handleDetail = (request: AdminRequest) => {
    const product_id =
      (request.data as Record<string, unknown>).product_id || "";
    navigate(`/products/${product_id}`);
  };

  const [currentFilter, setCurrentFilter] = useState<FilterState>("");

  const { requests, isLoading, count } = useVendorRequests({
    offset: currentPage * PAGE_SIZE,
    limit: PAGE_SIZE,
    type: "product_update",
    status: currentFilter !== "" ? currentFilter : undefined,
  });

  return (
    <Container>
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Product update requests</Heading>
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
              <Table.HeaderCell>Title</Table.HeaderCell>
              <Table.HeaderCell>Submitted By</Table.HeaderCell>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {requests?.map((request) => {
              const requestData = request.data as unknown as ProductDTO;

              return (
                <Table.Row key={request.id}>
                  <Table.Cell>{requestData.title}</Table.Cell>
                  <Table.Cell>{request.seller?.name}</Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <History />
                      {formatDate(request.created_at!)}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {getRequestStatusBadge(request.status!)}
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
          canNextPage={PAGE_SIZE * (currentPage + 1) < count!}
          canPreviousPage={currentPage > 0}
          previousPage={() => {
            setCurrentPage(currentPage - 1);
          }}
          nextPage={() => {
            setCurrentPage(currentPage + 1);
          }}
          count={count!}
          pageCount={Math.ceil(count! / PAGE_SIZE)}
          pageIndex={currentPage}
          pageSize={PAGE_SIZE}
        />
      </div>
    </Container>
  );
};
