import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("liquid_trial", Path(__file__).with_name("packing-slip-liquid.py"))
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)


class LiquidEvidenceTests(unittest.TestCase):
    def test_unknown_shipped_is_not_filled_from_ordered(self):
        row = trial.normalize_line({"description":"Elbow", "ordered":20,
            "quantity_confidence":.99, "part_confidence":.8}, 2, 1)
        self.assertIsNone(row["shipped"])
        self.assertIsNone(row["unit"])
        self.assertEqual(row["confidence"]["quantity"]["value"], 0)
        self.assertEqual(row["confidence"]["match"]["value"], 0)

    def test_returns_and_written_corrections_are_separate(self):
        row = trial.normalize_line({"description":"Pipe", "shipped":-12,
            "handwritten_quantity":-6, "unit":"FT", "quantity_confidence":.8}, 1, 2)
        self.assertEqual(row["shipped"], -12)
        self.assertEqual(row["handwrittenQuantity"], -6)
        self.assertTrue(any("Handwritten" in i for i in row["issues"]))

    def test_invalid_geometry_and_confidence_are_not_invented(self):
        row = trial.normalize_line({"description":"Valve", "shipped":True,
            "part_confidence":99, "quantity_confidence":float("nan"), "box":[0,0,1,3]},1,1)
        self.assertIsNone(row["box"])
        self.assertIsNone(row["shipped"])
        self.assertEqual(row["confidence"]["part"]["value"],0)

    def test_partial_json_is_never_silently_repaired(self):
        with self.assertRaises(ValueError):
            trial.parse_response('{"lines":[{"description":"Pipe"}')
        self.assertEqual(trial.parse_response('<think>internal</think>{"lines":[]}'),{"lines":[]})

    def test_retrieval_scores_all_orders_and_uses_own_sku(self):
        orders = [{"id":str(i),"orderNumber":f"{i}-Next","supplier":"Next","items":[
            {"description":"Pipe", "sku":None,"aliases":[f"PIPE{i}"]}]} for i in range(20)]
        ranking,selected=trial.shortlist(orders,[{"description":"Pipe","sku":"PIPE19"}],[],8)
        self.assertEqual(len(ranking),20)
        self.assertEqual(selected[0],19)
        self.assertEqual(len(selected),8)

    def test_invalid_mapping_cannot_attach_to_another_item_or_drop_valid_lines(self):
        lines=[trial.normalize_line({"description":"Valve","shipped":3},1,i) for i in range(1,4)]
        order={"items":[{"id":"valid","description":"Valve"}]}
        trial.apply_matches(lines,[{"line":"p1-l1","item":0},{"line":"p1-l1","item":0},
            {"line":"p1-l2","item":99},{"line":"p1-l3","item":0,"confidence":.95}],order,{"value":.7})
        self.assertIsNone(lines[0]["orderItemId"])
        self.assertIsNone(lines[1]["orderItemId"])
        self.assertEqual(lines[2]["orderItemId"],"valid")
        self.assertEqual(lines[2]["confidence"]["match"]["value"],.7)


if __name__ == "__main__":
    unittest.main()
