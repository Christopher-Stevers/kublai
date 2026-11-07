import unittest
import numpy as np
from scale_domain import barrier_diameters, opening_spans, quantiles, region_scales, selected_records


class ScaleTests(unittest.TestCase):
    def test_fixed_selection_before_asset_access(self):
        rows=[dict(id=str(n),split='validation',source='synthetic-msd',image='/never-open') for n in range(20)]
        data={'records':rows+[dict(id='protected',split='holdout',image='/never-open')]}
        self.assertEqual(len(selected_records(data,'context_development',[str(n) for n in range(20)])),20)
        with self.assertRaises(ValueError):selected_records(data,'context_development',['wrong'])
        rows[0]['source']='holdout'
        with self.assertRaises(ValueError):selected_records(data,'context_development',[str(n) for n in range(20)])

    def test_opening_spans_and_components_not_entity_count(self):
        mask=np.zeros((32,32),bool);mask[5:9,5:21]=1;mask[25,25]=1
        major,minor,area=opening_spans(mask)
        np.testing.assert_allclose(major,[16,1]);np.testing.assert_allclose(minor,[4,1]);np.testing.assert_array_equal(area,[64,1])

    def test_barrier_diameter_is_proxy_and_empty_quantiles(self):
        mask=np.zeros((32,32),bool);mask[5:25,8:12]=1
        q=quantiles(barrier_diameters(mask));self.assertEqual(q['p50'],4)
        self.assertEqual(quantiles([])['n'],0)

    def test_region_bbox_and_area_keep_holes(self):
        labels=np.zeros((8,8),np.int32);labels[1:7,2:6]=1;labels[3:5,3:5]=0
        a,s,l=region_scales(labels)
        np.testing.assert_array_equal(a,[20]);np.testing.assert_array_equal(s,[4]);np.testing.assert_array_equal(l,[6])


if __name__=='__main__':unittest.main()
