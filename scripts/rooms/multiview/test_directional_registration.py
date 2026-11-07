import time
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image, ImageDraw
from directional_registration import SETTINGS, extract, register, apply


def template(symmetric=False):
    im = Image.new('RGB', (480, 400), 'white')
    d = ImageDraw.Draw(im)
    if symmetric:
        for x in (35, 95, 150, 220, 259, 329, 384, 444):
            d.line((x, 30, x, 369), fill='black', width=3)
        for y in (30, 80, 125, 170, 229, 274, 319, 369):
            d.line((35, y, 444, y), fill='black', width=3)
    else:
        for x, top, bottom in [(30,20,379),(90,20,265),(147,48,379),(208,20,326),
                                (272,78,379),(331,20,278),(397,46,379),(449,20,379)]:
            d.line((x,top,x,bottom), fill=(175,175,175), width=3)
        for y, left, right in [(20,30,449),(69,90,397),(120,30,331),(170,147,449),
                                (218,30,397),(267,90,449),(321,30,331),(379,30,449)]:
            d.line((left,y,right,y), fill='black', width=3)
    return np.asarray(im)


def paired(rotation=0, reflected=False, symmetric=False):
    raw = template(symmetric)
    scaled = np.asarray(Image.fromarray(raw).resize((192,160), Image.Resampling.BICUBIC))
    p = np.rot90(np.fliplr(scaled) if reflected else scaled, rotation)
    target = np.full((240,280,3),255,np.uint8)
    x,y=43,31
    target[y:y+p.shape[0],x:x+p.shape[1]]=p
    return raw,target,[x+p.shape[1]/2,y+p.shape[0]/2]


class DirectionalTests(unittest.TestCase):
    def test_exact_known_scale_translation_has_independent_support(self):
        raw,target,anchor=paired()
        r,surfaces=register(raw,target,anchor)
        self.assertEqual(r['status'],'supported',r['reason'])
        p=next(q for q in r['peaks'] if q['id']==r['chosen_peak_id'])
        self.assertEqual(p['translation_pixels'],[43,31])
        self.assertEqual(p['orientation'],'r0-mirror0')
        self.assertTrue(p['requires_review'])
        self.assertFalse(r['approved_for_production'])
        self.assertEqual(len(surfaces),8)
        self.assertTrue(all(n>=3 for a in r['source_counts'].values() for n in a.values()))
        mapped=apply(p['matrix_crop_to_roi'],[[0,0],[479,399]])
        self.assertTrue(np.allclose(mapped,[[42.7,30.7],[234.3,190.3]]))

    def test_rotation_reflection_are_fixed_and_invertible(self):
        raw,target,anchor=paired(1,True)
        r,_=register(raw,target,anchor)
        self.assertEqual(r['status'],'supported',r['reason'])
        p=next(q for q in r['peaks'] if q['id']==r['chosen_peak_id'])
        self.assertEqual(p['orientation'],'r90-mirror1')
        m=np.asarray(p['matrix_crop_to_roi'])
        probe=np.array([[20.,30.],[300.,250.]])
        self.assertTrue(np.allclose(apply(np.linalg.inv(m),apply(m,probe)),probe))
        self.assertTrue(np.allclose(m[:2,:2].T@m[:2,:2],np.eye(2)*.16))

    def test_repeated_symmetric_structure_abstains(self):
        r,_=register(*paired(symmetric=True))
        self.assertEqual(r['status'],'unresolved')
        self.assertEqual(r['reason'],'ambiguous-competing-transforms')
        self.assertGreater(len(r['supported_peak_ids']),1)

    def test_wrong_regular_grid_is_not_a_suite(self):
        raw,target,anchor=paired()
        target[:]=255
        for x in range(9,280,24): target[:,x:x+2]=0
        for y in range(11,240,23): target[y:y+2,:]=0
        r,_=register(raw,target,anchor)
        self.assertEqual(r['status'],'unresolved')
        self.assertEqual(r['supported_peak_ids'],[])

    def test_forward_match_cannot_ignore_dense_clutter(self):
        raw,target,anchor=paired()
        for x in range(49,230,13): target[31:191,x]=0
        for y in range(37,184,11): target[y,43:235]=0
        r,_=register(raw,target,anchor)
        self.assertEqual(r['status'],'unresolved')
        self.assertTrue(any('reverse-axis-support-or-clutter' in p['rejection_reasons'] or
                            'contradictory-long-axis-run' in p['rejection_reasons'] for p in r['peaks']))

    def test_fit_only_ink_fails_withheld_evidence(self):
        raw,_,anchor=paired()
        scaled=np.asarray(Image.fromarray(raw).resize((192,160),Image.Resampling.BICUBIC))
        _,masks=extract(scaled)
        fit=masks['fit']['h']|masks['fit']['v']
        target=np.full((240,280,3),255,np.uint8)
        target[31:191,43:235][fit]=0
        r,_=register(raw,target,anchor)
        self.assertEqual(r['status'],'unresolved')
        self.assertTrue(any('withheld-axis-segment-support' in p['rejection_reasons'] for p in r['peaks']))

    def test_anchor_does_not_become_a_room_seed(self):
        raw,target,_=paired()
        r,_=register(raw,target,[2.,2.])
        self.assertEqual(r['status'],'unresolved')
        self.assertTrue(any('indexed-anchor-outside-template-frame' in p['rejection_reasons'] for p in r['peaks']))

    def test_fit_check_groups_are_disjoint_native_runs(self):
        raw=template()
        scaled=np.asarray(Image.fromarray(raw).resize((192,160),Image.Resampling.BICUBIC))
        segments,masks=extract(scaled)
        self.assertEqual(len({s['id'] for s in segments}),len(segments))
        for axis in ('h','v'):
            self.assertFalse((masks['fit'][axis]&masks['check'][axis]).any())

    def test_overwide_band_is_wholly_ineligible_not_chunked(self):
        rgb=np.full((60,80,3),255,np.uint8)
        rgb[10:35,5:75]=0
        segments,masks=extract(rgb)
        self.assertEqual(segments,[])
        self.assertFalse(any(a.any() for group in masks.values() for a in group.values()))

    def test_rounding_cannot_export_inexact_or_nonuniform_scale(self):
        raw=np.full((401,481,3),255,np.uint8)
        with self.assertRaisesRegex(ValueError,'exact .4 isotropic'):
            register(raw,np.full((240,280,3),255,np.uint8),[100,100])

    def test_blank_and_colored_geometry_remain_unknown(self):
        white=np.full((160,160,3),255,np.uint8)
        r,_=register(white,np.full((220,220,3),255,np.uint8),[100,100])
        self.assertEqual(r['reason'],'insufficient-disjoint-axis-evidence')
        red=template(); red=np.array(red,copy=True)
        ink=red.min(axis=2)<240; red[ink]=[150,0,0]
        r,_=register(red,np.full((240,280,3),255,np.uint8),[100,100])
        self.assertEqual(r['reason'],'insufficient-disjoint-axis-evidence')

    def test_shape_dtype_anchor_and_deadline_fail_closed(self):
        raw,target,anchor=paired()
        for bad in (raw.astype(float),raw[...,0],raw[:12]):
            with self.assertRaises(ValueError): register(bad,target,anchor)
        with self.assertRaises(ValueError): register(raw,target,[float('nan'),2])
        with self.assertRaises(RuntimeError): register(raw,target,anchor,deadline=time.monotonic()-1)

    def test_resource_overflow_has_no_segment_truncation(self):
        with patch.dict(SETTINGS,maximum_segments=2):
            with self.assertRaisesRegex(RuntimeError,'no evidence truncation'):
                extract(template())


if __name__=='__main__': unittest.main()
