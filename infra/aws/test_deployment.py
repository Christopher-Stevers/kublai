"""Exercise deployment routing without contacting AWS or starting containers."""
import json
import os
import runpy
import unittest
from unittest.mock import patch

IMAGE = '337658133209.dkr.ecr.us-east-2.amazonaws.com/foremanhq@sha256:' + 'a' * 64

class DeploymentRoutingTest(unittest.TestCase):
    def commands(self, branch):
        calls = []
        def aws(args, **kwargs):
            calls.append(args)
            if 'send-command' in args:
                return json.dumps({'Command': {'CommandId': 'test'}})
            return json.dumps({'Status': 'Success'})
        with patch.dict(os.environ, {'IMAGE': IMAGE, 'DEPLOY_BRANCH': branch}, clear=True), patch('subprocess.check_output', side_effect=aws), patch('time.sleep'), patch('builtins.print'):
            runpy.run_path('infra/aws/send-deploy.py')
        return json.loads(calls[0][calls[0].index('--parameters') + 1])['commands'][0]

    def test_development_cannot_reconfigure_shared_host(self):
        command = self.commands('development')
        self.assertIn('DEPLOY_ENVIRONMENT=development bash', command)
        self.assertNotRegex(command, r'bash [^;]+/configure-host.sh;')
        self.assertIn('/releases/development-', command)
        self.assertNotIn('/releases/production-', command)

    def test_production_promotes_shared_infrastructure(self):
        command = self.commands('production')
        self.assertIn('DEPLOY_ENVIRONMENT=production bash', command)
        self.assertRegex(command, r'bash [^;]+/configure-host.sh;')
        self.assertIn('/releases/production-', command)

    def test_other_branches_fail_before_aws(self):
        for branch in ['main', 'feature/example', '', 'production; echo unsafe']:
            with self.subTest(branch=branch), patch.dict(os.environ, {'IMAGE': IMAGE, 'DEPLOY_BRANCH': branch}, clear=True), patch('subprocess.check_output') as aws:
                with self.assertRaises(SystemExit):
                    runpy.run_path('infra/aws/send-deploy.py')
                aws.assert_not_called()

if __name__ == '__main__':
    unittest.main()
