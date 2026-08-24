// The mechanical hypothesis grader.
//
// v1 graded hypotheses with hand-written checks living outside the sealed
// preregistration — the seal bound the cases but not the grader, and four sealed
// expectation keys were never graded at all. v2 closes that: every hypothesis is a
// machine-checkable CLAUSE sealed inside its case record, this module evaluates
// clauses generically, and the preregistration binds THIS FILE by content hash.
// An ungraded sealed clause is now structurally impossible, and editing the grader
// after sealing breaks the preregistration.
//
// Clause shapes:
//   { id, arm, metric, op: "eq"|"lte"|"gte"|"true"|"false", value? }
//   { id, arm, metric, op: "ltAllOf", versusArms: [...] }   — strict win

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function gradeClause({ clause, metricsByArm }) {
  const own = metricsByArm[clause.arm];
  requireCondition(own, `Clause ${clause.id}: no results for arm ${clause.arm}`);
  const observed = own[clause.metric];
  requireCondition(observed !== undefined, `Clause ${clause.id}: metric ${clause.metric} was not reported`);
  if (clause.op === "eq") return { matched: observed === clause.value, observed };
  if (clause.op === "lte") return { matched: observed <= clause.value, observed };
  if (clause.op === "gte") return { matched: observed >= clause.value, observed };
  if (clause.op === "true") return { matched: observed === true, observed };
  if (clause.op === "false") return { matched: observed === false, observed };
  if (clause.op === "ltAllOf") {
    const others = clause.versusArms.map((armId) => {
      requireCondition(metricsByArm[armId], `Clause ${clause.id}: no results for comparison arm ${armId}`);
      return metricsByArm[armId][clause.metric];
    });
    return { matched: others.every((value) => observed < value), observed, versus: others };
  }
  throw new Error(`Clause ${clause.id}: unsupported op ${clause.op}`);
}

export function gradeCaseClauses({ caseRecord, armResults }) {
  const clauses = caseRecord.preregisteredExpectation?.clauses ?? [];
  const metricsByArm = Object.fromEntries(armResults.map((result) => [result.armId, result.metrics]));
  return clauses.map((clause) => {
    let outcome;
    let error = "";
    try {
      outcome = gradeClause({ clause, metricsByArm });
    } catch (caught) {
      outcome = { matched: false, observed: null };
      error = caught.message;
    }
    return {
      caseId: caseRecord.id,
      clauseId: clause.id,
      claim: `${clause.arm}.${clause.metric} ${clause.op}${clause.value !== undefined ? ` ${clause.value}` : ""}${clause.versusArms ? ` vs [${clause.versusArms.join(",")}]` : ""}`,
      matched: outcome.matched,
      observed: outcome.observed,
      ...(outcome.versus ? { versus: outcome.versus } : {}),
      ...(error ? { error } : {}),
    };
  });
}
