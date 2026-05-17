import { InformationCircle } from "@medusajs/icons";
import type { ProductDTO } from "@medusajs/types";
import { Button, Container, Drawer, Text } from "@medusajs/ui";

import { formatDate } from "@lib/date";
import { useNavigate } from "react-router-dom";

import type { AdminRequest } from "@custom-types/requests";

type Props = {
  request?: AdminRequest;
  open: boolean;
  close: () => void;
};

export function ProductSummaryDetail({ request, open, close }: Props) {
  if (!request) {
    return null;
  }

  // Backend persists request body as `payload`; AdminRequest interface
  // names it `data`. They're the same field.
  const payload = (request as { payload?: Record<string, unknown> }).payload
  const product_id = (payload?.product_id as string | undefined) || "";
  const navigate = useNavigate();
  const requestData = payload as unknown as ProductDTO;

  return (
    <Drawer open={open} onOpenChange={close}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Product request</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="p-4">
          <fieldset>
            <legend className="mb-2">Product title</legend>
            <Container>
              <Text>{requestData.title}</Text>
            </Container>
          </fieldset>
          <fieldset className="mt-2">
            <legend className="mb-2">Handle</legend>
            <Container>
              <Text>{`/${requestData.handle}`}</Text>
            </Container>
          </fieldset>
          <fieldset className="mt-2">
            <legend className="mb-2">Submitted by</legend>
            <Container>
              <Text>{request.seller?.name}</Text>
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
          <Button
            onClick={() => {
              navigate(`/products/${product_id}`);
            }}
          >
            See full product
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  );
}
