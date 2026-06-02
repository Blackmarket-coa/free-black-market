import {
  ZodBoolean,
  ZodNull,
  ZodNullable,
  ZodNumber,
  ZodOptional,
  ZodPipe,
  ZodString,
  ZodType,
  ZodUndefined,
} from "zod"
import { FormFieldType } from "./types"

export function getFieldLabel(name: string, label?: string) {
  if (label) {
    return label
  }

  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function getFieldType(type: ZodType): FormFieldType {
  if (type instanceof ZodString) {
    return "text"
  }

  if (type instanceof ZodNumber) {
    return "number"
  }

  if (type instanceof ZodBoolean) {
    return "boolean"
  }

  if (type instanceof ZodNullable) {
    const innerType = type.unwrap()

    return getFieldType(innerType)
  }

  if (type instanceof ZodOptional) {
    const innerType = type.unwrap()

    return getFieldType(innerType)
  }

  if (type instanceof ZodPipe) {
    // Zod 4 represents transforms/preprocess as ZodPipe; recurse into the input schema.
    return getFieldType(type.in as ZodType)
  }

  return "unsupported"
}

export function getIsFieldOptional(type: ZodType) {
  return (
    type instanceof ZodOptional ||
    type instanceof ZodNull ||
    type instanceof ZodUndefined ||
    type instanceof ZodNullable
  )
}
