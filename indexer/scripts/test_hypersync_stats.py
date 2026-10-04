import unittest
from hypersync_stats import summarize


class Summarize(unittest.TestCase):
    def test_counts_receipts_from_data_and_prices_gas(self):
        tx = "0xaa"
        logs = [{"topic1": hex(1962), "transaction_hash": tx, "data": "0x" + format(64, "064x") + "00" * 32}]
        txs = {tx: {"gas_used": hex(73_000), "effective_gas_price": hex(100 * 10**9)}}
        h = summarize(logs, txs)[1962]
        self.assertEqual((h["batches"], h["receipts"], h["gas"]), (1, 64, 73_000))
        self.assertEqual(h["wei"], 73_000 * 100 * 10**9)


if __name__ == "__main__":
    unittest.main()
