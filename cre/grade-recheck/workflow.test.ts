import { describe, expect } from 'bun:test'
import { type EVMLog, TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, REPORT_METADATA_HEADER_LENGTH, test } from '@chainlink/cre-sdk/test'
import { bytesToHex, decodeAbiParameters, encodeAbiParameters, encodeEventTopics, hexToBytes, parseAbiParameters, type Hex } from 'viem'
import { REPORT_PARAMS } from './recheck'
import { ASSAY_HOSTS, bundle, claimOf, grades } from './recheck.test'
import { type Config, configSchema, GRADE_POSTED_ABI, initWorkflow, onGradePosted, onReplay } from './workflow'
import { readFileSync } from 'node:fs'

const MONAD_TESTNET = 2183018362218727504n
const config: Config = configSchema.parse({
	chainSelectorName: 'monad-testnet',
	verifierRegistry: '0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1',
	creAttestor: '0x000000000000000000000000000000000000c4e0',
	evidenceBaseUrl: 'https://evidence.example/assay/',
	assayHosts: ASSAY_HOSTS,
})

function gradePostedLog(g: any, override: Record<string, unknown> = {}): EVMLog {
	const c = { ...claimOf(g), ...override }
	const topics = encodeEventTopics({ abi: GRADE_POSTED_ABI, eventName: 'GradePosted', args: { verifier: c.verifier, verifierAgentId: 7n, model: c.model } })
	const data = encodeAbiParameters(
		parseAbiParameters('bytes32, uint32, uint32, uint16, uint16, bytes32, bytes32, bytes32, uint64'),
		[c.hostKey, c.passed, c.total, c.ciLowBps, c.ciHighBps, g.checks, g.refModel, c.evidence, c.t],
	)
	return { topics: (topics as Hex[]).map((t) => hexToBytes(t)), data: hexToBytes(data) } as unknown as EVMLog
}

function run(log: EVMLog, body = bundle, status = 200) {
	const http = HttpActionsMock.testInstance()
	const urls: string[] = []
	http.sendRequest = (req) => {
		urls.push(req.url)
		return { statusCode: status, body, headers: {} } as any
	}
	const evm = EvmMock.testInstance(MONAD_TESTNET)
	const writes: { receiver: Hex; payload: Hex }[] = []
	evm.writeReport = (req) => {
		const raw = req.report!.rawReport
		writes.push({ receiver: bytesToHex(req.receiver), payload: bytesToHex(raw.slice(REPORT_METADATA_HEADER_LENGTH)) })
		return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32).fill(1) }
	}
	const runtime = newTestRuntime(null, {}, config)
	const out = JSON.parse(onGradePosted(runtime as any, log))
	return { out, urls, writes }
}

describe('onGradePosted', () => {
	test('honest grade: fetches by evidence hash and attests agree = true', () => {
		const g = grades.grades[0]
		const { out, urls, writes } = run(gradePostedLog(g))
		expect(urls).toEqual([`https://evidence.example/assay/${g.evidence.slice(2)}.tar.gz`])
		expect(out.agree).toBe(true)
		expect(writes).toHaveLength(1)
		expect(writes[0].receiver).toBe(config.creAttestor.toLowerCase() as Hex)
		const r = decodeAbiParameters(REPORT_PARAMS, writes[0].payload)
		expect(r.slice(1)).toEqual([g.model, g.hostKey, BigInt(g.t), g.passed, g.total, g.ciLowBps, g.ciHighBps, true])
	})

	test('Assay host keyed by ERC-8004 identity is re-checked', () => {
		expect(run(gradePostedLog(grades.grades[2])).out.agree).toBe(true)
	})

	test('inflated pass count: attests the recount with agree = false', () => {
		const g = grades.grades[1]
		const { out, writes } = run(gradePostedLog(g, { passed: 10, ciLowBps: 7224, ciHighBps: 10000 }))
		expect(out.agree).toBe(false)
		expect(decodeAbiParameters(REPORT_PARAMS, writes[0].payload).slice(4)).toEqual([6, 10, 3126, 8319, false])
	})

	test('server returns a different bundle: agree = false', () => {
		const other = new Uint8Array(bundle)
		other[other.length - 1] ^= 1
		expect(run(gradePostedLog(grades.grades[0]), other).out.agree).toBe(false)
	})

	test('evidence unavailable: throws and writes nothing', () => {
		expect(() => run(gradePostedLog(grades.grades[0]), new Uint8Array(), 404)).toThrow('HTTP 404')
	})
})

describe('onReplay', () => {
	const replay = (file: string) => {
		const http = HttpActionsMock.testInstance()
		http.sendRequest = () => ({ statusCode: 200, body: bundle, headers: {} }) as any
		const evm = EvmMock.testInstance(MONAD_TESTNET)
		evm.writeReport = () => ({ txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32) }) as any
		const input = new Uint8Array(readFileSync(`${import.meta.dir}/fixtures/${file}`))
		return JSON.parse(onReplay(newTestRuntime(null, {}, config) as any, { input } as any))
	}
	test('replayed fixtures: honest agrees, inflated does not', () => {
		expect(replay('replay-honest.json').agree).toBe(true)
		expect(replay('replay-inflated.json').agree).toBe(false)
	})
	test('malformed payload is rejected before any fetch', () => {
		const input = new TextEncoder().encode(JSON.stringify({ hostKey: '0x01' }))
		expect(() => onReplay(newTestRuntime(null, {}, config) as any, { input } as any)).toThrow()
	})
})

describe('initWorkflow', () => {
	test('log trigger only, unless replay is configured', () => {
		const handlers = initWorkflow(config)
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onGradePosted)
		const withReplay = initWorkflow({ ...config, replay: { authorizedEvmAddresses: [] } })
		expect(withReplay.map((h) => h.fn)).toEqual([onGradePosted, onReplay])
	})
	test('checked-in configs parse', () => {
		for (const f of ['config.staging.json', 'config.production.json']) {
			configSchema.parse(JSON.parse(readFileSync(`${import.meta.dir}/${f}`, 'utf8')))
		}
	})
})
