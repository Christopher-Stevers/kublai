//! FormanHQ's local RVT -> IFC preview pipeline. No Autodesk service or SDK.
//! The pinned Apache-2.0 rvt-rs reader supplies format decoding; this executable
//! owns resource limits, version policy, geometry filtering and our report.
#![forbid(unsafe_code)]

use rvt::ifc::{
    ExportQualityMode, IfcModel, RvtDocExporter,
    entities::{IfcEntity, PropertyValue},
    recount_exported, saved_meshes, write_step,
};
use rvt::walker::WalkerLimits;
use rvt::{RevitFile, compression::InflateLimits, reader::OpenLimits};
use serde::Serialize;
use std::{collections::BTreeMap, fs, path::Path};

const MAX_BYTES: u64 = 250 * 1024 * 1024;
const READER_REVISION: &str = "120e2f9ffa8422ba437102c8d300b7e902cdde80";

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    schema_version: u32,
    engine: &'static str,
    engine_version: &'static str,
    reader_revision: &'static str,
    revit_version: Option<u32>,
    outcome: &'static str,
    coordinates: &'static str,
    measurements_allowed: bool,
    decoded_elements: usize,
    displayed_elements: usize,
    omitted_box_elements: usize,
    saved_mesh_elements: usize,
    levels: usize,
    categories: BTreeMap<String, usize>,
    warnings: Vec<String>,
}

impl Report {
    fn new() -> Self {
        Self {
            schema_version: 1,
            engine: "foreman-native-revit",
            engine_version: env!("CARGO_PKG_VERSION"),
            reader_revision: READER_REVISION,
            outcome: "unsupported",
            coordinates: "revit-internal",
            measurements_allowed: false,
            warnings: vec![
                "Experimental preview. Geometry and completeness have not been verified for construction.".into(),
                "Uses Revit internal coordinates. Shared survey coordinates and linked files are not resolved.".into(),
            ],
            ..Default::default()
        }
    }
}

/// Keep entity indices stable: relationships still refer to the same elements,
/// but unresolved bounding boxes have no visible body and cut no host opening.
fn omit_unresolved_boxes(model: &mut IfcModel) -> usize {
    let mut omitted = 0;
    for (index, entity) in model.entities.iter_mut().enumerate() {
        let IfcEntity::BuildingElement {
            property_set,
            extrusion,
            solid_shape,
            representation_map_index,
            host_element_index,
            ..
        } = entity
        else {
            continue;
        };
        let properties = property_set.iter().flat_map(|s| &s.properties);
        let mut is_box = false;
        let mut resolved_profile = false;
        for property in properties {
            match (property.name.as_str(), &property.value) {
                ("BodySource", PropertyValue::Text(v)) if v == "partition_element_record_bbox" => {
                    is_box = true
                }
                ("ProfileResolved", PropertyValue::Boolean(true)) => resolved_profile = true,
                _ => {}
            }
        }
        if is_box && !resolved_profile {
            *extrusion = None;
            *solid_shape = None;
            *representation_map_index = None;
            *host_element_index = None;
            model.opening_cuts.remove(&index);
            omitted += 1;
        }
    }
    omitted
}

fn convert(
    input: &Path,
    output: &Path,
    report: &mut Report,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut file = RevitFile::open_with_limits(
        input,
        OpenLimits {
            max_file_bytes: MAX_BYTES,
            max_stream_bytes: 256 * 1024 * 1024,
            inflate_limits: InflateLimits {
                max_output_bytes: 256 * 1024 * 1024,
            },
        },
    )?;
    let version = file.basic_file_info()?.version;
    report.revit_version = Some(version);
    if !(2024..=2026).contains(&version) {
        report.warnings.push(format!("Revit {version} detected. Geometry decoding currently targets 2024–2026; this file is preserved for future support."));
        return Ok(());
    }
    // Project files can legitimately omit family-only PartAtom and previews.
    // Require the database streams actually used by geometry decoding instead.
    if file.stream_size("Formats/Latest").is_none()
        || file.stream_size("Global/ElemTable").is_none()
        || file.partition_stream_names().is_empty()
    {
        return Err("Missing Revit database streams".into());
    }
    let result = RvtDocExporter.export_with_diagnostics_mode_and_limits(
        &mut file,
        ExportQualityMode::Geometry,
        WalkerLimits::default(),
    )?;
    let mut model = result.model;
    let mut diagnostics = result.diagnostics;
    match saved_meshes::attach(&mut file, &mut model) {
        Ok(saved) => report.saved_mesh_elements = saved.replaced,
        Err(_) => report
            .warnings
            .push("Some saved display meshes could not be decoded.".into()),
    }
    report.omitted_box_elements = omit_unresolved_boxes(&mut model);
    recount_exported(&mut diagnostics, &model);
    report.decoded_elements = diagnostics.exported.building_elements;
    report.displayed_elements = diagnostics.exported.building_elements_with_geometry;
    report.levels = diagnostics.exported.storey_count;
    report.categories = diagnostics.exported.by_ifc_type;
    // Do not return original file paths, usernames or raw upstream diagnostics.
    // Counts concern recovered elements only, never total source completeness.
    if !diagnostics.warnings.is_empty() || !diagnostics.unsupported_features.is_empty() {
        report.warnings.push("Some source features or properties are not supported. Recovered element counts do not establish model completeness.".into());
    }
    if report.omitted_box_elements > 0 {
        report.warnings.push(format!(
            "{} elements had only bounding boxes; those bodies were omitted.",
            report.omitted_box_elements
        ));
    }
    if report.displayed_elements == 0 {
        report.warnings.push(
            "No supported model geometry was recovered. The original RVT remains available.".into(),
        );
        return Ok(());
    }
    // Metadata in the exported IFC must also identify its experimental status.
    model.description = Some("FormanHQ experimental native Revit preview. Unverified geometry; unresolved bounding-box bodies omitted. Internal coordinates; no linked models. Not for construction measurements.".into());
    let step = write_step(&model);
    if step.len() as u64 > MAX_BYTES {
        return Err("Converted model exceeds the output limit".into());
    }
    fs::write(output, step)?;
    report.outcome = "preview";
    Ok(())
}

fn main() -> std::process::ExitCode {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 4 {
        eprintln!("Usage: foreman-revit INPUT.rvt OUTPUT.ifc REPORT.json");
        return std::process::ExitCode::from(2);
    }
    let mut report = Report::new();
    let result = convert(Path::new(&args[1]), Path::new(&args[2]), &mut report);
    if result.is_err() {
        // No file content, internal paths or parser internals in user-facing errors.
        report.warnings.push("This file could not be decoded within the converter's limits. The original RVT remains available.".into());
    }
    let written = serde_json::to_vec(&report)
        .ok()
        .and_then(|data| fs::write(&args[3], data).ok())
        .is_some();
    if written {
        std::process::ExitCode::SUCCESS
    } else {
        std::process::ExitCode::from(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rvt::ifc::entities::{Property, PropertySet};

    fn element(source: &str, resolved: bool) -> IfcEntity {
        // Deserialize omitted optional fields with the library's real defaults.
        let mut value: IfcEntity = serde_json::from_value(serde_json::json!({
            "kind": "BuildingElement", "ifc_type": "IFCDOOR", "name": "Door",
            "type_guid": "123", "location_feet": [0, 0, 0],
            "host_element_index": 0, "representation_map_index": 0
        }))
        .unwrap();
        if let IfcEntity::BuildingElement { property_set, .. } = &mut value {
            *property_set = Some(PropertySet {
                name: "Source".into(),
                properties: vec![
                    Property {
                        name: "BodySource".into(),
                        value: PropertyValue::Text(source.into()),
                    },
                    Property {
                        name: "ProfileResolved".into(),
                        value: PropertyValue::Boolean(resolved),
                    },
                ],
            });
        }
        value
    }

    #[test]
    fn boxes_cannot_render_or_cut_hosts_but_recovered_meshes_and_profiles_survive() {
        let mut model = IfcModel {
            entities: vec![
                element("partition_element_record_bbox", false),
                element("saved_graphics_mesh", false),
                element("partition_element_record_bbox", true),
            ],
            ..Default::default()
        };
        assert_eq!(omit_unresolved_boxes(&mut model), 1);
        assert_eq!(model.entities.len(), 3); // relationships keep their indices
        for (i, entity) in model.entities.iter().enumerate() {
            if let IfcEntity::BuildingElement {
                representation_map_index,
                host_element_index,
                ..
            } = entity
            {
                assert_eq!(representation_map_index.is_some(), i != 0);
                assert_eq!(host_element_index.is_some(), i != 0);
            }
        }
    }
}
