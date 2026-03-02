import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Container, Heading, Button, Input, Label, Switch, Text } from "@medusajs/ui"
import { ArrowLeft } from "@medusajs/icons"
import { useCreateDeliveryZone, CreateDeliveryZoneInput } from "../../../hooks/api/delivery-zones"
import { useVendorType } from "../../../providers/vendor-type-provider"


const getConflictDetails = (error: any) => {
  const conflicts = error?.details?.backendDetails?.conflicts
  if (Array.isArray(conflicts)) {
    return conflicts as Array<{ zone_name: string; zone_code: string; type: string }>
  }
  return []
}

/**
 * DeliveryZoneCreate - Create a new delivery zone
 * 
 * BMC Design Philosophy:
 * - Step-by-step form with clear sections
 * - Helpful tips for coordinates and pricing
 * - Warm, approachable styling
 */
export function DeliveryZoneCreate() {
  const navigate = useNavigate()
  const { features } = useVendorType()
  const { mutate: createZone, isPending, error } = useCreateDeliveryZone()
  const conflicts = getConflictDetails(error)

  // Type-specific terminology
  const terminology = features.hasDeliveryZones 
    ? { title: "Create Delivery Zone", singular: "zone" }
    : { title: "Create Service Area", singular: "area" }

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
    // Service hours
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Generate code from name if not provided
    const code = formData.code || formData.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "-")
      .slice(0, 20)

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

    // Create a simple circular boundary based on center + radius
    const lat = parseFloat(formData.center_latitude)
    const lng = parseFloat(formData.center_longitude)
    const radiusMiles = parseFloat(formData.radius_miles)
    
    // Convert radius to approximate degrees (very rough)
    const latDelta = radiusMiles / 69 // ~69 miles per degree latitude
    const lngDelta = radiusMiles / (69 * Math.cos(lat * Math.PI / 180))
    
    // Create octagon approximation of circle
    const boundary = {
      type: "Polygon" as const,
      coordinates: [[
        [lng - lngDelta, lat],
        [lng - lngDelta * 0.7, lat + latDelta * 0.7],
        [lng, lat + latDelta],
        [lng + lngDelta * 0.7, lat + latDelta * 0.7],
        [lng + lngDelta, lat],
        [lng + lngDelta * 0.7, lat - latDelta * 0.7],
        [lng, lat - latDelta],
        [lng - lngDelta * 0.7, lat - latDelta * 0.7],
        [lng - lngDelta, lat], // Close the polygon
      ]],
    }

    const input: CreateDeliveryZoneInput = {
      name: formData.name,
      code,
      center_latitude: lat,
      center_longitude: lng,
      radius_miles: radiusMiles,
      boundary,
      base_delivery_fee: parseFloat(formData.base_delivery_fee),
      per_mile_fee: parseFloat(formData.per_mile_fee),
      minimum_order: formData.minimum_order ? parseFloat(formData.minimum_order) : undefined,
      service_hours: serviceHours,
      active: formData.active,
      priority: parseInt(formData.priority, 10),
    }

    createZone(input, {
      onSuccess: () => navigate("/delivery-zones"),
    })
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
          Define where you can deliver and your pricing structure
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
                onChange={(e) => updateField("code", e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                placeholder="AUTO-GENERATED"
                maxLength={20}
              />
              <Text className="text-sm text-warm-500 mt-1">
                Leave blank to auto-generate from name
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
                  placeholder="28.6129"
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
                  placeholder="-80.8076"
                  required
                />
              </div>
            </div>
            
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <Text className="text-sm text-amber-800">
                <strong>Tip:</strong> Use Google Maps to find your coordinates. 
                Right-click your location and select "What's here?" to see the coordinates.
              </Text>
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
              <Text className="text-sm text-warm-500 mt-1">
                Customers outside this radius won't be able to order delivery
              </Text>
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

            <div className="bg-warm-50 rounded-lg p-4">
              <Text className="text-sm text-warm-700">
                <strong>Example:</strong> With a ${formData.base_delivery_fee} base fee and 
                ${formData.per_mile_fee}/mile, a customer 3 miles away would pay{" "}
                <strong>${(parseFloat(formData.base_delivery_fee || "0") + parseFloat(formData.per_mile_fee || "0") * 3).toFixed(2)}</strong> for delivery.
              </Text>
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
                Enable this zone to start accepting delivery orders
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
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
            <Text className="text-sm text-red-800">
              {(error as any)?.message || "Failed to create delivery zone. Please try again."}
            </Text>
            {conflicts.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-red-700">
                {conflicts.map((conflict) => (
                  <li key={`${conflict.zone_code}-${conflict.type}`}>
                    Conflicts with {conflict.zone_name} ({conflict.zone_code}) due to {conflict.type.replaceAll("_", " ")}.
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-4 pt-4 border-t border-warm-200">
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
            disabled={isPending}
          >
            {isPending ? "Creating..." : terminology.title.replace("Create ", "Create ")}
          </Button>
        </div>
      </form>
    </Container>
  )
}
