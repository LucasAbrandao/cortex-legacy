import io
import json
import struct
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import rcz


def archive(with_coordinates: bool = True) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w") as files:
        files.writestr(
            "session.json",
            json.dumps(
                {
                    "version": 1,
                    "laps": [{"number": 1, "startTimestamp": 1000}],
                }
            ),
        )
        files.writestr("channel_1_100_0_1_1", struct.pack("<4q", 1000, 2000, 8000, 9000))
        files.writestr("channel_1_100_0_4_0", struct.pack("<4i", 0, 10000, 2147483647, 5000))
        if with_coordinates:
            files.writestr("channel_1_100_0_3_1", struct.pack("<8i", *([6000000, 12000000] * 4)))
    return target.getvalue()


def test_decode_preserves_missing_gps_gaps_zero_and_partial_lap() -> None:
    session = rcz.decode(archive(False))
    assert [s.timestamp for s in session.samples] == [1000, 2000, 8000, 9000]
    assert [s.values["speedKmh"] for s in session.samples] == [0, 36, None, 18]
    assert all(
        s.values["latitude"] is None and s.values["longitude"] is None for s in session.samples
    )
    assert session.laps[0].finishTimestamp is None
    assert session.end - session.start == 8000
    sample = rcz.decode(archive()).samples[0]
    assert (sample.values["latitude"], sample.values["longitude"]) == (1, 2)


def test_rcz_upload_limits_and_safe_errors() -> None:
    app = FastAPI()
    app.include_router(rcz.router)
    with TestClient(app) as client:
        path = "/api/telemetry/rcz"
        assert client.post(path, content=b"invalid private contents").json() == {
            "detail": "RCZ_LAYOUT"
        }
        assert client.post(path, content=b"0" * (rcz.MAX_BYTES + 1)).status_code == 413
        response = client.post(path, content=archive())
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"


def test_unpacked_limit_checked_before_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rcz, "MAX_UNPACKED", 100)
    with pytest.raises(ValueError, match="archive limits"):
        rcz.decode(archive())
