#!/bin/bash

if [[ -z "$VIRTUAL_ENV" ]]; then
    echo "❌ ERROR: Please activate your .venv before running the setup!"
    exit 1
fi

uv add --dev nbstripout

nbstripout --install --attributes .gitattributes

git config --local filter.nbstripout.extrakeys "metadata.kernelspec metadata.language_info"

echo "nbstripout has been installed and configured for this repository."