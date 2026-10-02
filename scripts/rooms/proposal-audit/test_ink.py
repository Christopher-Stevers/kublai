import unittest
import tempfile
import json
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image, ImageDraw
from ink import profile
import audit


class SourceInk(unittest.TestCase):
    def image(self):
        image = Image.new("RGB", (100, 100), "white")
        ImageDraw.Draw(image).rectangle((10, 10, 90, 90), outline="black", width=2)
        return image

    def row(self, image, level=224, channels="achromatic", points=None, holes=()):
        evidence = profile(np.asarray(image), points or [(10, 10), (90, 10), (90, 90), (10, 90)], holes)
        return next(x for x in evidence["profiles"] if x["luminance_le"] == level and x["channels"] == channels)

    def test_faint_internal_separator_kept_as_profile_not_binary_wall_claim(self):
        image = self.image()
        ImageDraw.Draw(image).line((50, 10, 50, 90), fill=(200, 200, 200), width=2)
        self.assertEqual(self.row(image, 128)["longest_vertical_px"], 0)
        self.assertGreater(self.row(image, 224)["vertical_bbox_fraction"], .9)
        self.assertEqual(self.row(image, 224)["boundary_near_ink_fraction"], 1.)

    def test_small_furniture_is_short_but_grid_can_mimic_separator(self):
        furniture, grid = self.image(), self.image()
        ImageDraw.Draw(furniture).rectangle((40, 40, 60, 60), outline="black")
        draw = ImageDraw.Draw(grid)
        for x in (30, 50, 70):
            draw.line((x, 10, x, 90), fill="black")
        self.assertLess(self.row(furniture)["vertical_bbox_fraction"], .3)
        self.assertGreater(self.row(grid)["vertical_bbox_fraction"], .9)
        # Deliberate semantic counterexample: a ceiling grid cannot be declared a wall.
        result = profile(np.asarray(grid), [(10, 10), (90, 10), (90, 90), (10, 90)])
        self.assertFalse(result["wall_crossing_certified"])
        self.assertIsNone(result["correctness_probability"])

    def test_long_hall_boundary_does_not_count_as_internal_stroke(self):
        image = Image.new("RGB", (200, 50), "white")
        ImageDraw.Draw(image).rectangle((5, 10, 195, 40), outline="black", width=2)
        row = self.row(image, points=[(5, 10), (195, 10), (195, 40), (5, 40)])
        self.assertEqual(row["longest_horizontal_px"], 0)
        self.assertEqual(row["longest_vertical_px"], 0)
        self.assertEqual(row["boundary_near_ink_fraction"], 1.)

    def test_colored_cloud_is_preserved_separately_and_not_gray_wall_evidence(self):
        image = self.image()
        ImageDraw.Draw(image).line((50, 10, 50, 90), fill=(220, 0, 0), width=2)
        self.assertGreater(self.row(image, channels="all")["longest_vertical_px"], 60)
        self.assertEqual(self.row(image)["longest_vertical_px"], 0)

    def test_holes_exclude_internal_ink_and_no_silent_crop_or_invalid_repair(self):
        image = self.image()
        ImageDraw.Draw(image).line((50, 30, 50, 70), fill="black")
        row = self.row(image, holes=[[(40, 20), (60, 20), (60, 80), (40, 80)]])
        self.assertEqual(row["longest_vertical_px"], 0)
        for points in ([(-3, 0), (90, 0), (90, 90)], [(10, 10), (90, 90), (10, 90), (90, 10)]):
            with self.assertRaises(ValueError):
                profile(np.asarray(image), points)

    def test_bounded_runner_joins_raw_pixels_and_counts_invalid_and_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            trial = Path(tmp) / "trial"
            trial.mkdir()
            source = trial / "raw.png"
            self.image().save(source)
            raw_sha = audit.digest(source)
            self.image().save(trial / "case-source.png")
            case = {"id": "case", "pixel_box": [0, 0, 100, 100], "predictions": [
                {"id": 1, "kind": "polygon", "valid_polygon": True, "outside_crop": False,
                 "label": "unverified", "full_page_normalized_points": [[.1,.1],[.9,.1],[.9,.9],[.1,.9]]},
                {"kind": "line"}, {"kind": "polygon", "valid_polygon": False},
                {"kind": "polygon", "valid_polygon": True, "outside_crop": True}]}
            (trial / "case.json").write_text(json.dumps(case))
            plan = {"output": str(trial), "source_sha256": raw_sha, "source": str(source), "pdf_sha256": audit.PDF,
                    "page_one_based": 18, "page_index": 17, "approved_for_production": False, "all_space_scoring_eligible": False}
            (trial / "plan.json").write_text(json.dumps(plan))
            report = {"status": "completed-qualitative-only", "plan_sha256": audit.digest(trial / "plan.json"),
                      "cases": [{"id": "case", "pixel_box": [0,0,100,100]}],
                      "emitted": {name: audit.digest(trial / name) for name in ("case.json", "case-source.png")}}
            (trial / "report.json").write_text(json.dumps(report))
            with patch.object(audit, "REPORTS", {audit.digest(trial / "report.json")}), patch.object(audit, "SOURCE", raw_sha), patch.object(audit, "PAGE_SIZE", (100,100)):
                result = audit.run(trial, Path(tmp) / "new-parent/out")
            self.assertEqual(result["views"][0]["counts"], {"audited": 1, "invalid": 1, "lines": 1, "outside_crop": 1})
            self.assertEqual(result["review_priority"][0]["proposal_ids"], [1])
            self.assertEqual(result["proposals"][0]["crop_pixel_points"][0], (10.,10.))
            self.assertFalse(result["accuracy_measured"])


if __name__ == "__main__":
    unittest.main()
