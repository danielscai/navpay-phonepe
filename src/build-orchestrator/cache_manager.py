#!/usr/bin/env python3
"""Compatibility shim for the renamed orchestrator entrypoint."""

import sys

import orchestrator as _orchestrator

sys.modules[__name__] = _orchestrator


if __name__ == "__main__":
    _orchestrator.main()
