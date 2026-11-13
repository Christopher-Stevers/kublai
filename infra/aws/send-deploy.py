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
branch = os.environ.get("DEPLOY_BRANCH")
if branch not in ("production", "development"):
    raise SystemExit("Deployment requires an explicit production or development branch")
environment = branch
# Immutable helper paths keep a development deployment from replacing production's runner.
release_dir = f"/opt/foremanhq/releases/{environment}-{image.split(':')[-1]}"
commands = ["set -eu", f"install -d -m 700 {release_dir}"]
for filename in ("deploy.sh", "start-container.sh", "run-service.sh", "environment.sh", "configure-host.sh"):
    encoded = base64.b64encode(Path(f"infra/aws/{filename}").read_bytes()).decode()
    commands.append(f"echo '{encoded}' | base64 -d > {release_dir}/{filename}")
# Shared proxy and resource policy are promoted only with production infrastructure.
if environment == "production":
    commands.append(f"bash {release_dir}/configure-host.sh")
commands.append(f"DEPLOY_ENVIRONMENT={environment} bash {release_dir}/deploy.sh '{image}'")
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
