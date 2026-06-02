import { zodResolver } from "@hookform/resolvers/zod"
import type { FieldValues, UseFormProps } from "react-hook-form";
import { useForm } from "react-hook-form"
import { z } from "zod"

import type { ConfigField } from "@/dashboard-app/types"

interface UseExtendableFormProps<
  TSchema extends z.ZodType<any>,
  TContext = any,
  TData = any
> extends Omit<UseFormProps<z.infer<TSchema>, TContext>, "resolver"> {
  schema: TSchema
  configs: ConfigField[]
  data?: TData
}

function createAdditionalDataSchema(configs: ConfigField[]) {
  return configs.reduce((acc, config) => {
    acc[config.name] = config.validation
    
return acc
  }, {} as Record<string, z.ZodType>)
}

function createExtendedSchema<
  TSchema extends z.ZodType<any>
>(baseSchema: TSchema, additionalDataSchema: Record<string, z.ZodType>) {
  const additionalData = z.object(additionalDataSchema).optional()

  // Zod 4 removed ZodEffects: refined/superRefined objects stay ZodObjects and
  // transforms become ZodPipe. Intersecting the base schema with the additional_data
  // object preserves all of the base schema's fields and refinements while adding the
  // optional extension data, without needing to branch on the schema's internal type.
  return z.intersection(baseSchema, z.object({ additional_data: additionalData }))
}

function createExtendedDefaultValues<TData>(
  baseDefaultValues: any,
  configs: ConfigField[],
  data?: TData
) {
  const additional_data = configs.reduce((acc, config) => {
    const { name, defaultValue } = config

    acc[name] =
      typeof defaultValue === "function" ? defaultValue(data) : defaultValue
    
return acc
  }, {} as Record<string, any>)

  return Object.assign(baseDefaultValues, { additional_data })
}

export const useExtendableForm = <
  TSchema extends z.ZodType<any>,
  TContext = any,
  TTransformedValues extends FieldValues | undefined = undefined
>({
  defaultValues: baseDefaultValues,
  schema: baseSchema,
  configs,
  data,
  ...props
}: UseExtendableFormProps<TSchema, TContext>) => {
  const additionalDataSchema = createAdditionalDataSchema(configs)
  const schema = createExtendedSchema(baseSchema, additionalDataSchema)
  const defaultValues = createExtendedDefaultValues(
    baseDefaultValues,
    configs,
    data
  )

  return useForm<z.infer<TSchema>, TContext, TTransformedValues>({
    ...props,
    defaultValues,
    resolver: zodResolver(schema),
  })
}
