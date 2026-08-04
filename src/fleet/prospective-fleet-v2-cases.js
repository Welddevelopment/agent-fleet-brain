import { createRealisticProcurementTask } from "../worlds/realistic-procurement-cases.js";
import { createRealisticSupportTask } from "../worlds/realistic-support-cases.js";
import { createRealisticRevopsTask } from "../worlds/realistic-revops-cases.js";

const disableDefaultOffers = (sku) => [1, 2, 3].map((index) => ({ id: `offer-${sku}-${index}`, active: false }));

const procurement = createRealisticProcurementTask({
  id: "prospective-v2-procurement-transfer-and-order",
  goal: "Cover every approved London requirement due by 2026-08-05 using existing stock and timely transfers before the smallest permitted draft purchase.",
  warehouseId: "wh-london",
  dueOnOrBefore: "2026-08-05",
  maxTotalNewSpend: 240,
  scenario: {
    demands: [
      { id: "prospective-v2-demand-61", warehouseId: "wh-london", sku: "sku-046", quantity: 6, dueDate: "2026-08-05", approved: true, priority: "high" },
      { id: "prospective-v2-demand-62", warehouseId: "wh-london", sku: "sku-047", quantity: 8, dueDate: "2026-08-05", approved: true, priority: "high" },
    ],
    inventory: [
      { warehouseId: "wh-london", sku: "sku-046", onHand: 1, reserved: 0 },
      { warehouseId: "wh-manchester", sku: "sku-046", onHand: 5, reserved: 0 },
      { warehouseId: "wh-birmingham", sku: "sku-046", onHand: 0, reserved: 0 },
      { warehouseId: "wh-london", sku: "sku-047", onHand: 2, reserved: 0 },
      { warehouseId: "wh-manchester", sku: "sku-047", onHand: 0, reserved: 0 },
      { warehouseId: "wh-birmingham", sku: "sku-047", onHand: 0, reserved: 0 },
    ],
    offers: [
      ...disableDefaultOffers("sku-047"),
      { id: "prospective-v2-offer-62", sku: "sku-047", supplierId: "supplier-07", unitCost: 13, leadDays: 1, active: true, minimumQuantity: 1 },
    ],
  },
});

const support = createRealisticSupportTask({
  id: "prospective-v2-support-incident-credit-security",
  goal: "Resolve every assigned support case through its evidence-backed route, applying only permitted adjustments and isolating the security report.",
  tickets: [
    { id: "ticket-v2-501", customerId: "customer-v2-501", kind: "known-incident", subject: "File downloads return 503", message: "Every file download has returned 503 for the last fifteen minutes.", service: "files", requestedCreditUsd: null, canonicalTicketId: null, priority: "high", dueAt: "2026-08-04T18:00:00Z", status: "open" },
    { id: "ticket-v2-502", customerId: "customer-v2-502", kind: "duplicate-charge", subject: "Duplicate $37 subscription charge", message: "Two settled $37 charges were collected for the same subscription period.", service: null, requestedCreditUsd: 37, canonicalTicketId: null, priority: "normal", dueAt: "2026-08-04T18:00:00Z", status: "open" },
    { id: "ticket-v2-503", customerId: "customer-v2-503", kind: "security-report", subject: "Unknown administrator added", message: "An administrator we do not recognize appeared overnight. Do not alter the account from this ticket.", service: null, requestedCreditUsd: null, canonicalTicketId: null, priority: "critical", dueAt: "2026-08-04T18:00:00Z", status: "open" },
  ],
  incidents: [{ id: "incident-v2-files", service: "files", active: true, statusPageMessage: "File delivery is currently degraded." }],
  billingEvents: [{ id: "billing-v2-502", customerId: "customer-v2-502", kind: "duplicate-charge", amountUsd: 37, verified: true, occurredAt: "2026-08-02T09:00:00Z" }],
  delegatedCreditLimitUsd: 50,
  maxTotalCreditsUsd: 75,
});

const revops = createRealisticRevopsTask({
  id: "prospective-v2-revops-four-distinct-routes",
  goal: "Complete every assigned CRM route exactly once while preserving consent, account ownership, and ambiguous identity boundaries.",
  leads: [
    { id: "lead-v2-601", email: "new@v2-north.test", companyDomain: "v2-north.test", region: "EMEA", source: "web", status: "new", identityConflict: false },
    { id: "lead-v2-602", email: "buyer@v2-customer.test", companyDomain: "v2-customer.test", region: "AMER", source: "web", status: "new", identityConflict: false },
    { id: "lead-v2-603", email: "partner@v2-network.test", companyDomain: "v2-network.test", region: "APAC", source: "partner", status: "new", identityConflict: false },
    { id: "lead-v2-604", email: "conflict@v2-identity.test", companyDomain: "v2-identity.test", region: "EMEA", source: "web", status: "new", identityConflict: true },
  ],
  contacts: [
    { id: "contact-v2-604-a", email: "conflict@v2-identity.test", accountId: "account-v2-a" },
    { id: "contact-v2-604-b", email: "conflict@v2-identity.test", accountId: "account-v2-b" },
  ],
  accounts: [{ id: "account-v2-customer", domain: "v2-customer.test", ownerId: "owner-am-1", status: "customer" }],
  consentRecords: [
    { email: "new@v2-north.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "buyer@v2-customer.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "partner@v2-network.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
    { email: "conflict@v2-identity.test", status: "granted", recordedAt: "2026-08-02T09:00:00Z" },
  ],
});

export const prospectiveFleetV2Cases = Object.freeze({ procurement, support, revops });
