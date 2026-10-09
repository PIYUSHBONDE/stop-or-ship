"""Download attributed UCI data, validate cycles, fit healthy detector, and export replay + evaluation."""

import argparse
import hashlib
import json
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.metrics import confusion_matrix, precision_score, recall_score
from sklearn.preprocessing import RobustScaler

ROOT = Path(__file__).resolve().parents[2]
URL = "https://archive.ics.uci.edu/static/public/447/condition+monitoring+of+hydraulic+systems.zip"
SENSORS = {
    "pressure": ("PS1.txt", 6000, "bar"),
    "flow": ("FS1.txt", 600, "L/min"),
    "temperature": ("TS1.txt", 60, "°C"),
    "power": ("EPS1.txt", 6000, "W"),
    "vibration": ("VS1.txt", 60, "mm/s"),
    "cooling_efficiency": ("CE.txt", 60, "%"),
    "cooling_power": ("CP.txt", 60, "kW"),
    "pressure_secondary": ("PS2.txt", 6000, "bar"),
    "flow_secondary": ("FS2.txt", 600, "L/min"),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    raw = ROOT / "data" / "raw"
    out = ROOT / "data" / "artifacts"
    raw.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    archive = args.archive or raw / "uci-hydraulics.zip"
    if not archive.exists():
        print("Downloading UCI archive (approximately 73 MB)", flush=True)
        urllib.request.urlretrieve(URL, archive)
    with zipfile.ZipFile(archive) as z:

        def read(name):
            matches = [n for n in z.namelist() if n.split("/")[-1] == name]
            if len(matches) != 1:
                raise ValueError("Expected one " + name)
            with z.open(matches[0]) as f:
                return np.loadtxt(f)

        profile = read("profile.txt")
        assert profile.shape == (2205, 5), profile.shape
        assert np.isfinite(profile).all()
        expected_labels = [{3, 20, 100}, {73, 80, 90, 100}, {0, 1, 2}, {90, 100, 115, 130}, {0, 1}]
        for column, allowed in enumerate(expected_labels):
            if set(profile[:, column]) != allowed:
                raise ValueError("Unexpected hydraulic label coverage")
        features, feature_keys, means = [], [], []
        for key, (file, columns, _) in SENSORS.items():
            print("Validating " + file, flush=True)
            matrix = read(file)
            assert matrix.shape == (2205, columns), (file, matrix.shape)
            assert np.isfinite(matrix).all()
            means.append(matrix.mean(axis=1))
            features.extend([matrix.mean(axis=1), matrix.std(axis=1), np.quantile(matrix, 0.95, axis=1)])
            feature_keys.extend([key, key + "_std", key + "_p95"])
        x = np.column_stack(features)
        signal_means = np.column_stack(means)
    stable = profile[:, 4] == 0
    healthy = (
        (profile[:, 0] == 100)
        & (profile[:, 1] == 100)
        & (profile[:, 2] == 0)
        & (profile[:, 3] == 130)
        & stable
    )
    # Preserve time order within each condition regime. A global split has no healthy training cycles.
    # Purge neighboring cycles after assignment rather than silently randomizing measurements.
    n = len(x)
    train, validation, test = [], [], []
    for regime in np.unique(profile[:, :4], axis=0):
        ids = np.where(np.all(profile[:, :4] == regime, axis=1) & stable)[0]
        train.extend(ids[: int(0.6 * len(ids))])
        validation.extend(ids[int(0.6 * len(ids)) : int(0.8 * len(ids))])
        test.extend(ids[int(0.8 * len(ids)) :])
    train, validation, test = map(lambda ids: np.array(sorted(ids), dtype=int), (train, validation, test))
    # A validation/test cycle within one cycle of a higher-priority partition is excluded.
    validation = validation[~np.isin(validation, np.concatenate([train - 1, train, train + 1]))]
    earlier = np.concatenate([train, validation])
    test = test[~np.isin(test, np.concatenate([earlier - 1, earlier, earlier + 1]))]
    # Exact feature duplicates are assigned to their first occurrence's partition only.
    _, unique_ids = np.unique(x, axis=0, return_index=True)
    train = np.intersect1d(train, unique_ids)
    validation = np.intersect1d(validation, unique_ids)
    test = np.intersect1d(test, unique_ids)
    fit_ids = train[healthy[train]]
    if len(fit_ids) < 3:
        raise ValueError("Insufficient healthy training cycles after purging")
    scaler = RobustScaler().fit(x[fit_ids])
    model = IsolationForest(n_estimators=150, random_state=42, contamination="auto").fit(
        scaler.transform(x[fit_ids])
    )
    normal_validation = validation[healthy[validation]]
    # Keep threshold selection separate from fitting, even though this dataset has very little healthy coverage.
    if not len(normal_validation):
        raise ValueError("No independent healthy validation cycle remains for threshold selection")
    calibration = normal_validation
    scores = -model.score_samples(scaler.transform(x))
    threshold = float(np.quantile(scores[calibration], 0.95))
    predicted = scores > threshold
    good = np.where(healthy & ~predicted)[0]
    pump_fault = (
        (profile[:, 2] > 0)
        & (profile[:, 0] == 100)
        & (profile[:, 1] == 100)
        & (profile[:, 3] == 130)
        & stable
    )
    bad = np.where(pump_fault & predicted)[0]
    if len(good) < 3 or len(bad) < 3:
        raise ValueError("Insufficient isolated stable pump cases for a measured replay")

    def rows(ids):
        return [
            {
                "cycle_id": int(i + 1),
                "values": dict(zip(SENSORS, map(float, signal_means[i]))),
                "features": dict(zip(feature_keys, map(float, x[i]))),
                "score": float(scores[i]),
                "anomaly": bool(predicted[i]),
            }
            for i in ids[:12]
        ]

    replay = {
        "source": URL,
        "license": "CC BY 4.0",
        "transformation": "Cycle means, standard deviations and p95; simulated scenario order; labels select replay examples only",
        "baseline": dict(zip(SENSORS, map(float, np.median(signal_means[fit_ids], axis=0)))),
        "threshold": threshold,
        "healthy": rows(good),
        "fault": rows(bad),
    }
    replay["profiles"] = {}
    for family, column in [("cooler", 0), ("valve", 1)]:
        normal_labels = np.array([100, 100, 0, 130])
        other_normal = np.delete(profile[:, :4] == normal_labels, column, axis=1).all(axis=1)
        ids = np.where(stable & other_normal & (profile[:, column] != normal_labels[column]) & predicted)[0]
        if len(ids) < 3:
            raise ValueError("Insufficient detected isolated measured cases for " + family)
        replay["profiles"][family] = {k: v for k, v in replay.items() if k != "profiles"}
        replay["profiles"][family]["fault"] = rows(ids)
    (out / "replay.json").write_text(json.dumps(replay, indent=2), encoding="utf-8")
    eval_ids = test[stable[test]]
    truth = ~healthy[eval_ids]
    report = {
        "dataset": "UCI Condition monitoring of hydraulic systems",
        "doi": "10.24432/C5CW21",
        "license": "CC BY 4.0",
        "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "cycles": n,
        "stable_cycles": int(stable.sum()),
        "healthy_cycles": int(healthy.sum()),
        "stable_isolated_pump_fault_cycles": int(pump_fault.sum()),
        "feature_names": feature_keys,
        "label_coverage": [sorted(map(int, np.unique(profile[:, column]))) for column in range(5)],
        "healthy_fit_cycles": len(fit_ids),
        "split": "60/20/20 temporal blocks within condition regimes; adjacent cycle purge; exact duplicate feature vectors excluded",
        "train_cycle_ids": (train + 1).tolist(),
        "validation_cycle_ids": (validation + 1).tolist(),
        "test_cycle_ids": (test + 1).tolist(),
        "calibration": "independent healthy validation",
        "healthy_calibration_cycles": len(normal_validation),
        "calibration_cycle_ids": (calibration + 1).tolist(),
        "test_cycles": len(eval_ids),
        "test_healthy_cycles": int((~truth).sum()),
        "test_abnormal_cycles": int(truth.sum()),
        "precision": float(precision_score(truth, predicted[eval_ids], zero_division=0)),
        "recall": float(recall_score(truth, predicted[eval_ids], zero_division=0)),
        "confusion_matrix": confusion_matrix(truth, predicted[eval_ids], labels=[False, True]).tolist(),
        "threshold": threshold,
        "units": {k: v[2] for k, v in SENSORS.items()},
        "limitations": [
            "Test-rig data; not real factory validation",
            "Chronological split may omit fault families or healthy conditions",
            "Cycle anomaly evaluation is distinct from three-window incident persistence",
            "Only ten fully healthy stable cycles exist; healthy baseline training is very small",
            "Pump labels select replay examples, not agent ground truth inputs",
            "No time-to-failure or financial-risk calibration",
        ],
    }
    (out / "detection-evaluation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    import pickle

    with (out / "detector.pkl").open("wb") as f:
        pickle.dump(
            {
                "scaler": scaler,
                "model": model,
                "threshold": threshold,
                "features": feature_keys,
                "baseline_features": dict(zip(feature_keys, map(float, np.median(x[fit_ids], axis=0)))),
            },
            f,
        )
    print(json.dumps({k: v for k, v in report.items() if not k.endswith("cycle_ids")}, indent=2), flush=True)


if __name__ == "__main__":
    main()
