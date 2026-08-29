// Keeps a linked product's collection membership in sync with its UGIS
// status: "Sold Out" while status is sold, "Shop All" otherwise. Assumes
// both collections already exist in the store (created manually by staff) —
// this only looks them up, never creates them.
import { shopifyGraphql, productGid } from './shopify.ts'

const SHOP_ALL_TITLE = 'Shop All'
const SOLD_OUT_TITLE = 'Sold Out'

// Collection ids don't change — cache them for the life of the function
// instance rather than looking them up on every status change.
const collectionIdCache = new Map<string, string | null>()

const COLLECTION_BY_TITLE = `
  query collectionByTitle($query: String!) {
    collections(first: 5, query: $query) {
      nodes { id title }
    }
  }
`

async function getCollectionIdByTitle(title: string): Promise<string | null> {
  if (collectionIdCache.has(title)) return collectionIdCache.get(title) ?? null

  const data = await shopifyGraphql<{ collections: { nodes: { id: string; title: string }[] } }>(
    COLLECTION_BY_TITLE,
    { query: `title:'${title}'` },
  )
  const match = data.collections.nodes.find(c => c.title.toLowerCase() === title.toLowerCase()) ?? null
  collectionIdCache.set(title, match?.id ?? null)
  return match?.id ?? null
}

const COLLECTION_ADD_PRODUCTS = `
  mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      userErrors { field message }
    }
  }
`

const COLLECTION_REMOVE_PRODUCTS = `
  mutation collectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
    collectionRemoveProducts(id: $id, productIds: $productIds) {
      job { id }
      userErrors { field message }
    }
  }
`

const JOB_STATUS = `
  query jobStatus($id: ID!) {
    job(id: $id) { done }
  }
`

// collectionRemoveProducts is async (unlike collectionAddProducts, which
// applies immediately) — it just queues a job. Without waiting for it, a
// product can sit in both collections for a few seconds after a status
// change, which is exactly the "shows in both" symptom this was built to
// avoid. Bounded so a slow/stuck job can't hang the request indefinitely —
// worst case, it falls back to "eventually consistent" rather than blocking.
async function waitForJob(jobId: string, maxAttempts = 6, delayMs = 500): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const data = await shopifyGraphql<{ job: { done: boolean } | null }>(JOB_STATUS, { id: jobId })
    if (!data.job || data.job.done) return
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
}

/** Puts the product in Shop All or Sold Out based on status, removing it from the other. */
export async function syncProductCollection(productId: string, status: string): Promise<void> {
  const targetTitle = status === 'sold' ? SOLD_OUT_TITLE : SHOP_ALL_TITLE
  const otherTitle = status === 'sold' ? SHOP_ALL_TITLE : SOLD_OUT_TITLE

  const [targetId, otherId] = await Promise.all([
    getCollectionIdByTitle(targetTitle),
    getCollectionIdByTitle(otherTitle),
  ])

  const gid = productGid(productId)

  if (targetId) {
    const added = await shopifyGraphql<{
      collectionAddProducts: { userErrors: { field: string[]; message: string }[] }
    }>(COLLECTION_ADD_PRODUCTS, { id: targetId, productIds: [gid] })
    if (added.collectionAddProducts.userErrors.length > 0) {
      console.error(`[syncProductCollection] add to "${targetTitle}" errors`, added.collectionAddProducts.userErrors)
    }
  } else {
    console.error(`[syncProductCollection] collection "${targetTitle}" not found in store`)
  }

  if (otherId) {
    const removed = await shopifyGraphql<{
      collectionRemoveProducts: { job: { id: string } | null; userErrors: { field: string[]; message: string }[] }
    }>(COLLECTION_REMOVE_PRODUCTS, { id: otherId, productIds: [gid] })
    if (removed.collectionRemoveProducts.userErrors.length > 0) {
      console.error(`[syncProductCollection] remove from "${otherTitle}" errors`, removed.collectionRemoveProducts.userErrors)
    } else if (removed.collectionRemoveProducts.job?.id) {
      await waitForJob(removed.collectionRemoveProducts.job.id)
    }
  }
}
