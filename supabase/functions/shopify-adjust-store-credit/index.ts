// Adjusts an ALREADY-issued trade-in's store credit amount up or down —
// deliberately separate from shopify-issue-store-credit (the first-time
// issuance), per spec: issuing and adjusting are two distinct, explicit
// actions from the History tab, never an implicit side effect of editing
// the offer amount and saving the item. This exists purely to keep UGIS's
// cost record (items.trade_in_credit_offer / cost_amount) and the
// customer's actual Shopify store credit balance in sync when a trade-in's
// value needs correcting after the fact.
//
// The debit mutation shape below is inferred from the credit mutation's
// shape (same caveat as shopify-issue-store-credit — this project's best
// current read of Shopify's newer Store Credit Admin API). If Shopify
// returns a schema-mismatch error, report it back so this can be corrected
// against the live schema.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { shopifyGraphql, customerGid, getShopCurrencyCode } from '../_shared/shopify.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'

interface RequestBody {
  itemId: string
  newAmount: number
}

const CREDIT = `
  mutation adjustCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
    storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
      storeCreditAccountTransaction { id }
      userErrors { field message }
    }
  }
`

const DEBIT = `
  mutation adjustDebit($id: ID!, $debitInput: StoreCreditAccountDebitInput!) {
    storeCreditAccountDebit(id: $id, debitInput: $debitInput) {
      storeCreditAccountTransaction { id }
      userErrors { field message }
    }
  }
`

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  try {
    const { itemId, newAmount } = (await req.json()) as RequestBody
    if (!itemId) return jsonResponse({ error: 'itemId is required' }, 400)
    if (newAmount == null || newAmount < 0 || !Number.isFinite(newAmount)) {
      return jsonResponse({ error: 'newAmount must be a non-negative number' }, 400)
    }

    const db = supabaseAdmin()
    const { data: item, error: itemErr } = await db
      .from('items')
      .select('id, trade_in_choice, trade_in_credit_offer, shopify_customer_id, shopify_store_credit_txn_id')
      .eq('id', itemId)
      .single()
    if (itemErr || !item) return jsonResponse({ error: itemErr?.message ?? 'Item not found' }, 404)

    if (item.trade_in_choice !== 'credit') {
      return jsonResponse({ error: 'This item is not marked as a credit trade-in' }, 400)
    }
    if (!item.shopify_store_credit_txn_id) {
      return jsonResponse({ error: 'No credit has been issued for this item yet — use Issue Store Credit first' }, 400)
    }
    if (!item.shopify_customer_id) {
      return jsonResponse({ error: 'Item has an issued transaction but no linked customer — this is unexpected' }, 500)
    }

    const currentAmount = Number(item.trade_in_credit_offer ?? 0)
    const delta = Math.round((newAmount - currentAmount) * 100) / 100
    if (delta === 0) {
      return jsonResponse({ ok: true, newAmount, transactionId: null, direction: null })
    }

    const currencyCode = await getShopCurrencyCode()
    const customerId = customerGid(item.shopify_customer_id)
    const direction: 'credit' | 'debit' = delta > 0 ? 'credit' : 'debit'
    const amount = Math.abs(delta)

    const result = direction === 'credit'
      ? await shopifyGraphql<{
          storeCreditAccountCredit: {
            storeCreditAccountTransaction: { id: string } | null
            userErrors: { field: string[]; message: string }[]
          }
        }>(CREDIT, { id: customerId, creditInput: { creditAmount: { amount: String(amount), currencyCode } } })
          .then(d => d.storeCreditAccountCredit)
      : await shopifyGraphql<{
          storeCreditAccountDebit: {
            storeCreditAccountTransaction: { id: string } | null
            userErrors: { field: string[]; message: string }[]
          }
        }>(DEBIT, { id: customerId, debitInput: { debitAmount: { amount: String(amount), currencyCode } } })
          .then(d => d.storeCreditAccountDebit)

    if (result.userErrors.length > 0 || !result.storeCreditAccountTransaction) {
      return jsonResponse({ error: result.userErrors.map(e => e.message).join('; ') || `Failed to ${direction} store credit` }, 502)
    }

    const txnId = result.storeCreditAccountTransaction.id

    // cost_amount mirrors trade_in_credit_offer for a credit trade-in (see
    // ItemForm's onSubmit) — kept in lockstep here since this write bypasses
    // that normal save path entirely.
    const { error: updateErr } = await db.from('items')
      .update({ trade_in_credit_offer: newAmount, cost_amount: newAmount })
      .eq('id', itemId)
    if (updateErr) console.error('[shopify-adjust-store-credit] adjusted but failed to update item', itemId, updateErr)

    const { error: logErr } = await db.from('store_credit_log').insert({
      shopify_customer_id: item.shopify_customer_id,
      amount,
      direction,
      source: 'adjustment',
      related_item_id: itemId,
      shopify_transaction_id: txnId,
    })
    if (logErr) console.error('[shopify-adjust-store-credit] adjusted but failed to write ledger row', itemId, logErr)

    return jsonResponse({ ok: true, newAmount, transactionId: txnId, direction })
  } catch (err) {
    console.error('[shopify-adjust-store-credit]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
