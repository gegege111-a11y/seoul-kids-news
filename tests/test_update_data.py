import sys
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from update_data import grade_match, normalize, build_feed, topic_for, parse_datetime

NOW = datetime(2026, 10, 9, 10, tzinfo=ZoneInfo('Asia/Seoul'))
BASE = {
    'SVCID':'S260901123456789123', 'MAXCLASSNM':'문화체험', 'MINCLASSNM':'교육체험',
    'SVCNM':'초등 과학 만들기', 'USETGTINFO':'초등 4~6학년', 'SVCSTATNM':'접수중',
    'PLACENM':'과학관', 'PAYATNM':'무료', 'AREANM':'송파구',
    'RCPTBGNDT':'2026-10-01 09:00:00','RCPTENDDT':'2026-10-20 18:00:00',
    'SVCOPNBGNDT':'2026-10-23 10:00:00','SVCOPNENDDT':'2026-10-23 12:00:00',
}

class GradeTests(unittest.TestCase):
    def test_confirmation(self):
        self.assertEqual(grade_match('과학', '초등학교 1~6학년'), 'confirmed')
        self.assertEqual(grade_match('만들기', '초등 고학년 이상 누구나'), 'confirmed')
        self.assertEqual(grade_match('역사', '초등학교 5학년'), 'confirmed')
    def test_low_only_excluded(self):
        self.assertIsNone(grade_match('초등 저학년 숲학교', '초등 1~3학년'))
        self.assertIsNone(grade_match('어린이 만들기', '미취학 아동'))
        self.assertIsNone(grade_match('인생 강연', '성인'))
    def test_candidate(self):
        self.assertEqual(grade_match('초등 가족 미술', '초등학생'), 'candidate')
    def test_normalize(self):
        item = normalize(BASE,NOW)
        self.assertIsNotNone(item)
        self.assertEqual(item['area'],'송파구')
        self.assertEqual(item['topic'],'과학·기술')
        self.assertIn('S260901123456789123', item['url'])
    def test_expired_not_visible(self):
        row = dict(BASE,RCPTENDDT='2026-10-08 18:00:00')
        self.assertIsNone(normalize(row,NOW))
    def test_closed_not_visible(self):
        row = dict(BASE,SVCSTATNM='예약마감')
        self.assertIsNone(normalize(row,NOW))
    def test_first_sync_no_all_new(self):
        first = build_feed([BASE],{'mode':'preview','items':[]},NOW,1)
        self.assertEqual(first['newIds'], [])
        second = build_feed([BASE],first,NOW,1)
        self.assertEqual(second['newIds'], [])
        more = dict(BASE,SVCID='S260901123456789124')
        third = build_feed([BASE,more],second,NOW,2)
        self.assertEqual(third['newIds'], ['S260901123456789124'])
    def test_dates(self):
        self.assertEqual(parse_datetime('2026-10-09 10:00:00').year,2026)
        self.assertEqual(parse_datetime('20261009100000').hour,10)

if __name__ == '__main__':
    unittest.main()
