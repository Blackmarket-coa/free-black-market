import { useState } from "react";

import { InformationCircle } from "@medusajs/icons";
import { Button, Container, Drawer, Text } from "@medusajs/ui";

import type { AdminSellerRequest } from "@custom-types/requests";

import { formatDate } from "@lib/date";

import { ResolveRequestPrompt } from "@routes/requests/common/components/resolve-request";

type Props = {
  request?: AdminSellerRequest;
  open: boolean;
  close: () => void;
};

export function RequestSellerDetail({ request, open, close }: Props) {
  if (!request) {
    return null;
  }
  const requestData = request.data;

  // Check if this is a legacy request with no data
  const isLegacyRequest = !requestData || Object.keys(requestData).length === 0;

  // Handle both old and new data formats. Legacy requests carry a
  // flatter shape with `name` / `email` at the root that isn't in the
  // current SellerRequestData type.
  type LegacyRequestData = {
    name?: string
    email?: string
  }
  const legacyData = requestData as unknown as LegacyRequestData | undefined
  const sellerName = isLegacyRequest
    ? "Legacy request - no data available"
    : (requestData?.seller?.name || legacyData?.name || "-");

  const memberName = isLegacyRequest
    ? "Legacy request - no data available"
    : (requestData?.member?.name || legacyData?.name || "-");

  const memberEmail = isLegacyRequest
    ? "Legacy request - no data available"
    : (requestData?.member?.email || legacyData?.email || "N/A");

  const vendorType = isLegacyRequest
    ? "unknown"
    : (requestData?.vendor_type ||
       "producer");

  const [promptOpen, setPromptOpen] = useState(false);
  const [requestAccept, setRequestAccept] = useState(false);

  const handlePrompt = (_: string, accept: boolean) => {
    setRequestAccept(accept);
    setPromptOpen(true);
  };

  return (
    <Drawer open={open} onOpenChange={close}>
      <ResolveRequestPrompt
        close={() => {
          setPromptOpen(false);
        }}
        open={promptOpen}
        id={request.id!}
        accept={requestAccept}
        onSuccess={() => {
          close();
        }}
      />
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Review seller request</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="p-4">
          {isLegacyRequest && (
            <Container className="mb-4 bg-ui-bg-subtle border border-ui-border-base">
              <div className="flex items-center gap-2">
                <InformationCircle className="text-ui-fg-muted" />
                <Text className="text-ui-fg-muted">
                  <strong>Legacy Request:</strong> This request was created before the current data structure was implemented. Request details are not available.
                </Text>
              </div>
            </Container>
          )}
          <fieldset>
            <legend className="mb-2">Seller name</legend>
            <Container>
              <Text>{sellerName}</Text>
            </Container>
          </fieldset>
          <fieldset className="mt-2">
            <legend className="mb-2">Member</legend>
            <Container>
              <Text>{memberName}</Text>
            </Container>
          </fieldset>
          <fieldset className="mt-2">
            <legend className="mb-2">Email</legend>
            <Container>
              <Text>{memberEmail}</Text>
            </Container>
          </fieldset>
          <fieldset className="mt-2">
            <legend className="mb-2">Vendor Type</legend>
            <Container>
              <Text className="capitalize">{vendorType}</Text>
            </Container>
          </fieldset>
          <Container className="mt-4">
            <div className="flex items-center gap-2">
              <InformationCircle />
              <Text className="font-semibold">Request information</Text>
            </div>
            <Text>{`Submitted on ${formatDate(request.created_at)}`}</Text>
            {request.reviewer_id && (
              <Text>{`Reviewed on ${formatDate(request.updated_at)}`}</Text>
            )}
            {request.reviewer_note && (
              <Text>{`Reviewer note: ${request.reviewer_note}`}</Text>
            )}
          </Container>
        </Drawer.Body>
        <Drawer.Footer>
          {(request.status === "pending" || request.status === "rejected") && (
            <>
              <Button
                onClick={() => {
                  handlePrompt(request.id!, true);
                }}
              >
                {request.status === "rejected" ? "Reverse rejection" : "Accept"}
              </Button>
              {request.status === "pending" && (
                <Button
                  onClick={() => {
                    handlePrompt(request.id!, false);
                  }}
                  variant="danger"
                >
                  Reject
                </Button>
              )}
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
            </>
          )}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  );
}
