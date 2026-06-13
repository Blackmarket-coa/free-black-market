import { createLogger } from "../../shared/logger"
const log = createLogger("api/users")
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import {
  createUserWorkflow,
  CreateUserWorkflowInput,
} from "../../workflows/user/workflows/create-user"
import { createUserSchema } from "./validation-schemas"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  try {
    const auth_identity_id = req.auth_context?.auth_identity_id

    if (!auth_identity_id) {
      return res.status(401).json({
        message: "Authentication required",
      })
    }

    let validatedBody
    try {
      validatedBody = createUserSchema.parse(req.body)
    } catch (err: any) {
      return res.status(400).json({
        message: "Invalid request body",
        errors: err?.errors ?? err,
      })
    }

    const { result } = await createUserWorkflow(req.scope).run({
      input: {
        user: validatedBody,
        auth_identity_id,
      } as CreateUserWorkflowInput,
    })

    return res.status(201).json({
      user: result.user,
    })
  } catch (error) {
    log.error("[POST /users] Registration failed:", error)

    if (error instanceof MedusaError) {
      return res.status(400).json({
        message: error.message,
        type: error.type,
      })
    }

    return res.status(500).json({
      message: "Failed to create user",
    })
  }
}
