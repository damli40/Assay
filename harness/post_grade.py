#!/usr/bin/env python3
"""Print the cast commands that post an export_grade.py run to VerifierRegistry.

It only prints. You run the commands yourself, so the verifier key stays in its Foundry keystore.
Hosts whose whole interval sits below the reference's are held back (7-day right of reply) unless
--include-below-reference is given.

    python3 post_grade.py assay_out/grades_<stamp>.json
    python3 post_grade.py assay_out/grades_<stamp>.json --feedback-agent 1962 --feedback-tag direct:assay.example.com
"""
import argparse
import json
import shlex
import sys

REGISTRY = "0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91"
REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713"
GRADE_SIG = "postGrade((bytes32,bytes32,bytes32,uint32,uint32,uint16,uint16,bytes32,bytes32,uint64))"
FEEDBACK_SIG = "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)"


def grade_tuple(g):
    fields = [g["model"], g["hostKey"], g["checks"], g["passed"], g["total"],
              g["ciLowBps"], g["ciHighBps"], g["refModel"], g["evidence"], g["t"]]
    return "(" + ",".join(str(f) for f in fields) + ")"


def below_reference(g, ref):
    return ref is not None and g is not ref and g["ciHighBps"] < ref["ciLowBps"]


def plan(doc, only=None, include_below=False):
    """Returns (to_post, held). The reference row is whichever grade's tag equals doc["reference"]."""
    ref = next((g for g in doc["grades"] if g["tag"] == doc.get("reference")), None)
    to_post, held = [], []
    for g in doc["grades"]:
        if only and g["tag"] not in only:
            continue
        (held if below_reference(g, ref) and not include_below else to_post).append(g)
    return to_post, held


def commands(doc, to_post, account, rpc, registry=REGISTRY, feedback_agent=None, feedback_tag=None,
             evidence_url="", endpoint=""):
    out = []
    for g in to_post:
        out.append(f"cast send {registry} {shlex.quote(GRADE_SIG)} {shlex.quote(grade_tuple(g))} "
                   f"--account {account} --rpc-url {rpc}")
    if feedback_agent is not None:
        g = next((x for x in to_post if x["tag"] == feedback_tag), None)
        if g is None:
            raise SystemExit(f"--feedback-tag {feedback_tag!r} is not among the grades being posted")
        # Pass rate in basis points with 2 decimals, so 9500 reads as 95.00.
        value = g["passed"] * 10000 // g["total"]
        args = [str(feedback_agent), str(value), "2", "assay-grade", doc["modelId"], endpoint, evidence_url, g["evidence"]]
        out.append(f"cast send {REPUTATION} {shlex.quote(FEEDBACK_SIG)} " + " ".join(shlex.quote(a) for a in args)
                   + f" --account {account} --rpc-url {rpc}")
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("grades", help="grades_<stamp>.json from export_grade.py")
    p.add_argument("--account", default="assay-verifier", help="Foundry keystore of the registered verifier")
    p.add_argument("--rpc-url", default="monad_testnet", help="RPC URL or foundry.toml alias (run from contracts/)")
    p.add_argument("--registry", default=REGISTRY)
    p.add_argument("--only", nargs="*", help="post only these endpoint tags")
    p.add_argument("--include-below-reference", action="store_true",
                   help="also post hosts below the reference (only after their 7-day right of reply)")
    p.add_argument("--feedback-agent", type=int, help="ERC-8004 agentId to leave reputation feedback on")
    p.add_argument("--feedback-tag", help="which endpoint tag in the run is that agent")
    p.add_argument("--evidence-url", default="", help="public URL of the evidence bundle")
    p.add_argument("--endpoint", default="", help="the graded host's URL, for the feedback record")
    a = p.parse_args(argv)

    with open(a.grades) as f:
        doc = json.load(f)
    to_post, held = plan(doc, a.only, a.include_below_reference)
    for g in held:
        print(f"# held (below reference, right of reply): {g['tag']} {g['passed']}/{g['total']}", file=sys.stderr)
    if not to_post:
        raise SystemExit("nothing to post")
    for c in commands(doc, to_post, a.account, a.rpc_url, a.registry, a.feedback_agent, a.feedback_tag,
                      a.evidence_url, a.endpoint):
        print(c)


if __name__ == "__main__":
    main()
