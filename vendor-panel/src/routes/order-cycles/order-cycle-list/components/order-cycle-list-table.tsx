import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  Container,
  Heading,
  Table,
  Button,
  Badge,
  Text,
  usePrompt,
  toast,
  DropdownMenu,
  IconButton,
} from "@medusajs/ui"
import { PlusMini, EllipsisHorizontal, Trash, PencilSquare } from "@medusajs/icons"
import { useOrderCycles, useDeleteOrderCycle, OrderCycle } from "../../../../hooks/api/order-cycles"
import { CreateOrderCycleModal } from "./create-order-cycle-modal"

const statusColors: Record<string, "green" | "blue" | "orange" | "grey" | "red"> = {
  draft: "grey",
  upcoming: "blue",
  open: "green",
  closed: "orange",
  completed: "grey",
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export const OrderCycleListTable = () => {
  const navigate = useNavigate()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const { data, isLoading, error } = useOrderCycles({ limit: 50 })
  const deleteOrderCycle = useDeleteOrderCycle()
  const prompt = usePrompt()

  const handleDelete = async (cycle: OrderCycle) => {
    const confirmed = await prompt({
      title: "Delete Order Cycle",
      description: `Are you sure you want to delete "${cycle.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })

    if (confirmed) {
      try {
        await deleteOrderCycle.mutateAsync(cycle.id)
        toast.success("Order cycle deleted successfully")
      } catch (err) {
        toast.error("Failed to delete order cycle")
      }
    }
  }

  if (error) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-error">Failed to load order cycles</Text>
      </Container>
    )
  }

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Order Cycles</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage time-bounded ordering windows for your products
            </Text>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowCreateModal(true)}>
              <PlusMini />
              Create Order Cycle
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Text className="text-ui-fg-subtle">Loading...</Text>
          </div>
        ) : !data?.order_cycles?.length ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Text className="text-ui-fg-subtle">No order cycles found</Text>
            <Button variant="secondary" onClick={() => setShowCreateModal(true)}>
              Create your first order cycle
            </Button>
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Opens</Table.HeaderCell>
                <Table.HeaderCell>Closes</Table.HeaderCell>
                <Table.HeaderCell>Dispatch</Table.HeaderCell>
                <Table.HeaderCell className="w-[1%]"></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.order_cycles.map((cycle) => (
                <Table.Row
                  key={cycle.id}
                  className="cursor-pointer hover:bg-ui-bg-subtle"
                  onClick={() => navigate(`/order-cycles/${cycle.id}`)}
                >
                  <Table.Cell>
                    <div className="flex flex-col">
                      <Text weight="plus">{cycle.name}</Text>
                      {cycle.description && (
                        <Text className="text-ui-fg-subtle" size="small">
                          {cycle.description.substring(0, 50)}
                          {cycle.description.length > 50 ? "..." : ""}
                        </Text>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={statusColors[cycle.status] || "grey"}>
                      {cycle.status}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{formatDate(cycle.opens_at)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{formatDate(cycle.closes_at)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {cycle.dispatch_at ? formatDate(cycle.dispatch_at) : "-"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenu.Trigger asChild>
                        <IconButton variant="transparent">
                          <EllipsisHorizontal />
                        </IconButton>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item
                          onClick={() => navigate(`/order-cycles/${cycle.id}`)}
                        >
                          <PencilSquare className="mr-2" />
                          Edit
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                          onClick={() => handleDelete(cycle)}
                          className="text-ui-fg-error"
                        >
                          <Trash className="mr-2" />
                          Delete
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      <CreateOrderCycleModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </>
  )
}
