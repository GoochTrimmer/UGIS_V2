// Store credit issuance (spec §9, stages 2–3). Called from the item edit
// form once a trade-in's outcome is "credit" — resolves (or creates) the
// customer's Shopify account, then credits it via the Store Credit Admin
// API, and mirrors the transaction into store_credit_log (the internal
// accounting ledger — Shopify's own account is what checkout actually
// honors, this is UGIS's copy for liability reporting/reconciliation only).
//
// The customerId/creditInput mutation shape below is this project's best
// current read of Shopify's Store Credit Admin API, which is newer and
// less battle-tested here than the rest of this codebase's GraphQL calls —
// same caveat as shopify-publish-product when it was first written. If
// Shopify comes back with a schema-mismatch error, that error message will
// say exactly which part is wrong; report it back so this can be corrected
// against the live schema.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { shopifyGraphql, customerGid, adminCustomerUrl, getShopCurrencyCode } from '../_shared/shopify.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'

interface RequestBody {
  itemId: string
  customerEmail?: string
  customerPhone?: string
}

const FIND_CUSTOMER = `
  query findCustomer($query: String!) {
    customers(first: 1, query: $query) {
      edges { node { id } }
    }
  }
`

const CREATE_CUSTOMER = `
  mutation createCustomer($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }
`

const ISSUE_CREDIT = `
  mutation issueStoreCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
    storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
      storeCreditAccountTransaction {
        id
        amount { amount currencyCode }
      }
      userErrors { field message }
    }
  }
`

async function resolveCustomerId(email?: string, phone?: string): Promise<string> {
  const query = email ? `email:${email}` : `phone:${phone}`
  const found = await shopifyGraphql<{ customers: { edges: { node: { id: string } }[] } }>(FIND_CUSTOMER, { query })
  const existingId = found.customers.edges[0]?.node.id
  if (existingId) return existingId

  const created = await shopifyGraphql<{
    customerCreate: { customer: { id: string } | null; userErrors: { field: string[]; message: string }[] }
  }>(CREATE_CUSTOMER, { input: email ? { email } : { phone } })

  const { customer, userErrors } = created.customerCreate
  if (userErrors.length > 0 || !customer) {
    throw new Error(userErrors.map(e => e.message).join('; ') || 'Failed to create Shopify customer')
  }
  return customer.id
}

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  try {
    const { itemId, customerEmail, customerPhone } = (await req.json()) as RequestBody
    if (!itemId) return jsonResponse({ error: 'itemId is required' }, 400)

    const db = supabaseAdmin()
    const { data: item, error: itemErr } = await db
      .from('items')
      .select('id, name, trade_in_choice, trade_in_credit_offer, shopify_customer_id, shopify_store_credit_txn_id')
      .eq('id', itemId)
      .single()
    if (itemErr || !item) return jsonResponse({ error: itemErr?.message ?? 'Item not found' }, 404)

    if (item.trade_in_choice !== 'credit') {
      return jsonResponse({ error: 'This item is not marked as a credit trade-in' }, 400)
    }
    if (!item.trade_in_credit_offer || item.trade_in_credit_offer <= 0) {
      return jsonResponse({ error: 'No credit offer amount set on this item' }, 400)
    }
    if (item.shopify_store_credit_txn_id) {
      return jsonResponse({ error: 'Store credit has already been issued for this item' }, 400)
    }

    let shopifyCustomerId = item.shopify_customer_id as string | null
    if (!shopifyCustomerId) {
      if (!customerEmail && !customerPhone) {
        return jsonResponse({ error: 'Customer email or phone is required to issue store credit' }, 400)
      }
      shopifyCustomerId = await resolveCustomerId(customerEmail, customerPhone)
      const adminUrl = adminCustomerUrl(shopifyCustomerId)
      // Persisted immediately, before the credit call — if the credit call
      // below fails, a retry reuses this customer instead of creating a
      // second duplicate Shopify customer for the same trade-in.
      await db.from('items').update({
        shopify_customer_id: shopifyCustomerId,
        shopify_customer_admin_url: adminUrl,
      }).eq('id', itemId)
    }

    const currencyCode = await getShopCurrencyCode()
    const issued = await shopifyGraphql<{
      storeCreditAccountCredit: {
        storeCreditAccountTransaction: { id: string; amount: { amount: string; currencyCode: string } } | null
        userErrors: { field: string[]; message: string }[]
      }
    }>(ISSUE_CREDIT, {
      id: customerGid(shopifyCustomerId),
      creditInput: {
        creditAmount: { amount: String(item.trade_in_credit_offer), currencyCode },
      },
    })

    const { storeCreditAccountTransaction, userErrors } = issued.storeCreditAccountCredit
    if (userErrors.length > 0 || !storeCreditAccountTransaction) {
      return jsonResponse({ error: userErrors.map(e => e.message).join('; ') || 'Failed to issue store credit' }, 502)
    }

    const txnId = storeCreditAccountTransaction.id

    const { error: updateErr } = await db.from('items').update({ shopify_store_credit_txn_id: txnId }).eq('id', itemId)
    if (updateErr) console.error('[shopify-issue-store-credit] issued but failed to save txn id on item', itemId, updateErr)

    const { error: logErr } = await db.from('store_credit_log').insert({
      shopify_customer_id: shopifyCustomerId,
      amount: item.trade_in_credit_offer,
      direction: 'credit',
      source: 'trade_in',
      related_item_id: itemId,
      shopify_transaction_id: txnId,
    })
    if (logErr) console.error('[shopify-issue-store-credit] issued but failed to write ledger row', itemId, logErr)

    return jsonResponse({
      ok: true,
      shopifyCustomerId,
      adminCustomerUrl: adminCustomerUrl(shopifyCustomerId),
      transactionId: txnId,
    })
  } catch (err) {
    console.error('[shopify-issue-store-credit]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
