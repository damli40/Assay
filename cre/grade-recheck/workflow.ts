import {
	bytesToHex,
	consensusIdenticalAggregation,
	cre,
	decodeJson,
	type EVMLog,
	getNetwork,
	encodeCallMsg,
	hexToBase64,
	type HTTPPayload,
	LAST_FINALIZED_BLOCK_NUMBER,
	type HTTPSendRequester,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, type Hex, parseAbi, toEventSelector, zeroAddress } from 'viem'
import { z } from 'zod'
import { agrees, type Claim, encodeReport, type Recheck, recheckBundle } from './recheck'

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

export const configSchema = z.object({
	chainSelectorName: z.string(),
	verifierRegistry: address,
	creAttestor: address,
	// Bundles are fetched from `${evidenceBaseUrl}/<sha256 hex>.tar.gz`, content-addressed by Grade.evidence.
	// Not z.string().url(): it needs the WHATWG URL class, which the QuickJS runtime lacks.
	evidenceBaseUrl: z.string().regex(/^https:\/\/[^\s/]+(\/\S*)?$/),
	// Run tag -> "erc8004:<chainId>:<agentId>" for Assay hosts (D21); other tags use the default preimage.
	assayHosts: z.record(z.string(), z.string()).default({}),
	gasLimit: z.string().default('300000'),
	// Adds an HTTP trigger that takes a grade as JSON. Simulation accepts it unauthenticated; a deployed
	// workflow needs at least one authorized EVM address.
	replay: z.object({ authorizedEvmAddresses: z.array(address) }).optional(),
})
export type Config = z.infer<typeof configSchema>

export const GRADE_POSTED_ABI = parseAbi([
	'event GradePosted(address indexed verifier, uint256 indexed verifierAgentId, bytes32 indexed model, bytes32 hostKey, uint32 passed, uint32 total, uint16 ciLowBps, uint16 ciHighBps, bytes32 checks, bytes32 refModel, bytes32 evidence, uint64 t)',
])
export const GRADE_POSTED_TOPIC = toEventSelector(GRADE_POSTED_ABI[0])

const u = (max: number) => z.number().int().min(0).max(max)
// Same fields as one entry of export_grade.py's grades_<stamp>.json, plus the verifier address.
export const claimSchema = z.object({
	verifier: address,
	model: bytes32,
	hostKey: bytes32,
	passed: u(2 ** 32 - 1),
	total: u(2 ** 32 - 1),
	ciLowBps: u(10000),
	ciHighBps: u(10000),
	evidence: bytes32,
	t: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
})

export function claimFromLog(log: EVMLog): Claim {
	const { args } = decodeEventLog({
		abi: GRADE_POSTED_ABI,
		data: bytesToHex(log.data),
		topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
	})
	const { verifier, model, hostKey, passed, total, ciLowBps, ciHighBps, evidence, t } = args
	return { verifier, model, hostKey, passed, total, ciLowBps, ciHighBps, evidence, t }
}

export const REGISTRY_ABI = parseAbi([
	'function gradeOf(bytes32 model, bytes32 hostKey, address[] trusted) view returns ((bytes32 model, bytes32 hostKey, bytes32 checks, uint32 passed, uint32 total, uint16 ciLowBps, uint16 ciHighBps, bytes32 refModel, bytes32 evidence, uint64 t) g, address by)',
])
export const ATTESTOR_ABI = parseAbi([
	'function attestations(address verifier, bytes32 model, bytes32 hostKey, uint64 t) view returns (uint32 passed, uint32 total, uint16 ciLowBps, uint16 ciHighBps, bool agree)',
])

/** Where the claim stands in VerifierRegistry at the finalized block: the verifier's latest grade, an older one, or not onchain at all. */
export type OnchainState = 'current' | 'superseded' | 'missing'

function read(runtime: Runtime<Config>, to: string, data: Hex): Hex {
	const reply = evmClient(runtime.config)
		.callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to: to as Hex, data }), blockNumber: LAST_FINALIZED_BLOCK_NUMBER })
		.result()
	return bytesToHex(reply.data)
}

/** The event payload and the replay input are not trusted: the claim must be exactly what the registry holds. */
export function onchainState(runtime: Runtime<Config>, c: Claim): OnchainState {
	const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'gradeOf', args: [c.model, c.hostKey, [c.verifier]] })
	const [g] = decodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'gradeOf', data: read(runtime, runtime.config.verifierRegistry, data) })
	if (g.t > c.t) return 'superseded'
	const same =
		g.t === c.t && g.evidence.toLowerCase() === c.evidence.toLowerCase() && g.passed === c.passed && g.total === c.total &&
		g.ciLowBps === c.ciLowBps && g.ciHighBps === c.ciHighBps
	return same ? 'current' : 'missing'
}

/** One attestation per grade: a rerun on an attested grade writes nothing and costs no gas. */
export function alreadyAttested(runtime: Runtime<Config>, c: Claim): boolean {
	const data = encodeFunctionData({ abi: ATTESTOR_ABI, functionName: 'attestations', args: [c.verifier, c.model, c.hostKey, c.t] })
	const [, total] = decodeFunctionResult({ abi: ATTESTOR_ABI, functionName: 'attestations', data: read(runtime, runtime.config.creAttestor, data) })
	return total > 0
}

// Runs on every node. Returns JSON so identical aggregation compares one string.
const fetchAndRecheck = (http: HTTPSendRequester, config: Config, claim: Claim): string => {
	const url = `${config.evidenceBaseUrl.replace(/\/$/, '')}/${claim.evidence.slice(2)}.tar.gz`
	const resp = http.sendRequest({ url, method: 'GET' }).result()
	// A fetch failure is not evidence of a bad grade: throw so nothing is attested.
	if (resp.statusCode !== 200) throw new Error(`evidence fetch ${url}: HTTP ${resp.statusCode}`)
	return JSON.stringify(recheckBundle(resp.body, claim, config.assayHosts))
}

function recheckAndAttest(runtime: Runtime<Config>, claim: Claim): string {
	const config = runtime.config
	runtime.log(`grade verifier=${claim.verifier} hostKey=${claim.hostKey} ${claim.passed}/${claim.total} ci=[${claim.ciLowBps},${claim.ciHighBps}] evidence=${claim.evidence}`)

	const json = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, fetchAndRecheck, consensusIdenticalAggregation<string>())(config, claim)
		.result()
	const recheck: Recheck = JSON.parse(json)
	const agree = agrees(recheck, claim)
	runtime.log(`recheck hashOk=${recheck.hashOk} tag=${recheck.tag} ${recheck.passed}/${recheck.total} ci=[${recheck.ciLowBps},${recheck.ciHighBps}] agree=${agree}`)

	// Read before writing: never attest a claim the registry doesn't hold, a grade a newer one replaced, or one already attested.
	const state = onchainState(runtime, claim)
	const attested = state === 'current' && alreadyAttested(runtime, claim)
	runtime.log(`onchain state=${state}${attested ? ' already attested' : ''} (VerifierRegistry and CreAttestor at the finalized block)`)
	if (state !== 'current' || attested) {
		const reason = attested ? 'already attested' : `grade is ${state} onchain`
		runtime.log(`not writing: ${reason}`)
		return JSON.stringify({ agree, written: false, reason })
	}

	const report = runtime
		.report({ encodedPayload: hexToBase64(encodeReport(claim, recheck)), encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' })
		.result()
	const write = evmClient(config)
		.writeReport(runtime, { receiver: config.creAttestor, report, gasConfig: { gasLimit: config.gasLimit } })
		.result()
	if (write.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${write.errorMessage || write.txStatus}`)
	const tx = bytesToHex(write.txHash ?? new Uint8Array(32))
	runtime.log(`attested agree=${agree} tx=${tx}`)
	return JSON.stringify({ agree, written: true, tx })
}

export const onGradePosted = (runtime: Runtime<Config>, log: EVMLog): string => recheckAndAttest(runtime, claimFromLog(log))

export function onReplay(runtime: Runtime<Config>, payload: HTTPPayload): string {
	const c = claimSchema.parse(decodeJson(payload.input))
	return recheckAndAttest(runtime, { ...c, verifier: c.verifier as Hex, model: c.model as Hex, hostKey: c.hostKey as Hex, evidence: c.evidence as Hex, t: BigInt(c.t) })
}

function evmClient(config: Config) {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: !config.chainSelectorName.endsWith('-mainnet') })
	if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`)
	return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

export function initWorkflow(config: Config) {
	const handlers = [
		cre.handler(
			evmClient(config).logTrigger({
				addresses: [hexToBase64(config.verifierRegistry)],
				topics: [{ values: [hexToBase64(GRADE_POSTED_TOPIC)] }],
				confidence: 'CONFIDENCE_LEVEL_FINALIZED',
			}),
			onGradePosted,
		),
	]
	if (!config.replay) return handlers
	const authorizedKeys = config.replay.authorizedEvmAddresses.map((publicKey) => ({ type: 'KEY_TYPE_ECDSA_EVM' as const, publicKey }))
	return [...handlers, cre.handler(new cre.capabilities.HTTPCapability().trigger({ authorizedKeys }), onReplay)]
}
