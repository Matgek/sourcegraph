#!/usr/bin/env bash

cd $(dirname "${BASH_SOURCE[0]}")/../..

set -ex

./cmd/frontend/pre-build.sh
./cmd/management-console/pre-build.sh
