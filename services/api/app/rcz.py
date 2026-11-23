"""Read the single-fragment RaceChrono GPS layout directly from memory."""

import io
import json
import struct
import zipfile
import zlib

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from .models import ChannelDefinition, TelemetrySample

router = APIRouter()
MAX_BYTES = 32 * 1024 * 1024
MAX_UNPACKED = 128 * 1024**2


class RczLap(BaseModel):
    number: int
    startTimestamp: int
    finishTimestamp: int | None = None
    isInvalid: bool | None = None


class RczSample(TelemetrySample):
    timestamp: int


class RczSession(BaseModel):
    start: int
    end: int
    laps: list[RczLap]
    samples: list[RczSample]
    channels: list[ChannelDefinition]


def decode(data: bytes) -> RczSession:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        names = set(archive.namelist())
        if (
            len(entries) > 256
            or len(entries) != len(names)
            or sum(i.file_size for i in entries) > MAX_UNPACKED
            or archive.getinfo("session.json").file_size > 1024**2
        ):
            raise ValueError("archive limits")
        metadata = json.loads(archive.read("session.json"))
        if metadata["version"] != 1 or any("/" in n for n in names):
            raise ValueError("layout")
        clocks = [n for n in names if n.startswith("channel_1_") and n.endswith("_1_1")]
        if len(clocks) != 1:
            raise ValueError("GPS clock")
        prefix = clocks[0][:-3]
        count = archive.getinfo(clocks[0]).file_size // 8
        if not 2 <= count <= 100_000:
            raise ValueError("sample limit")

        clock = archive.read(clocks[0])

        def channel(suffix: str, width: int) -> bytes | None:
            name = prefix + suffix
            if name not in names:
                return None
            if archive.getinfo(name).file_size != count * width:
                raise ValueError("channel length")
            return archive.read(name)

        coords = channel("3_1", 8)
        speed = channel("4_0", 4)
        altitude = channel("5_0", 4)

        def scalar(raw: bytes | None, index: int) -> int | None:
            if raw is None:
                return None
            value: int = struct.unpack_from("<i", raw, index * 4)[0]
            return None if value in (2147483647, -2147483648) else value

        first = int(struct.unpack_from("<q", clock)[0])
        last = int(struct.unpack_from("<q", clock, len(clock) - 8)[0])
        end = int(metadata.get("latestTimestamp", last))
        start = end - int(metadata.get("lengthTime", end - first))
        if start > first or end < last or not 0 < end - start <= 86_400_000:
            raise ValueError("session bounds")

        laps = [RczLap.model_validate(item) for item in metadata.get("laps", [])]
        if len({lap.number for lap in laps}) != len(laps):
            raise ValueError("duplicate lap number")
        for index, lap in enumerate(laps):
            if lap.finishTimestamp is not None and lap.finishTimestamp <= lap.startTimestamp:
                raise ValueError("lap bounds")
            if index and (
                laps[index - 1].finishTimestamp is None
                or (laps[index - 1].finishTimestamp or 0) > lap.startTimestamp
            ):
                raise ValueError("overlapping laps")

        heading = channel("6_0", 4)
        accuracy = channel("30007_0", 4)
        channel_units = {
            "latitude": "deg",
            "longitude": "deg",
            "speedKmh": "km/h",
            "altitudeM": "m",
            "headingDeg": "deg",
            "accuracyM": "m",
        }
        sources = [coords, coords, speed, altitude, heading, accuracy]
        channels = [
            ChannelDefinition(
                id=key,
                label=key,
                unit=unit,
                valueType="continuous",
                origin="source",
                suggestedView="line",
            )
            for (key, unit), source in zip(channel_units.items(), sources, strict=True)
            if source is not None
        ]
        samples: list[RczSample] = []
        lap_index = 0
        for i, (time,) in enumerate(struct.iter_unpack("<q", clock)):
            if samples and time <= samples[-1].timestamp:
                raise ValueError("clock order")
            lat, lon = struct.unpack_from("<ii", coords, i * 8) if coords else (None, None)
            valid = lat is not None and abs(lat) <= 540000000 and abs(lon) <= 1080000000
            v, h = scalar(speed, i), scalar(altitude, i)
            bearing, precision = scalar(heading, i), scalar(accuracy, i)
            while lap_index + 1 < len(laps) and time >= laps[lap_index + 1].startTimestamp:
                lap_index += 1
            active = laps[lap_index] if laps else None
            if active and (
                active.startTimestamp > time
                or (active.finishTimestamp is not None and time >= active.finishTimestamp)
            ):
                active = None
            samples.append(
                RczSample(
                    timestamp=time,
                    time=(time - start) / 1000,
                    distance=None,
                    lapTime=(time - active.startTimestamp) / 1000 if active else None,
                    lapNumber=active.number if active else None,
                    values={
                        "latitude": lat / 6000000 if valid else None,
                        "longitude": lon / 6000000 if valid else None,
                        "speedKmh": v * 0.0036 if v is not None and v >= 0 else None,
                        "altitudeM": h / 1000 if h is not None else None,
                        "headingDeg": bearing / 1000
                        if bearing is not None and 0 <= bearing <= 360000
                        else None,
                        "accuracyM": precision / 1000
                        if precision is not None and precision >= 0
                        else None,
                    },
                )
            )
        return RczSession(
            start=start,
            end=end,
            samples=samples,
            laps=laps,
            channels=channels,
        )


@router.post(
    "/api/telemetry/rcz",
    tags=["telemetry"],
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            },
        }
    },
)
async def import_rcz(request: Request, response: Response) -> RczSession:
    response.headers["Cache-Control"] = "no-store"
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "RCZ_SIZE")
        data.extend(chunk)
    try:
        return await run_in_threadpool(decode, bytes(data))
    except (
        zipfile.BadZipFile,
        ValueError,
        OverflowError,
        KeyError,
        TypeError,
        RuntimeError,
        EOFError,
        struct.error,
        zlib.error,
        AttributeError,
        RecursionError,
    ):
        raise HTTPException(422, "RCZ_LAYOUT") from None
