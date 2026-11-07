"""Send versioned deployment script through SSM, then wait for its actual result."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import time

image = os.environ["IMAGE"]
if not re.fullmatch(r"337658133209\.dkr\.ecr\.us-east-2\.amazonaws\.com/foremanhq@sha256:[a-f0-9]{64}", image):
    raise SystemExit("Invalid immutable image reference")
commands = ["set -eu", "install -d -m 700 /opt/foremanhq"]
for filename in ("deploy.sh", "start-container.sh", "run-service.sh", "configure-host.sh"):
    encoded = base64.b64encode(Path(f"infra/aws/{filename}").read_bytes()).decode()
    commands.append(f"echo '{encoded}' | base64 -d > /opt/foremanhq/{filename}")
commands.append("bash /opt/foremanhq/configure-host.sh")
commands.append(f"bash /opt/foremanhq/deploy.sh '{image}'")
command = "; ".join(commands)
def aws(*args):
    return subprocess.check_output(["aws", "--region", "us-east-2", *args], text=True)
result = json.loads(aws("ssm", "send-command", "--instance-ids", "i-04896ee80d2ebcdf7", "--document-name", "AWS-RunShellScript", "--parameters", json.dumps({"commands": [command], "executionTimeout": ["720"]}), "--output", "json"))
command_id = result["Command"]["CommandId"]
print(f"SSM command: {command_id}", flush=True)
for attempt in range(150):
    time.sleep(5)
    try:
        result = json.loads(aws("ssm", "get-command-invocation", "--command-id", command_id, "--instance-id", "i-04896ee80d2ebcdf7", "--output", "json"))
    except subprocess.CalledProcessError:
        if attempt < 3:
            continue
        raise
    status = result["Status"]
    if status in ("Pending", "InProgress", "Delayed"):
        continue
    # The deploy script deliberately never emits its environment/secret contents.
    print(result.get("StandardOutputContent", ""))
    print(result.get("StandardErrorContent", ""))
    if status != "Success":
        raise SystemExit(f"Deployment failed: {status}")
    break
else:
    raise SystemExit("Deployment status timed out; inspect SSM before retrying")
