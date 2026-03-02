import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Container, Heading, Button, Input, Label, Switch, Text } from "@medusajs/ui"
import { ArrowLeft } from "@medusajs/icons"
import {
  useDeliveryZone,
  useUpdateDeliveryZone,
  useDeleteDeliveryZone,
  UpdateDeliveryZoneInput
} from "../../../hooks/api/delivery-zones"
import { useVendorType } from "../../../providers/vendor-type-provider"


const getConflictDetails = (error: any) => {
  const conflicts = error?.details?.backendDetails?.conflicts
  if (Array.isArray(conflicts)) {
    return conflicts as Array<{ zone_name: string; zone_code: string; type: string }>
  }
  return []
}

/**
 * DeliveryZoneEdit - Edit an existing delivery zone
 */
export function DeliveryZoneEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { features } = useVendorType()

  const { data, isLoading, error: loadError } = useDeliveryZone(id!)
  const { mutate: updateZone, isPending: isUpdating, error: updateError } = useUpdateDeliveryZone(id!)
  const conflicts = getConflictDetails(updateError)
  const { mutate: deleteZone, isPending: isDeleting } = useDeleteDeliveryZone(id!)

  // Type-specific terminology
  const terminology = features.hasDeliveryZones
    ? { title: "Edit Delivery Zone", singular: "zone" }
    : { title: "Edit Service Area", singular: "area" }

  const [formData, setFormData] = useState({
    name: "",
    code: "",
    center_latitude: "",
    center_longitude: "",
    radius_miles: "10",
    base_delivery_fee: "5.00",
    per_mile_fee: "1.00",
    minimum_order: "",
    active: true,
    priority: "0",
    service_hours_enabled: false,
    service_hours: {
      monday: { open: "09:00", close: "21:00", enabled: true },
      tuesday: { open: "09:00", close: "21:00", enabled: true },
      wednesday: { open: "09:00", close: "21:00", enabled: true },
      thursday: { open: "09:00", close: "21:00", enabled: true },
      friday: { open: "09:00", close: "21:00", enabled: true },
      saturday: { open: "10:00", close: "20:00", enabled: true },
      sunday: { open: "10:00", close: "18:00", enabled: false },
    },
  })

  // Populate form when data loads
  useEffect(() => {
    if (data?.zone) {
      const zone = data.zone
      setFormData({
        name: zone.name || "",
        code: zone.code || "",
        center_latitude: zone.center_latitude?.toString() || "",
        center_longitude: zone.center_longitude?.toString() || "",
        radius_miles: zone.radius_miles?.toString() || "10",
        base_delivery_fee: zone.base_delivery_fee?.toString() || "5.00",
        per_mile_fee: zone.per_mile_fee?.toString() || "1.00",
        minimum_order: zone.minimum_order?.toString() || "",
        active: zone.active ?? true,
        priority: zone.priority?.toString() || "0",
        service_hours_enabled: !!zone.service_hours,
        service_hours: zone.service_hours || formData.service_hours,
      })
    }
  }, [data?.zone])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Build service hours object (only enabled days)
    let serviceHours: Record<string, { open: string; close: string }> | undefined
    if (formData.service_hours_enabled) {
      serviceHours = {}
      for (const [day, hours] of Object.entries(formData.service_hours)) {
        if (hours.enabled) {
          serviceHours[day] = { open: hours.open, close: hours.close }
        }
      }
    }

    const input: UpdateDeliveryZoneInput = {
      name: formData.name,
      center_latitude: parseFloat(formData.center_latitude),
      center_longitude: parseFloat(formData.center_longitude),
      radius_miles: parseFloat(formData.radius_miles),
      base_delivery_fee: parseFloat(formData.base_delivery_fee),
      per_mile_fee: parseFloat(formData.per_mile_fee),
      minimum_order: formData.minimum_order ? parseFloat(formData.minimum_order) : undefined,
      service_hours: serviceHours,
      active: formData.active,
      priority: parseInt(formData.priority, 10),
    }

    updateZone(input, {
      onSuccess: () => navigate("/delivery-zones"),
    })
  }

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete this ${terminology.singular}? This action cannot be undone.`)) {
      deleteZone(undefined, {
        onSuccess: () => navigate("/delivery-zones"),
      })
    }
  }

  const updateField = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const updateServiceHours = (day: string, field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      service_hours: {
        ...prev.service_hours,
        [day]: {
          ...prev.service_hours[day as keyof typeof prev.service_hours],
          [field]: value,
        },
      },
    }))
  }

  if (isLoading) {
    return (
      <Container className="p-8 max-w-2xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-warm-200 rounded w-1/4" />
          <div className="h-64 bg-warm-100 rounded" />
        </div>
      </Container>
    )
  }

  if (loadError || !data?.zone) {
    return (
      <Container className="p-8 max-w-2xl">
        <div className="bg-red-50 text-red-800 p-4 rounded-lg">
          Failed to load {terminology.singular}. It may have been deleted.
        </div>
        <Button
          variant="secondary"
          onClick={() => navigate("/delivery-zones")}
          className="mt-4"
        >
          <ArrowLeft className="mr-2" />
          Back to {features.hasDeliveryZones ? "Delivery Zones" : "Service Areas"}
        </Button>
      </Container>
    )
  }

  const error = updateError

  return (
    <Container className="p-8 max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="transparent"
          onClick={() => navigate("/delivery-zones")}
          className="mb-4 -ml-2 text-warm-600 hover:text-warm-900"
        >
          <ArrowLeft className="mr-2" />
          Back to {features.hasDeliveryZones ? "Delivery Zones" : "Service Areas"}
        </Button>
        <Heading level="h1" className="text-2xl font-serif text-warm-900">
          {terminology.title}
        </Heading>
        <Text className="text-warm-600 mt-1">
          Update your {terminology.singular} settings and pricing
        </Text>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <section>
          <Heading level="h3" className="text-lg font-medium text-warm-900 mb-4">
            Basic Information
          </Heading>

          <div className="space-y-4">
            <div>
              <Label htmlFor="name" className="block text-sm font-medium text-warm-700 mb-2">
                Zone Name *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g., Downtown Delivery"
                required
              />
            </div>

            <div>
              <Label htmlFor="code" className="block text-sm font-medium text-warm-700 mb-2">
                Zone Code
              </Label>
              <Input
                id="code"
                value={formData.code}
                disabled
                className="bg-warm-50"
              />
              <Text className="text-sm text-warm-500 mt-1">
                Zone codes cannot be changed after creation
              </Text>
            </div>
          </div>
        </section>

        {/* Location */}
        <section>
          <Heading level="h3" className="text-lg font-medium text-warm-900 mb-4">
            Location
          </Heading>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="lat" className="block text-sm font-medium text-warm-700 mb-2">
                  Center Latitude *
                </Label>
                <Input
                  id="lat"
                  type="number"
                  step="any"
                  value={formData.center_latitude}
                  onChange={(e) => updateField("center_latitude", e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="lng" className="block text-sm font-medium text-warm-700 mb-2">
                  Center Longitude *
                </Label>
                <Input
                  id="lng"
                  type="number"
                  step="any"
                  value={formData.center_longitude}
                  onChange={(e) => updateField("center_longitude", e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="radius" className="block text-sm font-medium text-warm-700 mb-2">
                Delivery Radius (miles) *
              </Label>
              <Input
                id="radius"
                type="number"
                min="1"
                max="100"
                value={formData.radius_miles}
                onChange={(e) => updateField("radius_miles", e.target.value)}
                required
              />
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section>
          <Heading level="h3" className="text-lg font-medium text-warm-900 mb-4">
            Pricing
          </Heading>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="base_fee" className="block text-sm font-medium text-warm-700 mb-2">
                  Base Delivery Fee ($)
                </Label>
                <Input
                  id="base_fee"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.base_delivery_fee}
                  onChange={(e) => updateField("base_delivery_fee", e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="per_mile" className="block text-sm font-medium text-warm-700 mb-2">
                  Per-Mile Fee ($)
                </Label>
                <Input
                  id="per_mile"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.per_mile_fee}
                  onChange={(e) => updateField("per_mile_fee", e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="min_order" className="block text-sm font-medium text-warm-700 mb-2">
                Minimum Order ($)
              </Label>
              <Input
                id="min_order"
                type="number"
                step="0.01"
                min="0"
                value={formData.minimum_order}
                onChange={(e) => updateField("minimum_order", e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
        </section>

        {/* Service Hours */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <Heading level="h3" className="text-lg font-medium text-warm-900">
              Service Hours
            </Heading>
            <Switch
              checked={formData.service_hours_enabled}
              onCheckedChange={(checked) => updateField("service_hours_enabled", checked)}
            />
          </div>

          {formData.service_hours_enabled && (
            <div className="space-y-3">
              {Object.entries(formData.service_hours).map(([day, hours]) => (
                <div key={day} className="flex items-center gap-4">
                  <div className="w-24">
                    <Switch
                      checked={hours.enabled}
                      onCheckedChange={(checked) => updateServiceHours(day, "enabled", checked)}
                    />
                  </div>
                  <span className="w-24 capitalize text-warm-700">{day}</span>
                  {hours.enabled ? (
                    <>
                      <Input
                        type="time"
                        value={hours.open}
                        onChange={(e) => updateServiceHours(day, "open", e.target.value)}
                        className="w-32"
                      />
                      <span className="text-warm-500">to</span>
                      <Input
                        type="time"
                        value={hours.close}
                        onChange={(e) => updateServiceHours(day, "close", e.target.value)}
                        className="w-32"
                      />
                    </>
                  ) : (
                    <span className="text-warm-400">Closed</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Status */}
        <section>
          <div className="flex items-center justify-between">
            <div>
              <Heading level="h3" className="text-lg font-medium text-warm-900">
                Active
              </Heading>
              <Text className="text-sm text-warm-600">
                Disable to temporarily stop accepting orders in this {terminology.singular}
              </Text>
            </div>
            <Switch
              checked={formData.active}
              onCheckedChange={(checked) => updateField("active", checked)}
            />
          </div>
        </section>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <Text className="text-sm text-red-800">
              {(error as any)?.message || "Failed to update. Please try again."}
            </Text>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between pt-4 border-t border-warm-200">
          <Button
            type="button"
            variant="secondary"
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-red-600 border-red-200 hover:bg-red-50"
          >
            {isDeleting ? "Deleting..." : `Delete ${terminology.singular}`}
          </Button>

          <div className="flex gap-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate("/delivery-zones")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isUpdating}
            >
              {isUpdating ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </form>
    </Container>
  )
}

export const Component = DeliveryZoneEdit
