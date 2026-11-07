#!/usr/bin/env bash
# Validated environment mapping; production keeps its existing paths and roles.
DEPLOY_ENVIRONMENT=${DEPLOY_ENVIRONMENT:-production}
case "$DEPLOY_ENVIRONMENT" in
  production) APP_NAME=foremanhq; CONFIG_DIR=/etc/foremanhq; STATE_DIR=/var/lib/foremanhq; PARAMETER_PREFIX=/foremanhq ;;
  development) APP_NAME=foremanhq-dev; CONFIG_DIR=/etc/foremanhq/dev; STATE_DIR=/var/lib/foremanhq/dev; PARAMETER_PREFIX=/foremanhq/dev ;;
  *) echo 'Invalid deployment environment' >&2; exit 64 ;;
esac
export DEPLOY_ENVIRONMENT
