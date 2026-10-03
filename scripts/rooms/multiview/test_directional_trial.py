import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from directional_trial import CROP, ROIS, INPUTS, PDF_SHA, metadata, read_checked, write, runtime, validate_report, display_peak


def fixture():
    targets=[{'suite_type':'K','page_number':18,'page_index':17,
              'anchor_box_normalized':[.2+i*.1,.13,.21+i*.1,.14]} for i in range(4)]
    old={'source_crop_pixels':CROP,'printed_scale_ratio':.4,'targets':targets}
    complete={'results':[{'instance':t,'roi':r} for t,r in zip(targets,ROIS)]}
    receipts=[{'pdfPageNumber':page,'sourcePdfSha256':PDF_SHA,'pngSha256':INPUTS[role][1]}
              for role,page in [('floor',18),('detail',25)]]
    return old,complete,*receipts


class TrialTests(unittest.TestCase):
    def test_exact_four_metadata_rois_and_original_pages(self):
        targets=metadata(*fixture())
        self.assertEqual([t['roi'] for t in targets],ROIS)
        self.assertEqual([t['ordinal'] for t in targets],list(range(4)))

    def test_altered_roi_scale_crop_page_or_identity_rejected(self):
        for field,value in [('source_crop_pixels',[0,0,895,1140]),('printed_scale_ratio',.41)]:
            a=list(fixture()); a[0]=copy.deepcopy(a[0]); a[0][field]=value
            with self.assertRaises(ValueError): metadata(*a)
        a=list(fixture());a[1]=copy.deepcopy(a[1]);a[1]['results'][0]['roi']=[0,0,100,100]
        with self.assertRaises(ValueError): metadata(*a)
        a=list(fixture());a[3]={**a[3],'pdfPageNumber':24}
        with self.assertRaises(ValueError): metadata(*a)
        a=list(fixture());a[0]=copy.deepcopy(a[0]);a[0]['targets'][0]['suite_type']='H'
        with self.assertRaises(ValueError): metadata(*a)

    def test_checked_json_rejects_late_decode_mutation(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'control.json'; expected=write(p,{'v':1})
            original=json.loads
            def mutate(raw):
                p.write_text('{"v":2}')
                return original(raw)
            with patch('directional_trial.json.loads',side_effect=mutate):
                with self.assertRaisesRegex(ValueError,'decode byte drift'): read_checked(p,expected)

    def test_emission_is_exclusive_and_bound_to_written_bytes(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'control.json'; expected=write(p,{'finite':True})
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),expected)
            with self.assertRaises(FileExistsError): write(p,{'finite':False})
            with self.assertRaises(ValueError): write(Path(td)/'bad.json',{'nan':float('nan')})

    def test_completed_report_requires_exact_four_targets_and_attempt(self):
        targets=metadata(*fixture())
        report={'plan_sha256':'plan','claim_sha256':'claim','runtime':runtime(),
                'all_four_target_ids':list(range(4)),'results':targets,
                'room_accuracy_measured':False,'approved_for_production':False}
        validate_report(report,'plan','claim')
        for key,value in [('plan_sha256','other'),('claim_sha256','other'),
                          ('all_four_target_ids',[0,1,2,2]),('approved_for_production',True),
                          ('results',targets[:-1])]:
            with self.assertRaises(ValueError):validate_report({**report,key:value},'plan','claim')

    def test_overlay_draws_chosen_peak_not_rejected_lower_fit(self):
        a={'id':'A','fit_mean':.1,'indexed_anchor_inside':False,'geometrically_supported':False}
        b={'id':'B','fit_mean':.4,'indexed_anchor_inside':True,'geometrically_supported':True}
        r={'status':'supported','chosen_peak_id':'B','peaks':[a,b]}
        self.assertEqual(display_peak(r),b)
        self.assertEqual(display_peak({**r,'status':'unresolved','chosen_peak_id':None}),a)
        with self.assertRaises(ValueError):display_peak({**r,'chosen_peak_id':'missing'})


if __name__=='__main__':unittest.main()
