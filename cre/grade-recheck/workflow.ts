import {
	bytesToHex,
	consensusIdenticalAggregation,
	cre,
	decodeJson,
	type EVMLog,
	getNetwork,
	hexToBase64,
	type HTTPPayload,
	type HTTPSendRequester,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { decodeEventLog, type Hex, parseAbi, toEventSelector } from 'viem'
import { z } from 'zod'
import { agrees, type Claim, encodeReport, type Recheck, recheckBundle } from './recheck'

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

export const configSchema = z.object({
	chainSelectorName: z.string(),
	verifierRegistry: address,
	creAttestor: address,
	// Bundles are fetched from `${evidenceBaseUrl}/<sha256 hex>.tar.gz`, content-addressed by Grade.evidence.
	evidenceBaseUrl: z.string().url(),
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

	const report = runtime
		.report({ encodedPayload: hexToBase64(encodeReport(claim, recheck)), encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' })
		.result()
	const write = evmClient(config)
		.writeReport(runtime, { receiver: config.creAttestor, report, gasConfig: { gasLimit: config.gasLimit } })
		.result()
	if (write.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${write.errorMessage || write.txStatus}`)
	const tx = bytesToHex(write.txHash ?? new Uint8Array(32))
	runtime.log(`attested agree=${agree} tx=${tx}`)
	return JSON.stringify({ agree, tx })
}

export const onGradePosted = (runtime: Runtime<Config>, log: EVMLog): string => recheckAndAttest(runtime, claimFromLog(log))

export function onReplay(runtime: Runtime<Config>, payload: HTTPPayload): string {
	const c = claimSchema.parse(decodeJson(payload.input))
	return recheckAndAttest(runtime, { ...c, verifier: c.verifier as Hex, model: c.model as Hex, hostKey: c.hostKey as Hex, evidence: c.evidence as Hex, t: BigInt(c.t) })
}

function evmClient(config: Config) {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: true })
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
