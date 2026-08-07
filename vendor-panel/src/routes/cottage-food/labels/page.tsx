import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Label,
  Textarea,
  Checkbox,
  Badge,
  Alert,
  IconButton,
  toast,
} from "@medusajs/ui"
import { Trash, ArrowUpMini, ArrowDownMini } from "@medusajs/icons"
import { useNavigate } from "react-router-dom"
import { sdk } from "../../../lib/sdk"
import {
  useLabels,
  useCottageFoodProfile,
  useInvalidateCottageFood,
  ALLERGEN_OPTIONS,
  formatDate,
  type RenderedLabel,
} from "../_shared"

/**
 * Label builder.
 *
 * Ingredient order is preserved exactly as arranged, because standard labeling
 * practice lists ingredients in descending order by weight and only the person
 * who made the recipe knows that order — hence the explicit move up/down
 * controls rather than an alphabetical or entry-order list.
 *
 * The preview shows what will actually print. Sections the seller hasn't
 * filled in are absent rather than stubbed: a fabricated disclosure sentence
 * would be worse than a missing one.
 */
const CottageFoodLabelsPage = () => {
  const navigate = useNavigate()
  const { data, isLoading } = useLabels()
  const { data: profile } = useCottageFoodProfile()
  const invalidate = useInvalidateCottageFood()

  const [productName, setProductName] = useState("")
  const [netWeight, setNetWeight] = useState("")
  const [ingredients, setIngredients] = useState<string[]>([""])
  const [allergens, setAllergens] = useState<string[]>([])
  const [crossContact, setCrossContact] = useState("")
  const [preview, setPreview] = useState<RenderedLabel | null>(null)

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<RenderedLabel>("/vendor/cottage-food/labels", {
        method: "POST",
        body,
      }),
    onSuccess: (rendered) => {
      invalidate()
      setPreview(rendered)
      toast.success("Label created")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const setIngredientAt = (index: number, value: string) =>
    setIngredients((prev) => prev.map((ing, i) => (i === index ? value : ing)))

  const moveIngredient = (index: number, delta: number) =>
    setIngredients((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const toggleAllergen = (key: string) =>
    setAllergens((prev) =>
      prev.includes(key) ? prev.filter((a) => a !== key) : [...prev, key]
    )

  const submit = () => {
    if (!productName.trim()) {
      toast.error("Give the product a name")
      return
    }
    create.mutate({
      product_name: productName,
      net_weight_text: netWeight,
      ingredients: ingredients.filter((i) => i.trim()).map((name) => ({ name })),
      allergens,
      allergen_cross_contact_note: crossContact,
    })
  }

  const labels = data?.labels ?? []
  const missingDisclosure = !profile?.label_disclosure_text

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Labels</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Built from your ingredients and the wording you saved on your profile.
          </Text>
        </div>
        <Button variant="secondary" size="small" onClick={() => navigate("/cottage-food")}>
          Back
        </Button>
      </div>

      {missingDisclosure && (
        <div className="px-6 py-4">
          <Alert variant="warning" className="max-w-3xl">
            <div className="flex flex-col gap-y-1">
              <Text size="small" weight="plus">
                No disclosure sentence saved yet.
              </Text>
              <Text size="small">
                Most jurisdictions require specific wording on every label. Add
                yours on the Profile tab and it'll be included from then on. You
                can still build labels without it.
              </Text>
            </div>
          </Alert>
        </div>
      )}

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-2">
        <div className="flex flex-col gap-y-4">
          <Heading level="h2">New label</Heading>
          <div>
            <Label size="small">Product name</Label>
            <Input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Sourdough loaf"
            />
          </div>
          <div>
            <Label size="small">Net weight</Label>
            <Input
              value={netWeight}
              onChange={(e) => setNetWeight(e.target.value)}
              placeholder="24 oz"
            />
          </div>

          <div className="flex flex-col gap-y-2">
            <Label size="small">Ingredients</Label>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Heaviest first — that's the order they need to be listed in.
            </Text>
            {ingredients.map((ingredient, index) => (
              <div key={index} className="flex items-center gap-x-2">
                <Input
                  value={ingredient}
                  onChange={(e) => setIngredientAt(index, e.target.value)}
                  placeholder={index === 0 ? "Flour" : "Ingredient"}
                />
                <IconButton
                  size="small"
                  variant="transparent"
                  disabled={index === 0}
                  onClick={() => moveIngredient(index, -1)}
                >
                  <ArrowUpMini />
                </IconButton>
                <IconButton
                  size="small"
                  variant="transparent"
                  disabled={index === ingredients.length - 1}
                  onClick={() => moveIngredient(index, 1)}
                >
                  <ArrowDownMini />
                </IconButton>
                <IconButton
                  size="small"
                  variant="transparent"
                  onClick={() =>
                    setIngredients((prev) =>
                      prev.length === 1 ? [""] : prev.filter((_, i) => i !== index)
                    )
                  }
                >
                  <Trash />
                </IconButton>
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                size="small"
                onClick={() => setIngredients((prev) => [...prev, ""])}
              >
                Add ingredient
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-y-2">
            <Label size="small">Allergens</Label>
            <Text size="xsmall" className="text-ui-fg-subtle">
              The nine that have to be declared by name.
            </Text>
            <div className="grid grid-cols-2 gap-2">
              {ALLERGEN_OPTIONS.map((option) => (
                <label key={option.key} className="flex items-center gap-x-2">
                  <Checkbox
                    checked={allergens.includes(option.key)}
                    onCheckedChange={() => toggleAllergen(option.key)}
                  />
                  <Text size="small">{option.label}</Text>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label size="small">Cross-contact note</Label>
            <Textarea
              rows={2}
              placeholder="Made in a kitchen that also handles peanuts."
              value={crossContact}
              onChange={(e) => setCrossContact(e.target.value)}
            />
          </div>

          <div>
            <Button onClick={submit} isLoading={create.isPending}>
              Create label
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-y-3">
          <Heading level="h2">Preview</Heading>
          {preview ? (
            <>
              <pre className="txt-compact-small whitespace-pre-wrap rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4 font-sans">
                {preview.text}
              </pre>
              {preview.missing.length > 0 && (
                <Alert variant="info">
                  Still missing: {preview.missing.join(", ")}. Your jurisdiction
                  may or may not require these — that's your call.
                </Alert>
              )}
              <Button variant="secondary" size="small" onClick={() => window.print()}>
                Print
              </Button>
            </>
          ) : (
            <Text className="text-ui-fg-subtle">
              Create a label and it'll render here exactly as it will print.
            </Text>
          )}
        </div>
      </div>

      <div className="px-6 py-6">
        <Heading level="h2" className="mb-4">
          Saved labels
        </Heading>
        {isLoading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : labels.length === 0 ? (
          <Text className="text-ui-fg-subtle">No labels yet.</Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {labels.map((label) => (
              <div
                key={label.id}
                className="flex items-center justify-between rounded-lg border border-ui-border-base px-4 py-3"
              >
                <div className="flex flex-col">
                  <Text size="small" weight="plus">
                    {label.product_name}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {formatDate(label.created_at)}
                    {label.net_weight_text ? ` · ${label.net_weight_text}` : ""}
                  </Text>
                </div>
                <Badge size="2xsmall" color={label.seller_reviewed_at ? "green" : "grey"}>
                  {label.seller_reviewed_at ? "Reviewed" : "Not reviewed"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

export default CottageFoodLabelsPage
