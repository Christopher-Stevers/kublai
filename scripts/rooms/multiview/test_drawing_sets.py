import unittest
from xml.sax.saxutils import escape
from drawing_sets import parse


def line(text, x, y):
    return f'<line><word xMin="{x}" yMin="{y}" xMax="{x+70}" yMax="{y+12}">{escape(text)}</word></line>'


def fixture(detail_type='H-BF'):
    return ('<html><body><doc><page width="1000" height="800">'+
            line('LEVEL 01 FLOOR PLAN', 870, 650)+line('A204', 930, 780)+
            line('A503', 450, 400)+line('SUITE H-BF', 160, 240)+
            '</page><page width="1000" height="800">'+
            line('SUITE PLANS', 870, 650)+line('A263', 930, 780)+
            line(f'SUITE {detail_type} - 2 BED LAYOUT', 150, 320)+
            line(f'SUITE {detail_type} - 2 BED REFLECTED CEILING LAYOUT', 150, 700)+
            '</page></doc></body></html>').encode()


class DrawingSetTests(unittest.TestCase):
    def test_source_pages_sheet_ids_and_floor_detail_are_distinct(self):
        r = parse(fixture())
        self.assertEqual([p['sheet_id'] for p in r['pages']], ['A204', 'A263'])
        self.assertEqual(r['pages'][0]['page_index'], 0)
        self.assertEqual(r['pages'][0]['page_number'], 1)
        choices = r['links'][0]['candidate_floor_details']
        self.assertEqual(len(choices), 1)
        self.assertEqual(choices[0]['suite_type'], 'H-BF')
        self.assertEqual(choices[0]['view_kind'], 'floor')
        self.assertTrue(r['links'][0]['geometry_registration_required'])
        self.assertFalse(r['links'][0]['approved'])

    def test_barrier_free_variant_cannot_match_standard_unit(self):
        r = parse(fixture('H'))
        self.assertEqual(r['links'][0]['candidate_floor_details'], [])
        self.assertTrue(r['links'][0]['ambiguous'])

    def test_two_same_named_details_stay_ambiguous(self):
        xml = fixture().replace(b'</page></doc>', (line('SUITE H-BF - 2 BED LAYOUT', 450, 320)+'</page></doc>').encode())
        self.assertTrue(parse(xml)['links'][0]['ambiguous'])

    def test_unknown_variant_is_not_prefix_matched(self):
        self.assertEqual(parse(fixture('H-BF-NEW'))['links'][0]['candidate_floor_details'], [])

    def test_empty_document_is_not_room_evidence(self):
        r = parse(b'<doc/>')
        self.assertEqual(r['counts']['pages'], 0)
        self.assertFalse(r['room_boundaries_inferred'])


if __name__ == '__main__':
    unittest.main()
