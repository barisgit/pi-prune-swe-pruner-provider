from __future__ import annotations

import os

import uvicorn


def main() -> None:
    from .remote_server import app, get_model

    host = os.environ.get("SWE_PRUNER_HOST", "127.0.0.1")
    port = int(os.environ.get("SWE_PRUNER_PORT", "8765"))
    get_model()
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
