from .models import Area, Asset, Dependency, Plant

PLANT = Plant(id="plant-01", name="Narmada Precision Works")
AREAS = [
    Area(id="line-a", name="Line A", purpose="Hydraulic forming"),
    Area(id="line-b", name="Line B", purpose="Parallel forming"),
    Area(id="utilities", name="Utilities", purpose="Shared services"),
    Area(id="dispatch", name="Dispatch", purpose="Finished production"),
]


def asset(id, name, type, area, purpose, x, z):
    return Asset(id=id, name=name, type=type, area_id=area, purpose=purpose, position=[x, 0, z])


ASSETS = [
    asset("P-107", "Hydraulic pump A", "pump", "line-a", "Supplies pressure and flow to Press A", -5, -1),
    asset("M-107", "Drive motor A", "motor", "line-a", "Drives pump P-107", -7.5, -1),
    asset("PR-101", "Hydraulic press A", "press", "line-a", "Forms 100 parts per hour", -1.5, -2),
    asset("CV-101", "Conveyor A", "conveyor", "line-a", "Transfers formed parts to dispatch", 3, -2),
    asset("P-207", "Hydraulic pump B", "pump", "line-b", "Supplies pressure and flow to Press B", -5, 4),
    asset("M-207", "Drive motor B", "motor", "line-b", "Drives pump P-207", -7.5, 4),
    asset("PR-201", "Hydraulic press B", "press", "line-b", "Forms 100 parts per hour", -1.5, 4),
    asset("CV-201", "Conveyor B", "conveyor", "line-b", "Transfers formed parts to dispatch", 3, 4),
    asset("CL-001", "Cooling unit", "cooling", "utilities", "Maintains hydraulic oil temperature", -6, -7),
    asset("AC-001", "Air compressor", "compressor", "utilities", "Supplies pneumatic tooling", -1, -7),
    asset("EL-001", "Electrical supply", "electrical", "utilities", "Powers both lines", 4, -7),
    asset("FG-001", "Finished goods", "goods", "dispatch", "Collects output from both lines", 7, 1),
]


def dep(source, target, relationship, fraction=1):
    return Dependency(source=source, target=target, relationship=relationship, capacity_fraction=fraction)


DEPENDENCIES = [
    dep("M-107", "P-107", "drives"),
    dep("P-107", "PR-101", "pressurizes"),
    dep("PR-101", "CV-101", "feeds"),
    dep("CV-101", "FG-001", "produces for", 0.5),
    dep("M-207", "P-207", "drives"),
    dep("P-207", "PR-201", "pressurizes"),
    dep("PR-201", "CV-201", "feeds"),
    dep("CV-201", "FG-001", "produces for", 0.5),
    dep("CL-001", "P-107", "cools"),
    dep("CL-001", "P-207", "cools"),
    dep("AC-001", "PR-101", "supplies air"),
    dep("AC-001", "PR-201", "supplies air"),
    dep("EL-001", "M-107", "powers"),
    dep("EL-001", "M-207", "powers"),
]


def downstream(asset_id):
    result, queue = [], [asset_id]
    while queue:
        source = queue.pop(0)
        for edge in DEPENDENCIES:
            if edge.source == source and edge.target not in result:
                result.append(edge.target)
                queue.append(edge.target)
    return result
