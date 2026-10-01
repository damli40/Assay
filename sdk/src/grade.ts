import { zeroAddress, type Address, type Hex } from "viem";
import type { ContractReader } from "./verify.js";

/// VerifierRegistry.Grade as viem decodes it.
export interface Grade {
  model: Hex;
  hostKey: Hex;
  checks: Hex;
  passed: number;
  total: number;
  ciLowBps: number;
  ciHighBps: number;
  refModel: Hex;
  evidence: Hex;
  /// Unix seconds.
  t: bigint;
}

export const verifierRegistryAbi = [
  {
    type: "function",
    name: "gradeOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "address[]" }],
    outputs: [
      {
        name: "g",
        type: "tuple",
        components: [
          { name: "model", type: "bytes32" },
          { name: "hostKey", type: "bytes32" },
          { name: "checks", type: "bytes32" },
          { name: "passed", type: "uint32" },
          { name: "total", type: "uint32" },
          { name: "ciLowBps", type: "uint16" },
          { name: "ciHighBps", type: "uint16" },
          { name: "refModel", type: "bytes32" },
          { name: "evidence", type: "bytes32" },
          { name: "t", type: "uint64" },
        ],
      },
      { name: "by", type: "address" },
    ],
  },
] as const;

/// Newest grade for (model, hostKey) among `trusted` verifiers, or null when none of them graded it.
export async function gradeOf(
  client: ContractReader,
  registry: Address,
  model: Hex,
  hostKey: Hex,
  trusted: readonly Address[],
): Promise<{ grade: Grade; by: Address } | null> {
  const [grade, by] = (await client.readContract({
    address: registry,
    abi: verifierRegistryAbi,
    functionName: "gradeOf",
    args: [model, hostKey, trusted],
  })) as [Grade, Address];
  return by === zeroAddress ? null : { grade, by };
}

export type GradeStatus = "pass" | "warn" | "unknown" | "fail";

export const GRADE_MAX_AGE_SECONDS = 7n * 24n * 60n * 60n;
export const GRADE_MIN_SAMPLES = 30;

/// `now` is unix seconds. `reference` is the lab endpoint's grade for the same model.
export function gradeStatus(grade: Grade | null | undefined, opts: { now: bigint | number; reference?: Grade | null }): GradeStatus {
  if (!grade || BigInt(opts.now) - grade.t > GRADE_MAX_AGE_SECONDS) return "unknown";
  // Fail only when the intervals don't overlap: the host's best case is below the reference's worst case.
  if (opts.reference && grade.ciHighBps < opts.reference.ciLowBps) return "fail";
  if (grade.total < GRADE_MIN_SAMPLES) return "warn";
  return "pass";
}
