"""Prepare a small attributed IMS subset without downloading the entire 1 GB archive."""

import argparse
import hashlib
import io
import json
import re
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

URL = "https://data.nasa.gov/docs/legacy/IMS.zip"
OUT = Path(__file__).resolve().parents[2] / "data" / "artifacts"


class RemoteArchive(io.RawIOBase):
    """Read-only HTTP ranges; reject ignored ranges and bound total transferred data."""

    def __init__(self):
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(URL, method="HEAD"), timeout=20) as r:
                    self.size = int(r.headers["Content-Length"])
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(1)
        self.position = 0
        self.transferred = 0
        self.cache = (-1, b"")

    def seekable(self):
        return True

    def seek(self, offset, whence=0):
        self.position = (
            offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        )
        return self.position

    def tell(self):
        return self.position

    def read(self, count=-1):
        count = min(count if count >= 0 else self.size, self.size - self.position)
        if count <= 0:
            return b""
        start, cached = self.cache
        if start <= self.position and self.position + count <= start + len(cached):
            data = cached[self.position - start : self.position - start + count]
            self.position += count
            return data
        if count > 16_000_000 or self.transferred + count > 120_000_000:
            raise ValueError("Archive subset transfer bound exceeded")
        fetch_count = min(max(count, 65536), self.size - self.position)
        request = urllib.request.Request(
            URL, headers={"Range": f"bytes={self.position}-{self.position + fetch_count - 1}"}
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=20) as r:
                    if r.status != 206:
                        raise ValueError("Server ignored byte range; refusing full archive download")
                    data = r.read(fetch_count + 1)
                    if len(data) != fetch_count:
                        raise ValueError("Incomplete archive range")
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(1)
        self.cache = (self.position, data)
        self.position += count
        self.transferred += fetch_count
        return data[:count]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--unrar", default=r"C:\Program Files\WinRAR\UnRAR.exe")
    args = parser.parse_args()
    raw = OUT.parent / "raw" / "ims"
    raw.mkdir(parents=True, exist_ok=True)
    rar = raw / "2nd_test.rar"
    if args.inspect or not rar.exists():
        if not args.inspect and not args.download:
            raise SystemExit("Pass --download to acquire the 86 MB second experiment; UnRAR is required.")
        with zipfile.ZipFile(RemoteArchive()) as archive:
            if args.inspect:
                print(
                    json.dumps(
                        [{"name": i.filename, "bytes": i.file_size} for i in archive.infolist()], indent=2
                    )
                )
                return
            info = archive.getinfo("IMS/2nd_test.rar")
            part = rar.with_suffix(".part")
            with archive.open(info) as source, part.open("wb") as destination:
                while chunk := source.read(8_000_000):
                    destination.write(chunk)
                    print(f"IMS acquisition: {destination.tell()} / {info.file_size} bytes", flush=True)
            part.replace(rar)
    archive_hash = hashlib.sha256(rar.read_bytes()).hexdigest()
    if archive_hash != "b154d5ba1ae5f7f01cdd4f1bde5b08cfdc2f3134d51ad2f6614b1270a86ab632":
        raise ValueError("IMS second experiment checksum does not match the reviewed acquisition")
    listing = subprocess.run([args.unrar, "lb", str(rar)], check=True, capture_output=True, text=True).stdout
    names = sorted(
        n.strip()
        for n in listing.splitlines()
        if n.strip().replace("\\", "/").split("/")[-1].startswith("2004.")
    )
    if len(names) != 984:
        raise ValueError("Unexpected IMS second-experiment record count")
    if any(not re.fullmatch(r"(?:2nd_test[/\\])?2004(?:\.\d{2}){5}", name) for name in names):
        raise ValueError("Unexpected IMS record path; refusing archive extraction")
    selected = names[:30] + names[-12:]
    # Extract exact named records into the ignored raw directory; no user-supplied archive paths.
    subprocess.run([args.unrar, "x", "-y", "-idq", str(rar), *selected, str(raw) + "/"], check=True)
    rows = []
    for name in selected:
        path = raw / name.replace("\\", "/")
        if not path.is_file():
            path = next(raw.rglob(Path(name).name))
        matrix = np.loadtxt(path)
        if matrix.shape != (20480, 4) or not np.isfinite(matrix).all():
            raise ValueError("Invalid IMS snapshot shape or values")
        signal = matrix[:, 0] - np.mean(matrix[:, 0])
        rms = float(np.sqrt(np.mean(signal**2)))
        spectrum = np.abs(np.fft.rfft(signal)) ** 2
        frequencies = np.fft.rfftfreq(len(signal), 1 / 20000)
        values = {
            "acceleration_rms": rms,
            "kurtosis": float(np.mean(signal**4) / rms**4),
            "crest_factor": float(np.max(np.abs(signal)) / rms),
            "spectral_centroid": float(np.sum(frequencies * spectrum) / np.sum(spectrum)),
        }
        rows.append(
            {
                "record_id": "2nd_test/" + Path(name).name,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "values": values,
            }
        )
    baseline = {key: float(np.median([r["values"][key] for r in rows[:18]])) for key in rows[0]["values"]}

    def score(row):
        return max(
            abs(row["values"][key] - value) / max(abs(value), 0.001) for key, value in baseline.items()
        )

    threshold = max(score(r) for r in rows[18:24]) * 1.2
    healthy = [r for r in rows[24:30] if score(r) <= threshold]
    fault = [r for r in rows[30:] if score(r) > threshold]
    if min(len(healthy), len(fault)) < 3:
        raise ValueError("Insufficient persistent normal/abnormal replay records")
    artifact = {
        "baseline": baseline,
        "threshold": threshold,
        "healthy": healthy,
        "fault": fault,
        "units": {
            "acceleration_rms": "source units",
            "kurtosis": "dimensionless",
            "crest_factor": "dimensionless",
            "spectral_centroid": "Hz",
        },
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "bearing-replay.json").write_text(json.dumps(artifact, indent=2))
    report = {
        "source": URL,
        "origin": "NSF I/UCR Center for Intelligent Maintenance Systems, University of Cincinnati; Rexnord support",
        "source_license_metadata": "https://data.nasa.gov/dataset/ims-bearings",
        "experiment": "2nd_test",
        "channel": 1,
        "samples": 20480,
        "sampling_hz": 20000,
        "amplitude_units": "Not specified in bundled README; retained as source units, no g or mm/s conversion",
        "training_records": 18,
        "threshold_records": 6,
        "early_replay_candidates": 6,
        "late_replay_candidates": 12,
        "healthy_replay_records": len(healthy),
        "abnormal_replay_records": len(fault),
        "limitations": "Single experiment; temporally separated subsets, no independent experiment evaluation. Early/late selections are illustrative. The README reports outer-race failure at the experiment endpoint, not labels for every window. Post-repair healthy replay is not a recorded repair.",
        "archive_sha256": archive_hash,
        "threshold": threshold,
    }
    (OUT / "bearing-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
