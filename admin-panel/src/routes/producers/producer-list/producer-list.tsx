import { useMemo } from "react"

import { 
  CheckCircle, 
  XCircle, 
  Star, 
  Map, 
  EllipsisHorizontal,
  Sun,
  PencilSquare,
  Trash,
} from "@medusajs/icons"
import {
  Badge,
  Container,
  Heading,
  Text,
  toast,
  usePrompt,
  DropdownMenu,
  IconButton,
} from "@medusajs/ui"

import { keepPreviousData } from "@tanstack/react-query"
import { createColumnHelper } from "@tanstack/react-table"
import { useNavigate } from "react-router-dom"

import type { Producer , GrowingPractice } from "@custom-types/producer"
import { GrowingPracticeLabels } from "@custom-types/producer"

import { _DataTable } from "@components/table/data-table"

import {
  useProducers,
  useProducerStats,
  useVerifyProducer,
  useFeatureProducer,
  useDeleteProducer,
} from "@hooks/api/producers"
import { useDataTable } from "@hooks/use-data-table"
import { useQueryParams } from "@hooks/use-query-params"

const PAGE_SIZE = 10

const columnHelper = createColumnHelper<Producer>()

export const ProducersList = () => {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const queryParams = useQueryParams(["q", "offset", "order"])

  const { producers, count, isLoading } = useProducers(
    {
      limit: PAGE_SIZE,
      offset: queryParams.offset ? Number(queryParams.offset) : 0,
      q: queryParams.q || undefined,
      fields: "id,name,handle,region,state,verified,featured,practices,photo,created_at,seller.*",
    },
    {
      placeholderData: keepPreviousData,
    }
  )

  const { stats } = useProducerStats()
  const verifyProducer = useVerifyProducer()
  const featureProducer = useFeatureProducer()
  const deleteProducer = useDeleteProducer()

  const handleVerify = async (producer: Producer, verified: boolean) => {
    try {
      await verifyProducer.mutateAsync({ id: producer.id, verified })
      toast.success(verified ? "Producer verified" : "Verification removed")
    } catch {
      toast.error("Failed to update verification status")
    }
  }

  const handleFeature = async (producer: Producer, featured: boolean) => {
    try {
      await featureProducer.mutateAsync({ id: producer.id, featured })
      toast.success(featured ? "Producer featured" : "Removed from featured")
    } catch {
      toast.error("Failed to update featured status")
    }
  }

  const handleDelete = async (producer: Producer) => {
    const confirmed = await prompt({
      title: "Delete Producer",
      description: `Are you sure you want to delete "${producer.name}"? This action cannot be undone.`,
      verificationText: producer.name,
    })

    if (confirmed) {
      try {
        await deleteProducer.mutateAsync(producer.id)
        toast.success("Producer deleted")
      } catch {
        toast.error("Failed to delete producer")
      }
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Producer",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            {row.original.photo ? (
              <img
                src={row.original.photo}
                alt={row.original.name}
                className="h-10 w-10 rounded-lg object-cover"
              />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-ui-bg-subtle flex items-center justify-center">
                <Sun className="h-5 w-5 text-ui-fg-muted" />
              </div>
            )}
            <div>
              <Text className="font-medium">{row.original.name}</Text>
              <Text className="text-ui-fg-subtle text-sm">
                @{row.original.handle}
              </Text>
            </div>
          </div>
        ),
      }),
      columnHelper.accessor("region", {
        header: "Location",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Map className="h-4 w-4 text-ui-fg-muted" />
            <Text>
              {row.original.region || row.original.state || "—"}
              {row.original.state && row.original.region && `, ${row.original.state}`}
            </Text>
          </div>
        ),
      }),
      columnHelper.accessor("practices", {
        header: "Practices",
        cell: ({ row }) => {
          const practices = row.original.practices || []
          if (practices.length === 0) return <Text className="text-ui-fg-muted">—</Text>
          
return (
            <div className="flex flex-wrap gap-1">
              {practices.slice(0, 2).map((practice) => (
                <Badge key={practice} color="grey" size="xsmall">
                  {GrowingPracticeLabels[practice as GrowingPractice] || practice}
                </Badge>
              ))}
              {practices.length > 2 && (
                <Badge color="grey" size="xsmall">
                  +{practices.length - 2}
                </Badge>
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor("verified", {
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.verified ? (
              <Badge color="green" size="small">
                <CheckCircle className="h-3 w-3 mr-1" />
                Verified
              </Badge>
            ) : (
              <Badge color="orange" size="small">
                Pending
              </Badge>
            )}
            {row.original.featured && (
              <Badge color="purple" size="small">
                <Star className="h-3 w-3 mr-1" />
                Featured
              </Badge>
            )}
          </div>
        ),
      }),
      columnHelper.accessor("seller", {
        header: "Seller",
        cell: ({ row }) => (
          <Text className="text-ui-fg-subtle">
            {row.original.seller?.name || row.original.seller?.email || "—"}
          </Text>
        ),
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <IconButton variant="transparent" size="small">
                <EllipsisHorizontal />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item onClick={() => navigate(`/producers/${row.original.id}`)}>
                <PencilSquare className="mr-2" />
                View Details
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              {row.original.verified ? (
                <DropdownMenu.Item onClick={() => handleVerify(row.original, false)}>
                  <XCircle className="mr-2" />
                  Remove Verification
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item onClick={() => handleVerify(row.original, true)}>
                  <CheckCircle className="mr-2" />
                  Verify Producer
                </DropdownMenu.Item>
              )}
              {row.original.featured ? (
                <DropdownMenu.Item onClick={() => handleFeature(row.original, false)}>
                  <Star className="mr-2" />
                  Remove from Featured
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item onClick={() => handleFeature(row.original, true)}>
                  <Star className="mr-2" />
                  Add to Featured
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Separator />
              <DropdownMenu.Item 
                onClick={() => handleDelete(row.original)}
                className="text-ui-fg-error"
              >
                <Trash className="mr-2" />
                Delete Producer
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        ),
      }),
    ],
    [navigate]
  )

  const { table } = useDataTable({
    data: producers ?? [],
    columns,
    count: count ?? 0,
    enablePagination: true,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row?.id || "",
  })

  return (
    <div className="flex flex-col gap-y-4">
      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <Container className="p-4">
            <Text className="text-ui-fg-subtle text-sm">Total Producers</Text>
            <Text className="text-2xl font-semibold">{stats.total_producers}</Text>
          </Container>
          <Container className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <Text className="text-ui-fg-subtle text-sm">Verified</Text>
            </div>
            <Text className="text-2xl font-semibold text-green-600">{stats.verified_producers}</Text>
          </Container>
          <Container className="p-4">
            <div className="flex items-center gap-2">
              <Text className="text-ui-fg-subtle text-sm">Pending Verification</Text>
            </div>
            <Text className="text-2xl font-semibold text-orange-600">{stats.pending_verification}</Text>
          </Container>
          <Container className="p-4">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-purple-500" />
              <Text className="text-ui-fg-subtle text-sm">Featured</Text>
            </div>
            <Text className="text-2xl font-semibold text-purple-600">{stats.featured_producers}</Text>
          </Container>
        </div>
      )}

      {/* Main List */}
      <Container className="p-0">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <Heading>Producers</Heading>
            <Text className="text-ui-fg-subtle">
              Manage farm and producer profiles
            </Text>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Text className="text-ui-fg-subtle">Loading producers...</Text>
          </div>
        ) : !producers || producers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-y-4">
            <div className="w-16 h-16 rounded-full bg-ui-bg-subtle flex items-center justify-center">
              <Sun className="h-8 w-8 text-ui-fg-muted" />
            </div>
            <Text className="text-ui-fg-subtle">No producers found</Text>
            <Text className="text-ui-fg-muted text-sm text-center max-w-md">
              Producers are created when sellers set up their farm profiles in the vendor panel.
            </Text>
          </div>
        ) : (
          <_DataTable
            table={table}
            columns={columns}
            pageSize={PAGE_SIZE}
            count={count ?? 0}
            pagination
            navigateTo={(row) => `/producers/${row.id}`}
            search
            queryObject={queryParams}
          />
        )}
      </Container>
    </div>
  )
}
