import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("owned-process-supervisor.py")

def wait_record(file):
    end = time.monotonic() + 3
    while time.monotonic() < end:
        if file.exists():
            return json.loads(file.read_text())
        time.sleep(.02)
    raise AssertionError("No process record")

class SupervisorTests(unittest.TestCase):
    def launch(self, seconds, code, folder):
        record = Path(folder)/"processes.json"
        process = subprocess.Popen([sys.executable,str(SCRIPT),"run","--seconds",str(seconds),"--record",str(record),"--",sys.executable,"-c",code],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        return process,record

    def assert_clean(self, record):
        data=json.loads(record.read_text())
        self.assertTrue(data["familyAbsent"])
        self.assertTrue(data["ownedIdentitiesAbsent"])
        for item in data["processes"]:
            stat=Path(f"/proc/{item['pid']}/stat")
            if stat.exists():
                self.assertNotEqual(stat.read_text().rsplit(")",1)[1].split()[19],item["startTime"])

    def test_success_and_original_failure(self):
        for code in (0,7):
            with tempfile.TemporaryDirectory() as folder:
                p,record=self.launch(3,f"raise SystemExit({code})",folder)
                p.communicate(timeout=7)
                self.assertEqual(p.returncode,code)
                self.assert_clean(record)

    def test_timeout_kills_term_ignoring_detached_child_and_reaps(self):
        code="import subprocess,sys,time,signal;subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(20)'],start_new_session=True);time.sleep(20)"
        with tempfile.TemporaryDirectory() as folder:
            p,record=self.launch(.4,code,folder)
            p.communicate(timeout=8)
            self.assertEqual(p.returncode,124)
            self.assert_clean(record)
            data=json.loads(record.read_text())
            self.assertGreaterEqual(len(data["processes"]),2)
            self.assertTrue(any(row["signal"]==signal.SIGKILL for row in data["groupActions"]))

    def test_record_write_failure_after_spawn_still_stops_and_reaps(self):
        with tempfile.TemporaryDirectory() as folder:
            record_dir=Path(folder)/"record";record_dir.mkdir()
            record=record_dir/"processes.json";pids=Path(folder)/"pids.json"
            code=("import subprocess,sys,time,os,json;from pathlib import Path;"
                  "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(20)'],start_new_session=True);"
                  f"Path({str(pids)!r}).write_text(json.dumps([os.getpid(),child.pid]));"
                  f"record=Path({str(record)!r});"
                  "time.sleep(.15);record.unlink();record.parent.rmdir();time.sleep(20)")
            process=subprocess.run([sys.executable,str(SCRIPT),"run","--seconds","10","--record",str(record),"--",sys.executable,"-c",code],capture_output=True,timeout=8)
            self.assertEqual(process.returncode,1)
            self.assertIn(b"FileNotFoundError",process.stderr)
            for pid in json.loads(pids.read_text()):
                self.assertFalse(Path(f"/proc/{pid}").exists())

    def test_external_stop_is_bounded_and_proves_owned_groups_absent(self):
        with tempfile.TemporaryDirectory() as folder:
            p,record=self.launch(20,"import time;time.sleep(20)",folder)
            wait_record(record)
            stopped=subprocess.run([sys.executable,str(SCRIPT),"stop","--record",str(record)],capture_output=True,timeout=12)
            p.communicate(timeout=3)
            self.assertEqual(stopped.returncode,0)
            self.assertEqual(p.returncode,143)
            self.assert_clean(record)
            self.assertTrue(json.loads(record.read_text())["externalStop"]["supervisorAbsent"])

if __name__ == "__main__":
    unittest.main()
