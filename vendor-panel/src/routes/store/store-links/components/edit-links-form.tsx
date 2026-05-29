import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input, Text, Textarea, toast } from "@medusajs/ui"
import { useFieldArray, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { Form } from "../../../../components/common/form"
import { RouteDrawer, useRouteModal } from "../../../../components/modals"
import { KeyboundForm } from "../../../../components/utilities/keybound-form"
import { StoreVendor } from "../../../../types/user"
import { useUpdateMe } from "../../../../hooks/api"

// URL validation helper
const urlSchema = z.string().url().optional().or(z.literal(""))

export const EditLinksSchema = z.object({
  // Primary website
  website_url: urlSchema,
  
  // Social media links
  social_instagram: urlSchema,
  social_facebook: urlSchema,
  social_twitter: urlSchema,
  social_tiktok: urlSchema,
  social_youtube: urlSchema,
  social_linkedin: urlSchema,
  social_pinterest: urlSchema,
  
  // External storefronts
  storefront_etsy: urlSchema,
  storefront_amazon: urlSchema,
  storefront_shopify: urlSchema,
  storefront_ebay: urlSchema,
  storefront_farmers_market: z.string().optional(),

  // Scheduling / digital services
  scheduling_booking_url: urlSchema,
  scheduling_meeting_platform: z.string().optional().or(z.literal("")),
  scheduling_meeting_url: urlSchema,
  scheduling_meeting_instructions: z.string().optional().or(z.literal("")),
  scheduling_ticket_product_handle: z.string().optional().or(z.literal("")),

  certifications: z.array(
    z.object({
      name: z.string().optional().or(z.literal("")),
      issuer: z.string().optional().or(z.literal("")),
      valid_until: z.string().optional().or(z.literal("")),
      document_url: urlSchema,
    })
  ).default([]),
})

export const EditLinksForm = ({ seller }: { seller: StoreVendor }) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()

  const form = useForm<z.infer<typeof EditLinksSchema>>({
    defaultValues: {
      website_url: seller.website_url || "",
      social_instagram: seller.social_links?.instagram || "",
      social_facebook: seller.social_links?.facebook || "",
      social_twitter: seller.social_links?.twitter || "",
      social_tiktok: seller.social_links?.tiktok || "",
      social_youtube: seller.social_links?.youtube || "",
      social_linkedin: seller.social_links?.linkedin || "",
      social_pinterest: seller.social_links?.pinterest || "",
      storefront_etsy: seller.storefront_links?.etsy || "",
      storefront_amazon: seller.storefront_links?.amazon || "",
      storefront_shopify: seller.storefront_links?.shopify || "",
      storefront_ebay: seller.storefront_links?.ebay || "",
      storefront_farmers_market: seller.storefront_links?.farmers_market || "",
      scheduling_booking_url: seller.metadata?.scheduling?.booking_url || "",
      scheduling_meeting_platform: seller.metadata?.scheduling?.meeting_platform || "",
      scheduling_meeting_url: seller.metadata?.scheduling?.meeting_url || "",
      scheduling_meeting_instructions:
        seller.metadata?.scheduling?.meeting_instructions || "",
      scheduling_ticket_product_handle:
        seller.metadata?.scheduling?.ticket_product_handle || "",
      certifications: (seller.certifications || []).map((cert) => ({
        name: cert.name || "",
        issuer: cert.issuer || "",
        valid_until: cert.valid_until ? String(cert.valid_until).split("T")[0] : "",
        document_url: cert.document_url || "",
      })),
    },
    resolver: zodResolver(EditLinksSchema),
  })

  const { mutateAsync, isPending } = useUpdateMe()
  const { fields: certificationFields, append: appendCertification, remove: removeCertification } = useFieldArray({
    control: form.control,
    name: "certifications",
  })

  const handleSubmit = form.handleSubmit(async (values) => {
    // Build the social_links object
    const social_links = {
      instagram: values.social_instagram || undefined,
      facebook: values.social_facebook || undefined,
      twitter: values.social_twitter || undefined,
      tiktok: values.social_tiktok || undefined,
      youtube: values.social_youtube || undefined,
      linkedin: values.social_linkedin || undefined,
      pinterest: values.social_pinterest || undefined,
    }

    // Build the storefront_links object
    const storefront_links = {
      etsy: values.storefront_etsy || undefined,
      amazon: values.storefront_amazon || undefined,
      shopify: values.storefront_shopify || undefined,
      ebay: values.storefront_ebay || undefined,
      farmers_market: values.storefront_farmers_market || undefined,
    }

    const scheduling = {
      booking_url: values.scheduling_booking_url || undefined,
      meeting_platform: values.scheduling_meeting_platform || undefined,
      meeting_url: values.scheduling_meeting_url || undefined,
      meeting_instructions: values.scheduling_meeting_instructions || undefined,
      ticket_product_handle: values.scheduling_ticket_product_handle || undefined,
    }

    const hasScheduling = Object.values(scheduling).some(Boolean)
    const metadata = {
      ...(seller.metadata ?? {}),
    }

    if (hasScheduling) {
      metadata.scheduling = scheduling
    } else {
      delete metadata.scheduling
    }

    const certifications = values.certifications
      .filter((cert) => cert.name?.trim())
      .map((cert) => ({
        name: cert.name!.trim(),
        issuer: cert.issuer?.trim() || undefined,
        valid_until: cert.valid_until || undefined,
        document_url: cert.document_url || undefined,
      }))

    await mutateAsync(
      {
        ...seller,
        website_url: values.website_url || undefined,
        social_links,
        storefront_links,
        certifications,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Links updated successfully")
          handleSuccess()
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex h-full flex-col">
        <RouteDrawer.Body className="overflow-y-auto">
          <div className="flex flex-col gap-y-8">
            {/* Primary Website */}
            <div>
              <Text size="large" weight="plus" className="mb-4">
                Website
              </Text>
              <Form.Field
                name="website_url"
                control={form.control}
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Primary Website URL</Form.Label>
                    <Form.Control>
                      <Input 
                        {...field} 
                        placeholder="https://yourfarm.com"
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>

            {/* Social Media Links */}
            <div>
              <Text size="large" weight="plus" className="mb-4">
                Social Media
              </Text>
              <div className="flex flex-col gap-y-4">
                <Form.Field
                  name="social_instagram"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Instagram</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://instagram.com/yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="social_facebook"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Facebook</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://facebook.com/yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="social_twitter"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Twitter / X</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://twitter.com/yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="social_tiktok"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>TikTok</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://tiktok.com/@yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="social_youtube"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>YouTube</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://youtube.com/@yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="social_linkedin"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>LinkedIn</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://linkedin.com/company/yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="social_pinterest"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Pinterest</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://pinterest.com/yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </div>

            {/* External Storefronts */}
            <div>
              <Text size="large" weight="plus" className="mb-4">
                Other Storefronts
              </Text>
              <Text size="small" className="text-ui-fg-subtle mb-4">
                Let customers know where else they can find your products
              </Text>
              <div className="flex flex-col gap-y-4">
                <Form.Field
                  name="storefront_etsy"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Etsy Shop</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://etsy.com/shop/yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="storefront_amazon"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Amazon Store</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://amazon.com/shops/yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="storefront_shopify"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Shopify Store</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://yourfarm.myshopify.com"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="storefront_ebay"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>eBay Store</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="https://ebay.com/str/yourfarm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="storefront_farmers_market"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Farmers Market Location</Form.Label>
                      <Form.Control>
                        <Input 
                          {...field} 
                          placeholder="e.g., Downtown Saturday Market, Booth 12"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </div>



            <div>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <Text size="large" weight="plus">
                    Certifications & Documents
                  </Text>
                  <Text size="small" className="text-ui-fg-subtle mt-1">
                    Add certifications for your storefront profile across all vendor types.
                  </Text>
                </div>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  onClick={() => appendCertification({ name: "", issuer: "", valid_until: "", document_url: "" })}
                >
                  Add Certification
                </Button>
              </div>
              <div className="flex flex-col gap-y-4">
                {certificationFields.length === 0 && (
                  <Text size="small" className="text-ui-fg-subtle">
                    No certifications added yet.
                  </Text>
                )}
                {certificationFields.map((field, index) => (
                  <div key={field.id} className="rounded-md border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <Text size="small" weight="plus">Certification {index + 1}</Text>
                      <Button type="button" size="small" variant="transparent" onClick={() => removeCertification(index)}>
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <Input {...form.register(`certifications.${index}.name` as const)} placeholder="Certification name" />
                      <Input {...form.register(`certifications.${index}.issuer` as const)} placeholder="Issuing organization" />
                      <Input type="date" {...form.register(`certifications.${index}.valid_until` as const)} />
                      <Input {...form.register(`certifications.${index}.document_url` as const)} placeholder="https://document-url" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Text size="large" weight="plus" className="mb-4">
                Scheduling
              </Text>
              <Text size="small" className="text-ui-fg-subtle mb-4">
                Share booking links for digital services like coaching or readings.
              </Text>
              <div className="flex flex-col gap-y-4">
                <Form.Field
                  name="scheduling_booking_url"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Booking Page URL</Form.Label>
                      <Form.Control>
                        <Input
                          {...field}
                          placeholder="https://calendly.com/yourname"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="scheduling_meeting_platform"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Meeting Platform</Form.Label>
                      <Form.Control>
                        <Input
                          {...field}
                          placeholder="Blackout Chat, Zoom, Signal, etc."
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="scheduling_meeting_url"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Meeting Link</Form.Label>
                      <Form.Control>
                        <Input
                          {...field}
                          placeholder="https://zoom.us/j/..."
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="scheduling_ticket_product_handle"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Ticket Product Handle</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="private-consulting" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  name="scheduling_meeting_instructions"
                  control={form.control}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Meeting Instructions</Form.Label>
                      <Form.Control>
                        <Textarea
                          {...field}
                          placeholder="Share any prep details or access steps."
                          rows={3}
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </div>
          </div>
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button size="small" isLoading={isPending} type="submit">
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
