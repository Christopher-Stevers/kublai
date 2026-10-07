#!/usr/bin/env python3
"""Prepare a private CODE config archive. Does not launch or change any service."""

import argparse
import io
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import tarfile
import tempfile
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

IMAGE = "collabora/code@sha256:4e983196eb9878f339cc506c38c21f1cc3473bca3d6de883c5de08f9c0cc3a6c"


def public_origin(value):
    url = urlsplit(value)
    host = url.hostname or ""
    if (url.scheme != "https" or url.username or url.password or url.query
            or url.fragment or url.path not in ("", "/")
            or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host)
            or "." not in host or ".." in host
            or host.endswith((".localhost", ".local"))
            or all(char.isdigit() or char == "." for char in host)):
        raise ValueError("Use a full HTTPS public DNS origin, without credentials, path, query or fragment.")
    port = url.port or 443
    if not 1 <= port <= 65535:
        raise ValueError("Invalid HTTPS port.")
    authority = host if port == 443 else f"{host}:{port}"
    return f"https://{authority}", host, port


def configure(xml, app_origin, editor_origin):
    if len(xml) > 2 * 1024 * 1024 or re.search(br"<!\s*(DOCTYPE|ENTITY)", xml, re.I):
        raise ValueError("Unsafe or oversized XML template.")
    root = ET.fromstring(xml)
    if root.tag != "config":
        raise ValueError("Expected the pinned image's coolwsd.xml template.")
    app, app_host, app_port = public_origin(app_origin)
    editor, _, _ = public_origin(editor_origin)

    def node(path):
        found = root.findall(path)
        if len(found) != 1:
            raise ValueError(f"Template does not contain exactly one {path}; check the pinned image.")
        return found[0]

    values = {
        "server_name": editor.removeprefix("https://"),
        "net/listen": "any", "net/proto": "IPv4",
        "net/service_root": "", "net/proxy_prefix": "false",
        "net/content_security_policy": f"frame-ancestors 'self' {app}",
        "ssl/enable": "false", "ssl/termination": "true",
        "ssl/ssl_verification": "true", "storage/ssl/as_scheme": "true",
        "security/capabilities": "true", "security/seccomp": "true",
        "security/enable_macros_execution": "false",
        "security/enable_metrics_unauthenticated": "false",
        "mount_jail_tree": "false", "num_prespawn_children": "1",
        "admin_console/enable": "false", "admin_console/enable_pam": "false",
        "admin_console/username": "", "admin_console/password": "",
        "logging/level": "warning", "logging/level_startup": "warning",
        "logging/anonymize/anonymize_user_data": "true",
        "logging/anonymize/high_strength": "true",
        "logging/anonymize/anonymization_salt": str(secrets.randbits(64)),
        "logging/docstats": "false", "logging/userstats": "false",
        "browser_logging": "false",
        "ai/enabled": "false", "ai/allow_user_settings": "false",
        "ai/api_url": "", "ai/api_key": "", "ai/image_api_url": "", "ai/image_api_key": "",
        "languagetool/enabled": "false", "languagetool/base_url": "",
        "languagetool/user_name": "", "languagetool/api_key": "",
        "languagetool/ssl_verification": "true",
        "deepl/enabled": "false", "deepl/api_url": "", "deepl/auth_key": "",
        "remote_config/remote_url": "",
        "storage/wopi/max_file_size": str(50 * 1024 * 1024),
        "storage/wopi/access_token/default_lifetime_mins": "120",
    }
    for path, value in values.items():
        node(path).text = value
    for path in ("net/post_allow", "net/lok_allow", "monitors"):
        node(path).clear()
    node("net/post_allow").set("allow", "false")
    node("storage/filesystem").set("allow", "false")
    node("storage/wopi").set("allow", "true")
    # Remove legacy hosts as well as default alias entries. No localhost/network
    # allowances: WOPI hosts are also trusted as external document data sources.
    for host in list(node("storage/wopi").findall("host")):
        node("storage/wopi").remove(host)
    aliases = node("storage/wopi/alias_groups")
    aliases.clear()
    aliases.set("mode", "groups")
    group = ET.SubElement(aliases, "group")
    ET.SubElement(group, "host", {"allow": "true"}).text = f"https://{re.escape(app_host)}:{app_port}"
    node("logging/file").set("enable", "false")
    node("logging_ui_cmd/file").set("enable", "false")
    node("trace").set("enable", "false")
    node("trace_event").set("enable", "false")
    ET.indent(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def atomic_private(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            os.chmod(temporary, 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def prepare(template, output, app_origin, editor_origin):
    xml = configure(template.read_bytes(), app_origin, editor_origin)
    if output.is_symlink():
        raise ValueError("The output directory must not be a symlink.")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = output.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("The output directory must be owned by this user and have mode 0700.")
    proof = output / "proof_key"
    if proof.exists() or proof.is_symlink():
        info = proof.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("The existing proof key must be a private regular file owned by this user.")
        subprocess.run(["openssl", "rsa", "-in", str(proof), "-check", "-noout"], check=True, stdout=subprocess.DEVNULL)
    else:
        with tempfile.NamedTemporaryFile(dir=output, delete=False) as key_file:
            temporary = Path(key_file.name)
        try:
            subprocess.run(["openssl", "genrsa", "-traditional", "-out", str(temporary), "4096"], check=True)
            os.chmod(temporary, 0o600)
            os.replace(temporary, proof)
        finally:
            temporary.unlink(missing_ok=True)
    atomic_private(output / "coolwsd.xml", xml)
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w") as tar:
        for name, data in (("coolwsd.xml", xml), ("proof_key", proof.read_bytes())):
            entry = tarfile.TarInfo(name)
            entry.uid = entry.gid = 1001
            entry.uname = entry.gname = "cool"
            entry.mode = 0o600
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
    atomic_private(output / "config.tar", archive.getvalue())
    atomic_private(output / "IMAGE", f"{IMAGE}\n".encode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--app-origin", required=True)
    parser.add_argument("--editor-origin", required=True)
    args = parser.parse_args()
    try:
        prepare(args.template, args.output, args.app_origin, args.editor_origin)
    except (ValueError, OSError, ET.ParseError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Configuration preparation failed: {error}\n")
    print(f"Prepared private configuration in {args.output}. No service was started or changed.")
