import { zodResolver } from "@hookform/resolvers/zod"
import { Alert, Button, Heading, Hint, Input, Text } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { Trans, useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import * as z from "zod"

import { Form } from "../../components/common/form"
import AvatarBox from "../../components/common/logo-box/avatar-box"
import { ResourceQuiz, type ResourceKey, type ResourceQuizResult } from "../../components/playbook/resource-quiz"
import { PLAYBOOK_DISPLAY_NAMES } from "../../components/playbook/playbook-picker"
import type { PlaybookId } from "../../components/playbook/playbook-picker/recommend"
import { useSignUpWithEmailPass } from "../../hooks/api"
import { isFetchError } from "../../lib/is-fetch-error"
import { useState } from "react"

// URL validation helper
const urlSchema = z.string().url().optional().or(z.literal(""))

const RegisterSchema = z
  .object({
    name: z.string().min(2, { message: "Name should be a string" }),
    email: z.string().email({ message: "Invalid email" }),
    password: z
      .string()
      .min(8, { message: "Password must be at least 8 characters" })
      .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
      .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
      .regex(/[0-9!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/, {
        message: "Password must contain at least one number or symbol",
      }),
    confirmPassword: z.string().min(1, { message: "Please confirm your password" }),
    website_url: urlSchema,
    instagram: urlSchema,
    facebook: urlSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

function getNamePlaceholder(playbook: PlaybookId | null): string {
  const placeholders: Record<PlaybookId, string> = {
    stall: "Your business name",
    atelier: "Studio or collective name",
    grove: "Project or co-op name",
    workshop: "Co-op name",
    commons: "Co-op name",
    cycle: "Farm name",
    kitchen: "Kitchen or restaurant name",
    harvest: "Garden name",
    hub: "Hub or network name",
    service: "Your name or practice",
    creator: "Your creator or channel name",
  }
  return playbook ? placeholders[playbook] : "Business name"
}

function getOptionalFieldsHint(playbook: PlaybookId | null): string {
  const hints: Record<PlaybookId, string> = {
    stall: "Add your website & social media",
    atelier: "Add your studio's website & social media",
    grove: "Add your project's website & social media",
    workshop: "Add your co-op's website & social media",
    commons: "Add your co-op's website & social media",
    cycle: "Add your farm website & social media",
    kitchen: "Add your kitchen website & social media",
    harvest: "Add your garden's website & social media",
    hub: "Add your hub's website & social media",
    service: "Add your website & social media",
    creator: "Add your channels & social media",
  }
  return playbook ? hints[playbook] : "Add website & social links"
}

export const Register = () => {
  const [step, setStep] = useState<"quiz" | "details">("quiz")
  const [selectedPlaybook, setSelectedPlaybook] = useState<PlaybookId | null>(null)
  const [recommendedPlaybook, setRecommendedPlaybook] = useState<PlaybookId | null>(null)
  const [roles, setRoles] = useState<PlaybookId[]>([])
  const [resources, setResources] = useState<ResourceKey[]>([])
  const [success, setSuccess] = useState(false)
  const [showOptionalFields, setShowOptionalFields] = useState(false)
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const emailFromUrl = searchParams.get("email") || ""

  const form = useForm<z.infer<typeof RegisterSchema>>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: {
      name: "",
      email: emailFromUrl,
      password: "",
      confirmPassword: "",
      website_url: "",
      instagram: "",
      facebook: "",
    },
  })

  const { mutateAsync, isPending } = useSignUpWithEmailPass()

  const handleQuizComplete = (result: ResourceQuizResult) => {
    setSelectedPlaybook(result.recipe_id)
    setRecommendedPlaybook(result.recommended_recipe_id)
    setRoles(result.roles)
    setResources(result.resources)
    setStep("details")
  }
  const handleBackToQuiz = () => setStep("quiz")

  const handleSubmit = form.handleSubmit(async ({ name, email, password, confirmPassword }) => {
    await mutateAsync(
      {
        name,
        email,
        password,
        confirmPassword,
        playbook: selectedPlaybook || undefined,
        recommended_playbook: recommendedPlaybook || undefined,
        roles,
        resources,
      },
      {
        onError: (error) => {
          if (isFetchError(error) && error.status === 401) {
            form.setError("email", { type: "manual", message: error.message })
            return
          }
          form.setError("root.serverError", { type: "manual", message: error.message })
        },
        onSuccess: () => setSuccess(true),
      }
    )
  })

  const serverError = form.formState.errors?.root?.serverError?.message
  const validationError =
    form.formState.errors.email?.message ||
    form.formState.errors.password?.message ||
    form.formState.errors.name?.message ||
    form.formState.errors.confirmPassword?.message

  const playbookLabel = selectedPlaybook ? PLAYBOOK_DISPLAY_NAMES[selectedPlaybook] : null

  if (success)
    return (
      <div className="bg-ui-bg-subtle flex min-h-dvh w-dvw items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="bg-ui-bg-base shadow-elevation-card-rest border-ui-border-base flex flex-col items-center rounded-2xl border p-6 text-center sm:p-8">
            <div className="bg-ui-tag-green-bg mb-4 flex h-16 w-16 items-center justify-center rounded-full">
              <svg
                className="text-ui-tag-green-icon h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <Heading>Thank You for registering!</Heading>
            <Text
              size="small"
              className="text-ui-fg-subtle mt-2 max-w-[320px] text-center"
            >
              {playbookLabel ? (
                <>
                  You've registered with the <strong>{playbookLabel}</strong> playbook.{" "}
                </>
              ) : null}
              You may need to wait for admin authorization before logging in. A
              confirmation email will be sent shortly.
            </Text>
            <Link to="/login">
              <Button className="mt-8">Back to login page</Button>
            </Link>
          </div>
        </div>
      </div>
    )

  if (step === "quiz")
    return (
      <div className="bg-ui-bg-subtle flex min-h-dvh w-dvw items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl">
          <div className="bg-ui-bg-base shadow-elevation-card-rest border-ui-border-base rounded-2xl border p-6 sm:p-8">
            <div className="mb-2 flex flex-col items-center gap-3 text-center">
              <AvatarBox />
              <Text size="small" className="text-ui-fg-subtle max-w-md">
                Answer a few quick questions and we'll match you to the right
                seller setup. You can change it later.
              </Text>
            </div>
            <ResourceQuiz onComplete={handleQuizComplete} />
            <div className="mt-2 text-center">
              <span className="text-ui-fg-muted txt-small">
                <Trans
                  i18nKey="register.alreadySeller"
                  components={[
                    <Link
                      to="/login"
                      className="text-ui-fg-interactive transition-fg hover:text-ui-fg-interactive-hover focus-visible:text-ui-fg-interactive-hover font-medium outline-none"
                    />,
                  ]}
                />
              </span>
            </div>
          </div>
        </div>
      </div>
    )

  return (
    <div className="bg-ui-bg-subtle flex min-h-dvh w-dvw items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="bg-ui-bg-base shadow-elevation-card-rest border-ui-border-base flex flex-col items-center rounded-2xl border p-6 sm:p-8">
          <div className="mb-6 flex w-full flex-col items-center gap-4 text-center">
            <AvatarBox />
            {playbookLabel && (
              <div className="bg-ui-bg-component flex items-center gap-2 rounded-full px-3 py-1.5">
                <Text size="small" className="text-ui-fg-base font-medium">
                  {playbookLabel} playbook
                  {roles.length > 1 ? ` +${roles.length - 1} more` : ""}
                </Text>
                <button
                  type="button"
                  onClick={handleBackToQuiz}
                  className="text-ui-fg-muted hover:text-ui-fg-base ml-1"
                  aria-label="Change playbook"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                </button>
              </div>
            )}
            <div className="flex flex-col items-center">
              <Heading>{t("register.title")}</Heading>
              <Text size="small" className="text-ui-fg-subtle text-center">
                {t("register.hint")}
              </Text>
            </div>
            <div className="bg-ui-bg-component text-ui-fg-subtle inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
              Last step
            </div>
          </div>
          <div className="flex w-full flex-col gap-y-3">
            <Form {...form}>
              <form
                onSubmit={handleSubmit}
                className="flex w-full flex-col gap-y-6"
              >
                <div className="grid gap-4">
                  <Form.Field
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label className="text-ui-fg-base text-sm font-medium">
                          Business name
                        </Form.Label>
                        <Form.Control>
                          <Input
                            {...field}
                            placeholder={getNamePlaceholder(selectedPlaybook)}
                            className="bg-ui-bg-field-component"
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                  <Form.Field
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label className="text-ui-fg-base text-sm font-medium">
                          {t("fields.email")}
                        </Form.Label>
                        <Form.Control>
                          <Input
                            {...field}
                            type="email"
                            placeholder={t("fields.email")}
                            className="bg-ui-bg-field-component"
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label className="text-ui-fg-base text-sm font-medium">
                            {t("fields.password")}
                          </Form.Label>
                          <Form.Control>
                            <Input
                              {...field}
                              type="password"
                              placeholder={t("fields.password")}
                              className="bg-ui-bg-field-component"
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label className="text-ui-fg-base text-sm font-medium">
                            Confirm password
                          </Form.Label>
                          <Form.Control>
                            <Input
                              {...field}
                              type="password"
                              placeholder="Confirm password"
                              className="bg-ui-bg-field-component"
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>

                <div className="border-ui-border-base mt-2 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setShowOptionalFields(!showOptionalFields)}
                    className="text-ui-fg-interactive mx-auto flex items-center gap-1 text-sm font-medium hover:underline"
                  >
                    {showOptionalFields
                      ? "Hide"
                      : getOptionalFieldsHint(selectedPlaybook)}{" "}
                    (optional)
                    <svg
                      className={`h-4 w-4 transition-transform ${showOptionalFields ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                  {showOptionalFields &&
                    ["website_url", "instagram", "facebook"].map((field) => (
                      <Form.Field
                        key={field}
                        control={form.control}
                        name={field as any}
                        render={({ field: f }) => (
                          <Form.Item>
                            <Form.Label className="text-ui-fg-base text-sm font-medium">
                              {field.replace("_", " ").toUpperCase()}
                            </Form.Label>
                            <Form.Control>
                              <Input
                                {...f}
                                className="bg-ui-bg-field-component"
                                placeholder={field.replace("_", " ").toUpperCase()}
                              />
                            </Form.Control>
                          </Form.Item>
                        )}
                      />
                    ))}
                  <Text size="xsmall" className="text-ui-fg-muted text-center">
                    You can add more links after registration
                  </Text>
                </div>

                {validationError && (
                  <Hint className="inline-flex" variant="error">
                    {validationError}
                  </Hint>
                )}
                {serverError && (
                  <Alert
                    className="bg-ui-bg-base items-center p-2"
                    dismissible
                    variant="error"
                  >
                    {serverError}
                  </Alert>
                )}

                <Button className="w-full" type="submit" isLoading={isPending}>
                  Create account
                </Button>
              </form>
            </Form>
            <div className="text-ui-fg-muted txt-small mt-4 text-center">
              By continuing, you agree to complete onboarding once approved.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
