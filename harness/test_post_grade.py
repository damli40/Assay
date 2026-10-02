import os
import shlex
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post_grade as pg  # noqa: E402

H = "0x" + "11" * 32


def grade(tag, passed, total, lo, hi):
    return {"tag": tag, "hostKeyPreimage": "openrouter:" + tag, "model": H, "hostKey": "0x" + "22" * 32,
            "checks": H, "passed": passed, "total": total, "ciLowBps": lo, "ciHighBps": hi,
            "refModel": H, "evidence": "0x" + "33" * 32, "t": 1790900000}


DOC = {"modelId": "google/gemma-4-31b-it:free", "reference": "ref",
       "grades": [grade("ref", 38, 40, 8350, 9860), grade("good", 36, 40, 7700, 9600),
                  grade("bad", 20, 40, 3500, 6500)]}


class Plan(unittest.TestCase):
    def test_holds_hosts_below_the_reference(self):
        post, held = pg.plan(DOC)
        self.assertEqual([g["tag"] for g in post], ["ref", "good"])
        self.assertEqual([g["tag"] for g in held], ["bad"])

    def test_include_below_reference_posts_everything(self):
        post, held = pg.plan(DOC, include_below=True)
        self.assertEqual(len(post), 3)
        self.assertEqual(held, [])

    def test_only_filters_by_tag(self):
        post, _ = pg.plan(DOC, only=["good"])
        self.assertEqual([g["tag"] for g in post], ["good"])

    def test_no_reference_row_holds_nothing(self):
        post, held = pg.plan({**DOC, "reference": "missing"})
        self.assertEqual((len(post), held), (3, []))


class Commands(unittest.TestCase):
    def test_tuple_follows_the_contract_field_order(self):
        self.assertEqual(pg.grade_tuple(DOC["grades"][0]),
                         f"({H},0x{'22'*32},{H},38,40,8350,9860,{H},0x{'33'*32},1790900000)")

    def test_commands_use_the_keystore_never_a_key(self):
        out = pg.commands(DOC, DOC["grades"][:1], "assay-verifier", "monad_testnet")
        self.assertEqual(len(out), 1)
        self.assertIn("--account assay-verifier", out[0])
        self.assertNotIn("--private-key", out[0])

    def test_feedback_value_is_the_pass_rate_in_bps(self):
        out = pg.commands(DOC, DOC["grades"][:2], "v", "rpc", feedback_agent=1962, feedback_tag="good",
                          evidence_url="https://e/x.tar.gz", endpoint="https://host")
        fb = shlex.split(out[-1])
        self.assertEqual(fb[4:13], ["1962", "9000", "2", "assay-grade", "google/gemma-4-31b-it:free",
                                    "https://host", "https://e/x.tar.gz", "0x" + "33" * 32, "--account"])

    def test_feedback_tag_must_be_posted(self):
        with self.assertRaises(SystemExit):
            pg.commands(DOC, DOC["grades"][:1], "v", "rpc", feedback_agent=1962, feedback_tag="bad")

    @unittest.skipUnless(shutil.which("cast"), "cast not installed")
    def test_printed_arguments_encode_as_valid_calldata(self):
        for c in pg.commands(DOC, DOC["grades"], "v", "rpc", feedback_agent=1962, feedback_tag="good"):
            args = shlex.split(c)[3:]
            args = args[:args.index("--account")]
            r = subprocess.run(["cast", "calldata", *args], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue(r.stdout.startswith("0x"))


if __name__ == "__main__":
    unittest.main()
