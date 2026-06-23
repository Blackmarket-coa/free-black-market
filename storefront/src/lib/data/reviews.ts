"use server"
import { revalidatePath } from "next/cache"
import { fetchQuery } from "../config"
import { getAuthHeaders } from "./cookies"
import { HttpTypes } from "@medusajs/types"
import { CreateReviewPayload, OrderReview } from "@/types/review"

export type Review = {
  id: string
  seller: {
    id: string
    name: string
    photo: string
  }
  reference: string
  customer_note: string
  rating: number
  updated_at: string
}

export type Order = HttpTypes.StoreOrder & {
  seller: { id: string; name: string; reviews?: OrderReview[] }
  reviews: OrderReview[]
}

const getReviews = async () => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const res = await fetchQuery("/store/reviews", {
    headers,
    method: "GET",
    query: { fields: "*seller,+customer.id,+order_id" },
  })

  return res
}

const createReview = async (review: CreateReviewPayload) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const response = await fetchQuery("/store/reviews", {
    headers,
    method: "POST",
    body: review,
  }).then((res) => {
    revalidatePath("/user/reviews")
    revalidatePath("/user/reviews/written")
    return res
  })

  return response.data
}

export { getReviews, createReview }
