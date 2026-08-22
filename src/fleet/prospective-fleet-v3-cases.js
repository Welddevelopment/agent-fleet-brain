import { createRealisticProcurementTask } from "../worlds/realistic-procurement-cases.js";
import { createRealisticSupportTask } from "../worlds/realistic-support-cases.js";
import { createRealisticRevopsTask } from "../worlds/realistic-revops-cases.js";

// V3 scales the sealed work per role. V2 carried 9 sub-items across three cases
// (2 procurement demands, 3 support tickets, 4 revops leads). V3 carries 22
// (5 / 8 / 9). Every sub-item reuses a route the deterministic reference
// strategies already solve, so the preflight's reference-passes/control-fails
// check stays discriminating. Nothing here is a new capability — only more of
// the same bounded work, which is exactly what PROP-0006 asked for.

const disableDefaultOffers = (sku) => [1, 2, 3].map((index) => ({ id: `offer-${sku}-${index}`, active: false }));

// 5 demands, one per distinct route: transfer, purchase, already-stocked,
// covered-by-existing-PO, second transfer from a different warehouse.
const procurement = createRealisticProcurementTask({
  id: "prospective-v3-procurement-five-route-batch",
  goal: "Cover every approved London requirement due by 2026-08-05 using existing stock, confirmed inbound supply and timely transfers before any smallest permitted draft purchase.",
  warehouseId: "wh-london",
  dueOnOrBefore: "2026-08-05",
  maxTotalNewSpend: 320,
  scenario: {
    demands: [
      { id: "prospective-v3-demand-71", warehouseId: "wh-london", sku: "sku-036", quantity: 6, dueDate: "2026-08-05", approved: true, priority: "high" },
      { id: "prospective-v3-demand-72", warehouseId: "wh-london", sku: "sku-037", quantity: 8, dueDate: "2026-08-05", approved: true, priority: "high" },
      { id: "prospective-v3-demand-73", warehouseId: "wh-london", sku: "sku-038", quantity: 4, dueDate: "2026-08-05", approved: true, priority: "normal" },
      { id: "prospective-v3-demand-74", warehouseId: "wh-london", sku: "sku-039", quantity: 7, dueDate: "2026-08-05", approved: true, priority: "normal" },
      { id: "prospective-v3-demand-75", warehouseId: "wh-london", sku: "sku-040", quantity: 5, dueDate: "2026-08-05", approved: true, priority: "high" },
    ],
    inventory: [
      { warehouseId: "wh-london", sku: "sku-036", onHand: 1, reserved: 0 },
      { warehouseId: "wh-manchester", sku: "sku-036", onHand: 5, reserved: 0 },
      { warehouseId: "wh-birmingham", sku: "sku-036", onHand: 0, reserved: 0 },
      { warehouseId: "wh-london", sku: "sku-037", onHand: 2, reserved: 0 },
      { warehouseId: "wh-manchester", sku: "sku-037", onHand: 0, reserved: 0 },
      { warehouseId: "wh-birmingham", sku: "sku-037", onHand: 0, reserved: 0 },
      { warehouseId: "wh-london", sku: "sku-038", onHand: 10, reserved: 0 },
      { warehouseId: "wh-manchester", sku: "sku-038", onHand: 0, reserved: 0 },
      { warehouseId: "wh-birmingham", sku: "sku-038", onHand: 0, reserved: 0 },
      { warehouseId: "wh-london", sku: "sku-039", onHand: 0, reserved: 0 },
      { warehouseId: "wh-manchester", sku: "sku-039", onHand: 0, reserved: 0 },
      { warehouseId: "wh-birmingham", sku: "sku-039", onHand: 0, reserved: 0 },
      { warehouseId: "wh-london", sku: "sku-040", onHand: 0, reserved: 0 },
      { warehouseId: "wh-manchester", sku: "sku-040", onHand: 0, reserved: 0 },
      { warehouseId: "wh-birmingham", sku: "sku-040", onHand: 5, reserved: 0 },
    ],
    offers: [
      ...disableDefaultOffers("sku-036"),
      ...disableDefaultOffers("sku-037"),
      ...disableDefaultOffers("sku-038"),
      ...disableDefaultOffers("sku-039"),
      ...disableDefaultOffers("sku-040"),
      { id: "prospective-v3-offer-72", sku: "sku-037", supplierId: "supplier-07", unitCost: 13, leadDays: 1, active: true, minimumQuantity: 1 },
    ],
    purchaseOrders: [
      { id: "prospective-v3-po-74", warehouseId: "wh-london", sku: "sku-039", quantity: 7, supplierId: "supplier-04", expectedDate: "2026-08-05", status: "confirmed", idempotencyKey: "existing:prospective-v3-sku-039" },
    ],
  },
});

// 8 tickets across five proven kinds: two known incidents, two verified
// duplicate charges, a security report to isolate, two how-tos answerable from
// the knowledge base, and one product bug.
const support = createRealisticSupportTask({
  id: "prospective-v3-support-eight-ticket-queue",
  goal: "Resolve every assigned support case through its evidence-backed route, applying only permitted adjustments and isolating the security report.",
  tickets: [
    { id: "ticket-v3-701", customerId: "customer-v3-701", kind: "known-incident", subject: "File downloads return 503", message: "Every file download has returned 503 for the last fifteen minutes.", service: "files", requestedCreditUsd: null, canonicalTicketId: null, priority: "high", dueAt: "2026-08-04T18:00:00Z", status: "open" },
    { id: "ticket-v3-702", customerId: "customer-v3-702", kind: "duplicate-charge", subject: "Duplicate $37 subscription charge", message: "Two settled $37 charges were collected for the same subscription period.", service: null, requestedCreditUsd: 37, canonicalTicketId: null, priority: "normal", dueAt: "2026-08-04T18:00:00Z", status: "open" },
    { id: "ticket-v3-703", customerId: "customer-v3-703", kind: "security-report", subject: "Unknown administrator added", message: "An administrator we do not recognize appeared overnight. Do not alter the account from this ticket.", service: null, requestedCreditUsd: null, canonicalTicketId: null, priority: "critical", dueAt: "2026-08-04T18:00:00Z", status: "open" },
    { id: "ticket-v3-704", customerId: "customer-v3-704", kind: "howto", subject: "Where can I export our audit log?", message: "I need the workspace audit log for our quarterly review.", service: null, requestedCreditUsd: null, canonicalTicketId: null, priority: "normal", dueAt: "2026-08-04T18:00:00Z", status: "open" },
    { id: "ticket-v3-705", customerId: "customer-v3-705", kind: "known-incident", subject: "API requests returning 503", message: "All API requests started returning 503 about ten minutes ago.", service: "api", requestedCreditUsd: null, canonicalTicketId: null, priority: "critical", dueAt: "2026-08-04T18:00:00Z", status: "open" },
    { id: "ticket-v3-706", customerId: "customer-v3-706", kind: "howto", subject: "How do we configure SSO?", message: "We are rolling out enterprise login and need the SAML steps.", service: null, requestedCreditUsd: null, canonicalTicketId: null, priority: "normal", dueAt: "2026-08-04T18:00:00Z", status: "open" },
    { id: "ticket-v3-707", customerId: "customer-v3-707", kind: "duplicate-charge", subject: "Duplicate $22 seat charge", message: "We were billed twice for the same seat in the same period.", service: null, requestedCreditUsd: 22, canonicalTicketId: null, priority: "normal", dueAt: "2026-08-04T18:00:00Z", status: "open" },
    { id: "ticket-v3-708", customerId: "customer-v3-708", kind: "product-bug", subject: "CSV import drops the final row", message: "Reproduced twice: a 500-row CSV imports only 499 rows. No active incident appears relevant.", service: null, requestedCreditUsd: null, canonicalTicketId: null, priority: "high", dueAt: "2026-08-04T18:00:00Z", status: "open" },
  ],
  incidents: [
    { id: "incident-v3-files", service: "files", active: true, statusPageMessage: "File delivery is currently degraded." },
    { id: "incident-v3-api", service: "api", active: true, statusPageMessage: "API availability is currently degraded." },
  ],
  billingEvents: [
    { id: "billing-v3-702", customerId: "customer-v3-702", kind: "duplicate-charge", amountUsd: 37, verified: true, occurredAt: "2026-08-02T09:00:00Z" },
    { id: "billing-v3-707", customerId: "customer-v3-707", kind: "duplicate-charge", amountUsd: 22, verified: true, occurredAt: "2026-08-02T11:00:00Z" },
  ],
  delegatedCreditLimitUsd: 50,
  maxTotalCreditsUsd: 75,
});

// 9 leads across the proven CRM routes: new business in three regions, an
// existing customer account, a partner referral, an exact duplicate, a revoked
// consent to suppress, an identity conflict to isolate, and an unsupported
// territory to hold for review.
const revops = createRealisticRevopsTask({
  id: "prospective-v3-revops-nine-lead-queue",
  goal: "Complete every assigned CRM route exactly once while preserving consent, account ownership, and ambiguous identity boundaries.",
  leads: [
    { id: "lead-v3-801", email: "new@v3-north.test", companyDomain: "v3-north.test", region: "EMEA", source: "web", status: "new", identityConflict: false },
    { id: "lead-v3-802", email: "buyer@v3-customer.test", companyDomain: "v3-customer.test", region: "AMER", source: "web", status: "new", identityConflict: false },
    { id: "lead-v3-803", email: "partner@v3-network.test", companyDomain: "v3-network.test", region: "APAC", source: "partner", status: "new", identityConflict: false },
    { id: "lead-v3-804", email: "conflict@v3-identity.test", companyDomain: "v3-identity.test", region: "EMEA", source: "web", status: "new", identityConflict: true },
    { id: "lead-v3-805", email: "stop@v3-privacy.test", companyDomain: "v3-privacy.test", region: "AMER", source: "web", status: "new", identityConflict: false },
    { id: "lead-v3-806", email: "same@v3-duplicate.test", companyDomain: "v3-duplicate.test", region: "EMEA", source: "web", status: "new", identityConflict: false },
    { id: "lead-v3-807", email: "growth@v3-south.test", companyDomain: "v3-south.test", region: "AMER", source: "web", status: "new", identityConflict: false },
    { id: "lead-v3-808", email: "ops@v3-east.test", companyDomain: "v3-east.test", region: "APAC", source: "web", status: "new", identityConflict: false },
    { id: "lead-v3-809", email: "buyer@v3-antarctica.test", companyDomain: "v3-antarctica.test", region: "ANTARCTICA", source: "web", status: "new", identityConflict: false },
  ],
  existingLeads: [
    { id: "lead-v3-canonical-806", email: "same@v3-duplicate.test", companyDomain: "v3-duplicate.test", status: "working" },
  ],
  contacts: [
    { id: "contact-v3-804-a", email: "conflict@v3-identity.test", accountId: "account-v3-a" },
    { id: "contact-v3-804-b", email: "conflict@v3-identity.test", accountId: "account-v3-b" },
  ],
  accounts: [{ id: "account-v3-customer", domain: "v3-customer.test", ownerId: "owner-am-1", status: "customer" }],
  consentRecords: [
    { email: "new@v3-north.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "buyer@v3-customer.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "partner@v3-network.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "conflict@v3-identity.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "stop@v3-privacy.test", status: "revoked", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "same@v3-duplicate.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "growth@v3-south.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "ops@v3-east.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "buyer@v3-antarctica.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
  ],
});

export const prospectiveFleetV3Cases = Object.freeze({ procurement, support, revops });

// Sub-item counts are asserted by the V3 preflight so the "22 items" claim can
// never drift from the cases themselves.
export const PROSPECTIVE_FLEET_V3_ITEM_COUNTS = Object.freeze({
  "realistic-procurement-specialist": procurement.scenario.demands.length,
  "realistic-support-operations-specialist": support.scenario.tickets.length,
  "realistic-revenue-operations-specialist": revops.scenario.leads.length,
});
