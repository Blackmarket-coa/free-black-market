"use client"
import {
  FieldError,
  FieldValues,
  FormProvider,
  useForm,
  useFormContext,
} from "react-hook-form"
import { Button } from "@/components/atoms"
import { zodResolver } from "@hookform/resolvers/zod"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { LabeledInput } from "@/components/cells"
import { loginFormSchema, LoginFormData } from "./schema"
import { useState } from "react"
import { login } from "@/lib/data/customer"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
import { VENDOR_PANEL_URL } from "@/const"

export const LoginForm = () => {
  const methods = useForm<LoginFormData>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  return (
    <FormProvider {...methods}>
      <Form />
    </FormProvider>
  )
}

const Form = () => {
  const [error, setError] = useState("")
  const [vendorUrl, setVendorUrl] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const {
    handleSubmit,
    register,
    formState: { errors, isSubmitting },
  } = useFormContext()
  const router = useRouter()

  const submit = async (data: FieldValues) => {
    const formData = new FormData()
    formData.append("email", data.email)
    formData.append("password", data.password)

    const res = await login(formData)
    if (res?.error) {
      setError(res.error)
      setVendorUrl(
        res.code === "vendor_account" ? res.vendorUrl || VENDOR_PANEL_URL : null
      )
      return
    }
    setError("")
    setVendorUrl(null)
    router.push("/user")
  }

  return (
    <main className="container">
      <h1 className="heading-xl text-center uppercase my-6">
        Log in to your account
      </h1>
      <form onSubmit={handleSubmit(submit)}>
        <div className="w-96 max-w-full mx-auto space-y-4">
          <LabeledInput
            label="E-mail"
            placeholder="Your e-mail address"
            error={errors.email as FieldError}
            {...register("email")}
          />
          <div className="relative">
            <LabeledInput
              label="Password"
              placeholder="Your password"
              type={showPassword ? "text" : "password"}
              error={errors.password as FieldError}
              {...register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-[38px] text-secondary hover:text-primary transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="h-5 w-5" />
              ) : (
                <Eye className="h-5 w-5" />
              )}
            </button>
          </div>
          <div className="text-right">
            <LocalizedClientLink
              href="/forgot-password"
              className="label-md text-secondary hover:text-primary underline"
            >
              Forgot password?
            </LocalizedClientLink>
          </div>
          {error && <p className="label-md text-negative">{error}</p>}
          {vendorUrl && (
            <div className="rounded-sm border border-gray-200 bg-gray-50 p-4 space-y-3">
              <p className="label-md">
                Looking for your seller dashboard? Vendors have their own
                login.
              </p>
              <a
                href={`${vendorUrl}/login`}
                className="block w-full rounded-md bg-green-700 hover:bg-green-600 text-white text-center font-bold uppercase label-md px-4 py-3 transition-colors"
              >
                Go to Vendor Portal login
              </a>
              <p className="label-sm text-secondary">
                Want to shop here too? Create a separate shopper account with
                the sign-up link below.
              </p>
            </div>
          )}
          <Button className="w-full" disabled={isSubmitting}>
            Log in
          </Button>
          <p className="text-center label-md">
            Don&apos;t have an account yet?{" "}
            <LocalizedClientLink href="/user/register" className="underline">
              Sign up!
            </LocalizedClientLink>
          </p>
        </div>
      </form>
    </main>
  )
}
