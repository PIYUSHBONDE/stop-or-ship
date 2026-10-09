"""Validated plant topology and reviewed templates. No model can activate a configuration."""

from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from app.contracts.models import RequestModel

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$")]
EquipmentType = Literal["pump", "motor", "press", "conveyor", "cooling", "compressor", "electrical", "goods"]
DiagnosticProfile = Literal["pump", "bearing", "valve", "cooler"]
PROFILE_TYPES = {"pump": "pump", "bearing": "motor", "valve": "press", "cooler": "cooling"}


class ConfiguredArea(RequestModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=80)
    purpose: str = Field(min_length=1, max_length=300)
    # A production area has exactly one press. Utilities and dispatch have zero capacity.
    nominal_units_per_hour: int = Field(default=0, ge=0, le=10000)


class ConfiguredAsset(RequestModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=80)
    type: EquipmentType
    area_id: Identifier
    purpose: str = Field(min_length=1, max_length=500)
    position: list[float] = Field(min_length=3, max_length=3)
    diagnostic_profile: DiagnosticProfile | None = None

    @field_validator("position")
    @classmethod
    def bounded_position(cls, values):
        if any(abs(value) > 150 for value in values) or values[1] != 0:
            raise ValueError("Equipment must sit on the floor within 150 metres of the origin")
        return values

    @model_validator(mode="after")
    def compatible_profile(self):
        if self.diagnostic_profile and PROFILE_TYPES[self.diagnostic_profile] != self.type:
            raise ValueError("The diagnostic profile does not support this equipment type")
        return self


class ConfiguredDependency(RequestModel):
    source: Identifier
    target: Identifier
    relationship: str = Field(min_length=1, max_length=80)
    capacity_fraction: float = Field(default=1, gt=0, le=1)


class PlantConfiguration(RequestModel):
    name: str = Field(min_length=2, max_length=80)
    areas: list[ConfiguredArea] = Field(min_length=1, max_length=20)
    assets: list[ConfiguredAsset] = Field(min_length=1, max_length=100)
    dependencies: list[ConfiguredDependency] = Field(max_length=400)

    @model_validator(mode="after")
    def valid_graph(self):
        areas = {area.id: area for area in self.areas}
        assets = {asset.id: asset for asset in self.assets}
        if len(areas) != len(self.areas) or len(assets) != len(self.assets):
            raise ValueError("Area and equipment IDs must be unique")
        if any(asset.area_id not in areas for asset in self.assets):
            raise ValueError("Every asset must belong to a configured area")
        edges = {(edge.source, edge.target) for edge in self.dependencies}
        if len(edges) != len(self.dependencies):
            raise ValueError("Duplicate dependency edges are not allowed")
        adjacency = {key: [] for key in assets}
        degree = {key: 0 for key in assets}
        for source, target in edges:
            if source not in assets or target not in assets or source == target:
                raise ValueError("Dependencies must join two different configured assets")
            adjacency[source].append(target)
            degree[target] += 1
        queue = [key for key, value in degree.items() if value == 0]
        visited = 0
        while queue:
            source = queue.pop()
            visited += 1
            for target in adjacency[source]:
                degree[target] -= 1
                if degree[target] == 0:
                    queue.append(target)
        if visited != len(assets):
            raise ValueError("Circular dependencies are not supported")
        if not any(area.nominal_units_per_hour for area in self.areas):
            raise ValueError("Configure at least one production area")
        for area in self.areas:
            presses = [asset for asset in self.assets if asset.area_id == area.id and asset.type == "press"]
            if (area.nominal_units_per_hour > 0) != (len(presses) == 1) or len(presses) > 1:
                raise ValueError("Each production area needs one press and a positive rated output")
            if presses and not any(
                assets[key].type == "goods" for key in downstream(presses[0].id, self.model_dump())
            ):
                raise ValueError("Every production press needs a dependency path to dispatch")
        return self


class ConfigurationView(RequestModel):
    version: int = Field(ge=1)
    configuration: PlantConfiguration


class ConfigurationUpdate(RequestModel):
    expected_version: int = Field(ge=1)
    configuration: PlantConfiguration


class TemplateRequest(RequestModel):
    lines: int = Field(ge=2, le=8)
    name: str = Field(min_length=2, max_length=80)


def downstream(asset_id, catalog):
    result, queue = set(), [asset_id]
    while queue:
        source = queue.pop()
        for edge in catalog["dependencies"]:
            if edge["source"] == source and edge["target"] not in result:
                result.add(edge["target"])
                queue.append(edge["target"])
    return sorted(result)


def line_capacities(catalog):
    return {
        area["id"]: area["nominal_units_per_hour"]
        for area in catalog["areas"]
        if area.get("nominal_units_per_hour", 0)
    }


def affected_capacities(asset_id, catalog):
    affected = {asset_id, *downstream(asset_id, catalog)}
    capacities = line_capacities(catalog)
    return {
        asset["area_id"]: capacities[asset["area_id"]]
        for asset in catalog["assets"]
        if asset["type"] == "press" and asset["id"] in affected and asset["area_id"] in capacities
    }


def hydraulic_template(lines, name):
    """Keep the existing canonical IDs; additional bays use the same reviewed equipment types."""
    from app.plant.topology import AREAS, ASSETS, DEPENDENCIES

    areas = [
        area.model_dump() | {"nominal_units_per_hour": 100 if area.id.startswith("line-") else 0}
        for area in AREAS
    ]
    bindings = {"pump": "pump", "motor": "bearing", "press": "valve", "cooling": "cooler"}
    assets = [
        {key: value for key, value in asset.model_dump().items() if key != "status"}
        | {"diagnostic_profile": bindings.get(asset.type)}
        for asset in ASSETS
    ]
    dependencies = [edge.model_dump() for edge in DEPENDENCIES]
    for equipment in assets:
        if equipment["type"] == "electrical":
            equipment["purpose"] = f"Powers all {lines} configured production lines"
        elif equipment["type"] == "goods":
            equipment["purpose"] = f"Collects output from all {lines} configured production lines"
        elif equipment["type"] == "press":
            equipment["purpose"] = "Forms parts; rated output is configured on its production area"
    for index in range(2, lines):
        letter = chr(65 + index)
        area_id = "line-" + letter.lower()
        z = 4 + (index - 1) * 6
        areas.insert(
            index,
            {
                "id": area_id,
                "name": "Line " + letter,
                "purpose": "Hydraulic forming",
                "nominal_units_per_hour": 100,
            },
        )
        motor, pump, press, conveyor = (
            f"M-{index + 1}07",
            f"P-{index + 1}07",
            f"PR-{index + 1}01",
            f"CV-{index + 1}01",
        )
        for id, type, x in (
            (motor, "motor", -7.5),
            (pump, "pump", -5),
            (press, "press", -1.5),
            (conveyor, "conveyor", 3),
        ):
            assets.append(
                {
                    "id": id,
                    "name": f"{type.title()} {letter}",
                    "type": type,
                    "area_id": area_id,
                    "purpose": f"Supports hydraulic forming on Line {letter}",
                    "position": [x, 0, z],
                    "diagnostic_profile": bindings.get(type),
                }
            )
        dependencies.extend(
            {"source": source, "target": target, "relationship": relationship, "capacity_fraction": 1}
            for source, target, relationship in (
                (motor, pump, "drives"),
                (pump, press, "pressurizes"),
                (press, conveyor, "feeds"),
                (conveyor, "FG-001", "produces for"),
                ("CL-001", pump, "cools"),
                ("AC-001", press, "supplies air"),
                ("EL-001", motor, "powers"),
            )
        )
    for edge in dependencies:
        if edge["target"] == "FG-001":
            edge["capacity_fraction"] = 1 / lines
    if lines > 2:
        next(asset for asset in assets if asset["id"] == "FG-001")["position"][2] = (lines - 1) * 3
    return PlantConfiguration(name=name, areas=areas, assets=assets, dependencies=dependencies)
