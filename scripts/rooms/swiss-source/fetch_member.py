"""Retrieve the pinned CC BY Swiss Dwellings geometry ZIP member, not pipeline code.

Only ordinary sequential HTTP Range requests are used. A member CRC verifies the
decompressed CSV; this deliberately never claims verification of the full ZIP MD5.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zlib

URL = "https://zenodo.org/api/records/7788422/files/swiss-dwellings-v3.0.0.zip/content"
ARCHIVE_SIZE = 931868205
ARCHIVE_MD5 = "3b7915ecd5bf8e492a3e78c598b74123"
MEMBER = "swiss-dwellings-v3.0.0/geometries.csv"


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(1048576), b""):
            h.update(b)
    return h.hexdigest()


def save(path, value):
    with path.open("x") as f:
        json.dump(value, f, indent=2)
    path.chmod(0o600)


def range_bytes(start, end):
    expected = f"bytes {start}-{end}/{ARCHIVE_SIZE}"
    for attempt in range(3):
        try:
            with urlopen(Request(URL, headers={"Range": f"bytes={start}-{end}",
                                               "User-Agent": "ForemanHQ-open-dataset-import/1"}), timeout=55) as r:
                if r.status != 206 or r.headers.get("Content-Range") != expected:
                    raise ValueError("Server did not return the exact pinned byte range")
                body = r.read(end - start + 2)
                if len(body) != end - start + 1:
                    raise ValueError("Truncated or excessive range response")
                return body
        except HTTPError as e:
            if e.code != 429 or attempt == 2:
                raise
            delay = int(e.headers.get("Retry-After", "60"))
            if not 0 < delay <= 300:
                raise
            print(json.dumps({"rate_limited": True, "retry_after_seconds": delay}), flush=True)
            time.sleep(delay)
    raise RuntimeError("No range response")


def central_directory(tail):
    at = tail.rfind(b"PK\x05\x06")
    if at < 0:
        raise ValueError("Missing ZIP end-of-central-directory")
    end = struct.unpack_from("<4s4H2IH", tail, at)
    if end[1:3] != (0, 0) or end[3] != end[4] or end[7] != 0:
        raise ValueError("Unexpected multidisk/comment ZIP layout")
    base = ARCHIVE_SIZE - len(tail)
    pos = end[6] - base
    members = []
    for _ in range(end[4]):
        t = struct.unpack_from("<4s6H3I5H2I", tail, pos)
        if t[0] != b"PK\x01\x02":
            raise ValueError("Invalid central ZIP header")
        name = tail[pos + 46:pos + 46 + t[10]].decode("utf-8")
        members.append({"name": name, "flags": t[3], "method": t[4], "crc32": t[7],
                        "compressed_size": t[8], "uncompressed_size": t[9], "local_offset": t[16]})
        pos += 46 + t[10] + t[11] + t[12]
    if pos - (end[6] - base) != end[5]:
        raise ValueError("Unexpected central-directory size")
    return members


def fetch(output, prefix=None, chunk=16 * 1048576):
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    tail = range_bytes(ARCHIVE_SIZE - 65536, ARCHIVE_SIZE - 1)
    tail_path = output / "verified-central-directory.bin"
    tail_path.write_bytes(tail); tail_path.chmod(0o600)
    members = central_directory(tail)
    info = next(m for m in members if m["name"] == MEMBER)
    if info["flags"] & 1 or info["method"] != 8:
        raise ValueError("Geometry member is not unencrypted deflate")
    header = range_bytes(info["local_offset"], info["local_offset"] + 511)
    h = struct.unpack_from("<4s5H3I2H", header)
    name = header[30:30 + h[9]].decode("utf-8")
    if h[0] != b"PK\x03\x04" or name != MEMBER or h[3] != 8:
        raise ValueError("Local ZIP header does not match pinned geometry member")
    start = info["local_offset"] + 30 + h[9] + h[10]
    end = start + info["compressed_size"]
    compressed = output / "geometries.deflate"
    progress = []
    with compressed.open("xb") as f:
        offset = start
        if prefix:
            with prefix.open("rb") as p:
                if p.read(len(header) + info["local_offset"])[info["local_offset"]:] != header:
                    raise ValueError("Incomplete archive prefix does not match independent HTTP header")
                # Read only a fixed snapshot of the immutable prefix; CRC below
                # validates this alongside the subsequently fetched byte ranges.
                stop = min(prefix.stat().st_size, end)
                p.seek(start)
                while offset < stop:
                    b = p.read(min(1048576, stop - offset))
                    if not b:
                        raise ValueError("Prefix changed during snapshot")
                    f.write(b); offset += len(b)
            progress.append({"reused_prefix_path": str(prefix.resolve()), "bytes": offset - start,
                             "source": URL, "verified_by": "final member CRC32"})
        while offset < end:
            stop = min(end, offset + chunk)
            body = range_bytes(offset, stop - 1)
            f.write(body); f.flush()
            progress.append({"start": offset, "end_inclusive": stop - 1,
                             "sha256": hashlib.sha256(body).hexdigest(), "status": 206})
            offset = stop
            print(json.dumps({"geometry_compressed_bytes": offset - start,
                              "total": info["compressed_size"]}), flush=True)
    compressed.chmod(0o600)
    csv_path = output / "geometries.csv"
    inflater = zlib.decompressobj(-15)
    crc, count = 0, 0
    with compressed.open("rb") as source, csv_path.open("xb") as target:
        for block in iter(lambda: source.read(1048576), b""):
            body = inflater.decompress(block)
            target.write(body); crc = zlib.crc32(body, crc); count += len(body)
        body = inflater.flush()
        target.write(body); crc = zlib.crc32(body, crc); count += len(body)
    csv_path.chmod(0o600)
    if not inflater.eof or inflater.unused_data or count != info["uncompressed_size"] or crc != info["crc32"]:
        raise ValueError("Extracted geometry member failed ZIP size/CRC verification")
    provenance = {"contract": "swiss-pinned-member-v1", "record_id": 7788422,
                  "record_url": "https://zenodo.org/records/7788422", "doi": "10.5281/zenodo.7788422",
                  "dataset_version": "3.0.0", "license": "CC BY 4.0",
                  "license_url": "https://creativecommons.org/licenses/by/4.0/",
                  "source_url": URL, "archive_size": ARCHIVE_SIZE, "published_archive_md5": ARCHIVE_MD5,
                  "full_archive_md5_verified": False,
                  "member": {**info, "crc32_hex": f"{crc:08x}", "crc32_verified": True,
                             "compressed_sha256": sha(compressed), "csv_sha256": sha(csv_path),
                             "data_start": start}, "ranges": progress,
                  "central_directory_sha256": sha(tail_path),
                  "all_member_names": [m["name"] for m in members],
                  "citation": "Standfest, Matthias, et al. Swiss Dwellings (v3.0.0). Zenodo. doi:10.5281/zenodo.7788422.",
                  "limitations": "Member-only range extraction. Full ZIP MD5 was not checked; source drawing images are absent from this archive."}
    record = output / "zenodo-record.json"
    if record.exists():
        provenance["official_record_metadata_sha256"] = sha(record)
    save(output / "member-provenance.json", provenance)
    print(json.dumps({"complete": str(csv_path), "csv_sha256": provenance["member"]["csv_sha256"],
                      "crc32_verified": True}), flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--reuse-archive-prefix", type=Path)
    p.add_argument("--chunk-mib", type=int, default=16)
    a = p.parse_args()
    if not 1 <= a.chunk_mib <= 32:
        p.error("Use bounded sequential 1-32 MiB chunks")
    os.umask(0o077)
    fetch(a.output, a.reuse_archive_prefix, a.chunk_mib * 1048576)
