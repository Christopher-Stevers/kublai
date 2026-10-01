import unittest
import numpy as np
from inspect_data import check_arrays,names_only


class DataQATests(unittest.TestCase):
    def test_unknown_positive_opening_is_not_removed_or_scored_as_known(self):
        t=np.zeros((3,4,5),np.uint8);k=np.ones_like(t);t[1:,1,2]=1;k[:,1,2]=0
        result=check_arrays(t,k,(4,5))
        self.assertEqual(result['unknown_positive_openings'],1);self.assertEqual(result['unknown'],[1,1,1])

    def test_dimensions_binary_subset_and_known_interior_overlap_rejected(self):
        t=np.zeros((3,4,5),np.uint8);k=np.ones_like(t)
        for change in ('binary','subset','overlap'):
            c=t.copy()
            if change=='binary':c[0,0,0]=2
            elif change=='subset':c[2,0,0]=1
            else:c[:2,0,0]=1
            with self.assertRaises(ValueError):check_arrays(c,k,(4,5))

    def test_truth_member_rejected_before_any_array_access(self):
        names_only(['target','known'])
        with self.assertRaises(ValueError):names_only(['target','known','truth'])


if __name__=='__main__':unittest.main()
