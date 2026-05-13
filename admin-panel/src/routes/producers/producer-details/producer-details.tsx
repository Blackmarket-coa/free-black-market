import { useParams, useNavigate } from "react-router-dom"

import {
  CheckCircle,
  XCircle,
  Star,
  Map,
  ArrowLeft,
  ArrowUpRightOnBox,
  Calendar,
  Trash,
  Sun,
  DocumentText,
} from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  toast,
  usePrompt,
  Tabs,
} from "@medusajs/ui"

import type { Certification , GrowingPractice } from "@custom-types/producer"
import { GrowingPracticeLabels } from "@custom-types/producer"

import {
  useProducer,
  useVerifyProducer,
  useFeatureProducer,
  useDeleteProducer,
  useVerifyCertification,
} from "@hooks/api/producers"

export const ProducerDetailsPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const prompt = usePrompt()

  const { producer, isLoading, isError } = useProducer(id!)
  const verifyProducer = useVerifyProducer()
  const featureProducer = useFeatureProducer()
  const deleteProducer = useDeleteProducer()
  const verifyCertification = useVerifyCertification()

  const handleVerify = async (verified: boolean) => {
    if (!producer) return
    try {
      await verifyProducer.mutateAsync({ id: producer.id, verified })
      toast.success(verified ? "Producer verified" : "Verification removed")
    } catch {
      toast.error("Failed to update verification status")
    }
  }

  const handleFeature = async (featured: boolean) => {
    if (!producer) return
    try {
      await featureProducer.mutateAsync({ id: producer.id, featured })
      toast.success(featured ? "Producer featured" : "Removed from featured")
    } catch {
      toast.error("Failed to update featured status")
    }
  }

  const handleDelete = async () => {
    if (!producer) return
    const confirmed = await prompt({
      title: "Delete Producer",
      description: `Are you sure you want to delete "${producer.name}"? This action cannot be undone.`,
      verificationText: producer.name,
    })

    if (confirmed) {
      try {
        await deleteProducer.mutateAsync(producer.id)
        toast.success("Producer deleted")
        navigate("/producers")
      } catch {
        toast.error("Failed to delete producer")
      }
    }
  }

  const handleVerifyCertification = async (index: number, verified: boolean) => {
    if (!producer) return
    try {
      await verifyCertification.mutateAsync({
        producerId: producer.id,
        certificationIndex: index,
        verified,
      })
      toast.success(verified ? "Certification verified" : "Verification removed")
    } catch {
      toast.error("Failed to update certification")
    }
  }

  if (isLoading) {
    return (
      <Container className="p-6">
        <div className="flex items-center justify-center py-10">
          <Text className="text-ui-fg-subtle">Loading producer...</Text>
        </div>
      </Container>
    )
  }

  if (isError || !producer) {
    return (
      <Container className="p-6">
        <div className="flex flex-col items-center justify-center py-10 gap-4">
          <Text className="text-ui-fg-error">Failed to load producer</Text>
          <Button variant="secondary" onClick={() => navigate("/producers")}>
            Back to Producers
          </Button>
        </div>
      </Container>
    )
  }

  const certifications = (producer.certifications || []) as Certification[]
  const practices = (producer.practices || []) as GrowingPractice[]
  const gallery = (producer.gallery || []) as string[]

  return (
    <div className="flex flex-col gap-y-4">
      {/* Back Button */}
      <div>
        <Button
          variant="transparent"
          size="small"
          onClick={() => navigate("/producers")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Producers
        </Button>
      </div>

      {/* Header */}
      <Container className="p-0">
        <div className="flex items-start justify-between px-6 py-4">
          <div className="flex items-start gap-4">
            {producer.photo ? (
              <img
                src={producer.photo}
                alt={producer.name}
                className="h-20 w-20 rounded-lg object-cover"
              />
            ) : (
              <div className="h-20 w-20 rounded-lg bg-ui-bg-subtle flex items-center justify-center">
                <Sun className="h-10 w-10 text-ui-fg-muted" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Heading level="h1">{producer.name}</Heading>
                {producer.verified && (
                  <Badge color="green" size="small">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Verified
                  </Badge>
                )}
                {producer.featured && (
                  <Badge color="purple" size="small">
                    <Star className="h-3 w-3 mr-1" />
                    Featured
                  </Badge>
                )}
              </div>
              <Text className="text-ui-fg-subtle">@{producer.handle}</Text>
              {producer.region && (
                <div className="flex items-center gap-1 mt-1">
                  <Map className="h-4 w-4 text-ui-fg-muted" />
                  <Text className="text-ui-fg-subtle">
                    {producer.region}
                    {producer.state && `, ${producer.state}`}
                  </Text>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {producer.verified ? (
              <Button
                variant="secondary"
                size="small"
                onClick={() => handleVerify(false)}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Remove Verification
              </Button>
            ) : (
              <Button
                variant="primary"
                size="small"
                onClick={() => handleVerify(true)}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Verify Producer
              </Button>
            )}
            {producer.featured ? (
              <Button
                variant="secondary"
                size="small"
                onClick={() => handleFeature(false)}
              >
                <Star className="h-4 w-4 mr-2" />
                Remove Featured
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="small"
                onClick={() => handleFeature(true)}
              >
                <Star className="h-4 w-4 mr-2" />
                Feature
              </Button>
            )}
            <Button
              variant="danger"
              size="small"
              onClick={handleDelete}
            >
              <Trash className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </Container>

      {/* Tabs */}
      <Container className="p-0">
        <Tabs defaultValue="overview">
          <Tabs.List className="px-6">
            <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
            <Tabs.Trigger value="certifications">
              Certifications ({certifications.length})
            </Tabs.Trigger>
            <Tabs.Trigger value="media">Media</Tabs.Trigger>
            <Tabs.Trigger value="seller">Linked Seller</Tabs.Trigger>
          </Tabs.List>

          {/* Overview Tab */}
          <Tabs.Content value="overview" className="p-6">
            <div className="grid grid-cols-2 gap-6">
              {/* Basic Info */}
              <div>
                <Heading level="h3" className="mb-4">Basic Information</Heading>
                <div className="space-y-4">
                  {producer.description && (
                    <div>
                      <Text className="text-ui-fg-subtle text-sm">Description</Text>
                      <Text>{producer.description}</Text>
                    </div>
                  )}
                  {producer.story && (
                    <div>
                      <Text className="text-ui-fg-subtle text-sm">Story</Text>
                      <Text className="whitespace-pre-wrap">{producer.story}</Text>
                    </div>
                  )}
                  {producer.year_established && (
                    <div>
                      <Text className="text-ui-fg-subtle text-sm">Year Established</Text>
                      <Text>{producer.year_established}</Text>
                    </div>
                  )}
                  {producer.farm_size_acres && (
                    <div>
                      <Text className="text-ui-fg-subtle text-sm">Farm Size</Text>
                      <Text>{producer.farm_size_acres} acres</Text>
                    </div>
                  )}
                  {producer.website && (
                    <div>
                      <Text className="text-ui-fg-subtle text-sm">Website</Text>
                      <a
                        href={producer.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-ui-fg-interactive hover:underline"
                      >
                        {producer.website}
                        <ArrowUpRightOnBox className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Practices */}
              <div>
                <Heading level="h3" className="mb-4">Growing Practices</Heading>
                {practices.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {practices.map((practice) => (
                      <Badge key={practice} color="grey" size="small">
                        {GrowingPracticeLabels[practice] || practice}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <Text className="text-ui-fg-muted">No practices specified</Text>
                )}

                <Heading level="h3" className="mt-6 mb-4">Visibility Settings</Heading>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-ui-bg-subtle rounded-lg">
                    <Text>Public Profile</Text>
                    {producer.public_profile_enabled ? (
                      <Badge color="green" size="small">Enabled</Badge>
                    ) : (
                      <Badge color="grey" size="small">Disabled</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between p-3 bg-ui-bg-subtle rounded-lg">
                    <Text>Verification Status</Text>
                    {producer.verified ? (
                      <div className="flex items-center gap-2">
                        <Badge color="green" size="small">Verified</Badge>
                        {producer.verified_at && (
                          <Text className="text-ui-fg-muted text-sm">
                            {new Date(producer.verified_at).toLocaleDateString()}
                          </Text>
                        )}
                      </div>
                    ) : (
                      <Badge color="orange" size="small">Pending</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between p-3 bg-ui-bg-subtle rounded-lg">
                    <Text>Featured</Text>
                    {producer.featured ? (
                      <Badge color="purple" size="small">Yes</Badge>
                    ) : (
                      <Badge color="grey" size="small">No</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Tabs.Content>

          {/* Certifications Tab */}
          <Tabs.Content value="certifications" className="p-6">
            <Heading level="h3" className="mb-4">Certifications</Heading>
            {certifications.length > 0 ? (
              <div className="space-y-4">
                {certifications.map((cert, index) => (
                  <div
                    key={index}
                    className="flex items-start justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-lg bg-ui-bg-subtle flex items-center justify-center">
                        <DocumentText className="h-5 w-5 text-ui-fg-muted" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <Text className="font-medium">{cert.name}</Text>
                          {cert.verified ? (
                            <Badge color="green" size="xsmall">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Verified
                            </Badge>
                          ) : (
                            <Badge color="orange" size="xsmall">Pending Review</Badge>
                          )}
                        </div>
                        <Text className="text-ui-fg-subtle text-sm">
                          Issued by: {cert.issuer}
                        </Text>
                        {cert.valid_until && (
                          <div className="flex items-center gap-1 mt-1">
                            <Calendar className="h-3 w-3 text-ui-fg-muted" />
                            <Text className="text-ui-fg-muted text-sm">
                              Valid until: {new Date(cert.valid_until).toLocaleDateString()}
                            </Text>
                          </div>
                        )}
                        {cert.document_url && (
                          <a
                            href={cert.document_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 mt-2 text-ui-fg-interactive hover:underline text-sm"
                          >
                            View Document
                            <ArrowUpRightOnBox className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <div>
                      {cert.verified ? (
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => handleVerifyCertification(index, false)}
                        >
                          Remove Verification
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="small"
                          onClick={() => handleVerifyCertification(index, true)}
                        >
                          Verify Certification
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10">
                <DocumentText className="h-12 w-12 text-ui-fg-muted mb-4" />
                <Text className="text-ui-fg-subtle">No certifications uploaded</Text>
              </div>
            )}
          </Tabs.Content>

          {/* Media Tab */}
          <Tabs.Content value="media" className="p-6">
            <Heading level="h3" className="mb-4">Media Gallery</Heading>
            {producer.cover_image && (
              <div className="mb-6">
                <Text className="text-ui-fg-subtle text-sm mb-2">Cover Image</Text>
                <img
                  src={producer.cover_image}
                  alt="Cover"
                  className="w-full h-48 object-cover rounded-lg"
                />
              </div>
            )}
            {gallery.length > 0 ? (
              <div className="grid grid-cols-4 gap-4">
                {gallery.map((url, index) => (
                  <img
                    key={index}
                    src={url}
                    alt={`Gallery ${index + 1}`}
                    className="h-32 w-full object-cover rounded-lg"
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10">
                <Sun className="h-12 w-12 text-ui-fg-muted mb-4" />
                <Text className="text-ui-fg-subtle">No gallery images</Text>
              </div>
            )}
          </Tabs.Content>

          {/* Seller Tab */}
          <Tabs.Content value="seller" className="p-6">
            <Heading level="h3" className="mb-4">Linked Seller Account</Heading>
            {producer.seller ? (
              <div className="p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <Text className="font-medium">
                      {producer.seller.name || producer.seller.email}
                    </Text>
                    <Text className="text-ui-fg-subtle text-sm">
                      {producer.seller.email}
                    </Text>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      color={producer.seller.store_status === "ACTIVE" ? "green" : "orange"}
                      size="small"
                    >
                      {producer.seller.store_status}
                    </Badge>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => navigate(`/sellers/${producer.seller_id}`)}
                    >
                      View Seller
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10">
                <Text className="text-ui-fg-subtle">Seller ID: {producer.seller_id}</Text>
                <Button
                  variant="secondary"
                  size="small"
                  className="mt-2"
                  onClick={() => navigate(`/sellers/${producer.seller_id}`)}
                >
                  View Seller Details
                </Button>
              </div>
            )}
          </Tabs.Content>
        </Tabs>
      </Container>
    </div>
  )
}
