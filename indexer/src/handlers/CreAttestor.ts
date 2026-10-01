import { indexer } from "envio";

indexer.onEvent(
  { contract: "CreAttestor", event: "GradeAttested", fields: { transaction: ["hash"], block: ["timestamp"] } },
  async ({ event, context }) => {
    const { verifier, model, hostKey, t, agree, passed, total } = event.params;
    const gradeKey = `${verifier}-${model}-${hostKey}-${t}`;
    context.GradeAttestation.set({
      id: `${event.chainId}-${event.srcAddress}-${gradeKey}`,
      attestor: event.srcAddress,
      grade_id: `${event.chainId}-${gradeKey}`,
      verifier,
      model,
      hostKey,
      t,
      agree,
      passed: Number(passed),
      total: Number(total),
      block: event.block.number,
      timestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);
