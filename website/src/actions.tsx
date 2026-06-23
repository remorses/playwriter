// Server actions for the playwriter.dev website.
// Device flow actions and billing (checkout + portal) actions.
'use server'

import { getActionRequest, parseFormData, redirect } from 'spiceflow'
import { router } from 'spiceflow/react'
import { z } from 'zod'
import { getAuth, getBaseUrl, requireSession, requireOrgSession, getOrgSubscription, getDb } from './db.ts'
import { getOrCreateStripeCustomer, getCloudPriceId, getStripe, hasExistingStripeSubscription } from './lib/stripe.ts'
import type { BillingInterval } from './lib/billing-rules.ts'

// ── Device flow actions (used by /device page) ──────────────────────

const deviceUserCodeSchema = z.object({ userCode: z.string().min(1) })

export async function approveDevice(formData: FormData) {
  const actionRequest = getActionRequest()
  await requireSession(actionRequest)
  const { userCode } = parseFormData(deviceUserCodeSchema, formData)
  const auth = getAuth()
  await auth.api.deviceApprove({ body: { userCode }, headers: actionRequest.headers })
  throw redirect(router.href('/device', { user_code: userCode, status: 'approved' }))
}

export async function denyDevice(formData: FormData) {
  const actionRequest = getActionRequest()
  await requireSession(actionRequest)
  const { userCode } = parseFormData(deviceUserCodeSchema, formData)
  const auth = getAuth()
  await auth.api.deviceDeny({ body: { userCode }, headers: actionRequest.headers })
  throw redirect(router.href('/device', { user_code: userCode, status: 'denied' }))
}

// ── API Key actions (used by /dashboard API key panel) ──────────────

const apiKeyNameSchema = z.object({
  name: z.string().min(1).max(100).optional(),
})

const apiKeyDeleteSchema = z.object({
  keyId: z.string().min(1),
})

/** Create a new API key for the current user. Returns the raw key (shown once). */
export async function createApiKey(formData: FormData) {
  const actionRequest = getActionRequest()
  const session = await requireSession(actionRequest)
  const { name } = parseFormData(apiKeyNameSchema, formData)
  const auth = getAuth()
  const result = await auth.api.createApiKey({
    body: {
      name: name || 'Cloud API Key',
      prefix: 'pw_',
      userId: session.userId,
    },
  })
  // Only return the raw key, not internal fields like hashed key or rate limit state
  return { key: result.key }
}

/** Revoke (delete) an API key owned by the current user. */
export async function revokeApiKey(formData: FormData) {
  const actionRequest = getActionRequest()
  const session = await requireSession(actionRequest)
  const { keyId } = parseFormData(apiKeyDeleteSchema, formData)

  // Verify ownership before deleting: the key's referenceId must match the user
  const db = getDb()
  const existing = await db.query.apikey.findFirst({
    where: { id: keyId, referenceId: session.userId },
  })
  if (!existing) {
    throw new Error('API key not found')
  }

  const auth = getAuth()
  await auth.api.deleteApiKey({
    body: { keyId },
    headers: actionRequest.headers,
  })
  throw redirect('/dashboard')
}

// ── Billing actions (used by /dashboard billing panel) ──────────────

const DEFAULT_QUANTITY = 4

const checkoutSchema = z.object({
  interval: z.enum(['monthly', 'yearly']),
  quantity: z.coerce.number().int().min(1).max(100).optional(),
})

/** Start a Stripe Checkout for a cloud browser subscription. If the org
 *  already has an active subscription, redirect to the billing portal
 *  instead so we never create a duplicate. Subscription metadata carries
 *  orgId so the webhook can mirror state back to the right org. */
export async function startCheckout(formData: FormData) {
  const { interval, quantity } = parseFormData(checkoutSchema, formData)
  const billingInterval: BillingInterval = interval === 'monthly' ? 'monthly' : 'yearly'
  const qty = quantity || DEFAULT_QUANTITY

  const actionRequest = getActionRequest()
  const { session, org } = await requireOrgSession(actionRequest)
  const returnUrl = new URL('/dashboard', getBaseUrl()).toString()

  const customerId = await getOrCreateStripeCustomer({
    orgId: org.id,
    email: session.user.email,
    stripeCustomerId: org.stripeCustomerId,
  })
  if (customerId instanceof Error) throw customerId

  const stripe = getStripe()

  // If already subscribed, short-circuit to the portal. Check both local D1
  // and Stripe directly because Checkout completion can race ahead of webhook
  // delivery, and two dashboard submissions can happen before D1 is updated.
  // These are independent (D1 vs Stripe API), so run in parallel.
  const [existing, hasStripeSubscription] = await Promise.all([
    getOrgSubscription(org.id),
    hasExistingStripeSubscription(customerId),
  ])
  if (hasStripeSubscription instanceof Error) throw hasStripeSubscription
  if (existing || hasStripeSubscription) {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })
    throw redirect(portal.url)
  }

  const priceId = await getCloudPriceId(billingInterval)
  if (priceId instanceof Error) throw priceId

  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: qty, adjustable_quantity: { enabled: true, minimum: 1, maximum: 100 } }],
    success_url: returnUrl,
    cancel_url: returnUrl,
    allow_promotion_codes: true,
    client_reference_id: org.id,
    // Managed Payments: Stripe acts as merchant of record, handling
    // indirect tax compliance (VAT, GST, sales tax) globally.
    managed_payments: { enabled: true },
    // Metadata on BOTH the session and the subscription so webhooks
    // can always resolve orgId regardless of event type.
    metadata: { orgId: org.id },
    subscription_data: { metadata: { orgId: org.id } },
  })
  if (!checkout.url) throw new Error('Checkout session has no URL')
  throw redirect(checkout.url)
}

/** Open the Stripe Billing Portal for managing an existing subscription. */
export async function openBillingPortal() {
  const actionRequest = getActionRequest()
  const { session, org } = await requireOrgSession(actionRequest)
  const returnUrl = new URL('/dashboard', getBaseUrl()).toString()

  const customerId = await getOrCreateStripeCustomer({
    orgId: org.id,
    email: session.user.email,
    stripeCustomerId: org.stripeCustomerId,
  })
  if (customerId instanceof Error) throw customerId

  const stripe = getStripe()
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
  throw redirect(portal.url)
}
