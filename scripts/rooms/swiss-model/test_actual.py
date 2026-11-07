"""CPU-only output topology/fences; run in the existing partition runtime."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import numpy as np
from PIL import Image
from partition_actual import ACTUAL_SHA, digest, overlay, validate_probe_claim, validate_required_assets, verify
from partition import partition_rooms


class ActualTests(unittest.TestCase):
    def test_fixed_partition_and_overlay_preserve_hole(self):
        p=np.zeros((3,64,64),np.float32)
        p[0,8:56,8:56]=.99; p[0,26:38,26:38]=0
        labels, rooms, _=partition_rooms(p,"hierarchical_basins")
        self.assertEqual(len(rooms),1); self.assertEqual(len(rooms[0]["shape"]["holes"]),1)
        self.assertEqual(labels[32,32],0)
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/"overlay.png"
            overlay(Image.new("RGB",(64,64),"white"),labels,rooms,path)
            self.assertTrue(path.is_file()); self.assertTrue(path.with_name("overlay-preview.png").is_file())
            with Image.open(path) as im: self.assertEqual(im.getpixel((32,32)),(255,255,255))

    def test_late_cached_map_mutation_fails(self):
        with TemporaryDirectory() as tmp:
            p=Path(tmp)/"map.npz"; np.savez_compressed(p,probability=np.zeros((3,4,4)))
            frozen={str(p):digest(p)}; verify(frozen)
            np.savez_compressed(p,probability=np.ones((3,4,4)))
            with self.assertRaises(ValueError): verify(frozen)

    def test_original_claim_rejects_copy_and_preset_or_model_changes(self):
        with TemporaryDirectory() as tmp:
            root=Path(tmp); folder=root/"probe"
            p={"output":str(folder),"checkpoint":str(root/"trial/training/best.pt"),"checkpoint_sha256":"model",
               "actual_probe_claim":str(root/"trial/actual_probe_claim.json"),"source_bindings":{"source":"frozen"}}
            claim={"output":str(folder),"input_sha256":ACTUAL_SHA,"checkpoint_sha256":"model",
                   "source_bindings":p["source_bindings"],"fixed_presets":["plain-.4","hierarchical_basins"]}
            validate_probe_claim(p,folder,claim)
            with self.assertRaises(ValueError): validate_probe_claim(p,root/"copy",claim)
            for key,value in (("checkpoint_sha256","wrong"),("fixed_presets",["tuned"]),("source_bindings",{})):
                bad={**claim,key:value}
                with self.assertRaises(ValueError): validate_probe_claim(p,folder,bad)

    def test_emitted_overlay_drift_is_rejected(self):
        with TemporaryDirectory() as tmp:
            out=Path(tmp)/"overlay.png"; emitted={}
            overlay(Image.new("RGB",(4,4),"white"),np.zeros((4,4),np.int32),[],out,emitted)
            verify(emitted); out.write_bytes(b"replaced after emission")
            with self.assertRaises(ValueError): verify(emitted)

    def test_empty_or_missing_model_asset_bindings_fail(self):
        p=dict(input="image",checkpoint="model",checkpoint_sha256="m",head_report="heads",head_report_sha256="h",
               actual_probe_claim="claim",actual_probe_claim_sha256="c",probabilities_sha256="p",plain_sha256="r",plain_labels_sha256="l",
               asset_bindings={},emitted_bindings={})
        folder=Path("/fabricated/probe")
        with self.assertRaises(ValueError): validate_required_assets(p,folder)
        p["asset_bindings"]={"image":ACTUAL_SHA,"model":"m","heads":"h","claim":"c"}
        p["emitted_bindings"]={str(folder/"probabilities.npz"):"p",str(folder/"plain.json"):"r",str(folder/"plain-labels.i32"):"l"}
        validate_required_assets(p,folder)
        p["asset_bindings"].pop("model")
        with self.assertRaises(ValueError): validate_required_assets(p,folder)


if __name__=="__main__": unittest.main()
