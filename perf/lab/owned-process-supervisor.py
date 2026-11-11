#!/usr/bin/env python3
"""Disposable diagnostic process ownership; never targets an unrecorded PID/group."""
import argparse
import ctypes
import json
import os
import secrets
import signal
import subprocess
import sys
import time
from pathlib import Path

MARKER = "PERF_DIAGNOSTIC_PROCESS_TOKEN"

def identity(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return {"pid": int(pid), "state": fields[0], "ppid": int(fields[1]),
                "pgid": int(fields[2]), "startTime": fields[19]}
    except (OSError, ValueError, IndexError):
        return None

def alive(item):
    now = identity(item["pid"])
    return bool(now and now["startTime"] == item["startTime"] and now["state"] != "Z")

def discover(token, known):
    found, all_processes = {}, {}
    marker = f"{MARKER}={token}".encode()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        current = identity(entry.name)
        if not current or current["state"] == "Z":
            continue
        all_processes[entry.name] = current
        inherited = False
        try:
            inherited = marker in (entry / "environ").read_bytes().split(b"\0")
        except OSError:
            pass
        prior = known.get(entry.name)
        if inherited or (prior and prior["startTime"] == current["startTime"]):
            found[entry.name] = current
    # Nested supervisors deliberately create new ownership tokens. Include their
    # descendants while parent identity is known, retaining start times later.
    changed = True
    while changed:
        changed = False
        for pid, current in all_processes.items():
            if pid not in found and str(current["ppid"]) in found:
                found[pid] = current
                changed = True
    return found

def reap_adopted():
    while True:
        try:
            pid, _status = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                break
        except ChildProcessError:
            break

def save(file, record):
    temporary = file.with_suffix(file.suffix + ".tmp")
    temporary.write_text(json.dumps(record, indent=2) + "\n")
    temporary.replace(file)

def send_groups(processes, sig):
    # A group is signalled only while a currently owned member still proves it.
    for pgid in {item["pgid"] for item in processes.values() if alive(item)}:
        if pgid == os.getpgrp():
            raise RuntimeError("Refusing supervisor's own process group")
        try:
            os.killpg(pgid, sig)
        except ProcessLookupError:
            pass

def terminate_family(record, term_seconds=2.0, kill_seconds=2.0):
    known = {str(item["pid"]): item for item in record.get("processes", [])}
    actions = []
    for sig, duration in [(signal.SIGTERM, term_seconds), (signal.SIGKILL, kill_seconds)]:
        end = time.monotonic() + duration
        while True:
            current = discover(record["token"], known)
            known.update(current)
            if not current:
                break
            send_groups(current, sig)
            actions.append({"signal": int(sig), "groups": sorted({p["pgid"] for p in current.values()})})
            if time.monotonic() >= end:
                break
            time.sleep(0.05)
    remaining = discover(record["token"], known)
    record["processes"] = sorted(known.values(), key=lambda p: p["pid"])
    record["remaining"] = list(remaining.values())
    record["groupActions"] = actions
    record["familyAbsent"] = not remaining
    return not remaining

def run(args):
    file = Path(args.record)
    if file.exists():
        raise RuntimeError("Refusing to overwrite process record")
    file.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_hex(24)
    env = os.environ.copy()
    env[MARKER] = token
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        raise RuntimeError("Command required")
    # Adopt/reap detached orphan children instead of leaving zombies to PID1.
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError("Cannot enable this supervisor's child subreaper")
    child = subprocess.Popen(command, env=env, start_new_session=True)
    try:
        record = {"version": 1, "token": token, "supervisor": identity(os.getpid()),
                  "root": identity(child.pid), "processes": [], "status": "running"}
        if args.pid_file:
            Path(args.pid_file).write_text(str(child.pid) + "\n")
        known = {str(child.pid): record["root"]} if record["root"] else {}
        requested = {"signal": None}
        def request(sig, _frame):
            requested["signal"] = sig
        signal.signal(signal.SIGTERM, request)
        signal.signal(signal.SIGINT, request)
        started = time.monotonic()
        timed_out = False
        while child.poll() is None and requested["signal"] is None:
            known.update(discover(token, known))
            record["processes"] = list(known.values())
            save(file, record)
            if time.monotonic() - started >= args.seconds:
                timed_out = True
                break
            time.sleep(0.1)
        record["processes"] = list(known.values())
        absent = terminate_family(record)
        try:
            child.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            absent = False
        code = child.returncode
        reap_adopted()
        identities_absent = all(not identity(item["pid"]) or identity(item["pid"])["startTime"] != item["startTime"] for item in record["processes"])
        absent = absent and identities_absent
        record["ownedIdentitiesAbsent"] = identities_absent
        record.update(status="stopped", rootExitCode=code, timedOut=timed_out,
                      requestedSignal=requested["signal"], familyAbsent=absent)
        save(file, record)
        if not absent:
            return 1
        if timed_out:
            return 124
        if requested["signal"] is not None:
            return 128 + requested["signal"]
        return code if code is not None and code >= 0 else 128 - (code or 0)
    except BaseException:
        # Spawning succeeded: even failed discovery/record writes must not orphan it.
        failure_record = locals().get("record", {"token": token, "processes": []})
        failure_record["processes"] = list(locals().get("known", {}).values())
        terminate_family(failure_record)
        try:
            child.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            pass
        reap_adopted()
        failure_record["status"] = "supervisor-failed"
        try:
            save(file, failure_record)
        except OSError:
            pass
        raise


def stop(args):
    file = Path(args.record)
    if not file.exists():
        return 0
    record = json.loads(file.read_text())
    supervisor = record["supervisor"]
    if alive(supervisor):
        os.kill(supervisor["pid"], signal.SIGTERM)
    end = time.monotonic() + 6
    while alive(supervisor) and time.monotonic() < end:
        time.sleep(0.05)
    if alive(supervisor):
        os.kill(supervisor["pid"], signal.SIGKILL)
    record = json.loads(file.read_text())
    absent = terminate_family(record)
    record["externalStop"] = {"supervisorAbsent": not alive(supervisor), "familyAbsent": absent}
    save(file, record)
    return 0 if absent and not alive(supervisor) else 1

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    launch = sub.add_parser("run")
    launch.add_argument("--record", required=True)
    launch.add_argument("--pid-file")
    launch.add_argument("--seconds", type=float, required=True)
    launch.add_argument("command", nargs=argparse.REMAINDER)
    halt = sub.add_parser("stop")
    halt.add_argument("--record", required=True)
    args = parser.parse_args()
    try:
        sys.exit(run(args) if args.action == "run" else stop(args))
    except Exception as error:
        print(f"Owned supervisor failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
