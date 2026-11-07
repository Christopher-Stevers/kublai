#![forbid(unsafe_code)]
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
// Use the host's hypot for stable source-line ties and identical normal rounding.
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Math, js_name = hypot)]
    fn hypot2(x: f64, y: f64) -> f64;
    #[wasm_bindgen(js_namespace = Math, js_name = hypot)]
    fn hypot3(x: f64, y: f64, z: f64) -> f64;
}

#[derive(Clone, Copy)]
struct Line {
    p: [f64; 4],
    length: f64,
}
fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}
fn collinear(a: Line, b: Line, aspect: f64) -> bool {
    let dx = a.p[2] - a.p[0];
    let dy = (a.p[3] - a.p[1]) * aspect;
    [0, 2].iter().all(|&i| {
        ((b.p[i] - a.p[0]) * dy - (b.p[i + 1] - a.p[1]) * aspect * dx).abs() / a.length <= 1e-6
    })
}
/// Same stable longest-first grouping, neighbouring buckets and tolerance as sheet-snap.
#[wasm_bindgen]
pub fn merge_lines(input: &[f64], aspect: f64) -> Result<Vec<f64>, JsError> {
    if input.len() % 4 != 0 || input.len() > 4_000_000 {
        return Err(JsError::new("Invalid line buffer"));
    }
    if !aspect.is_finite() || aspect <= 0.0 {
        return Ok(vec![]);
    }
    let mut lines: Vec<Line> = input
        .chunks_exact(4)
        .filter_map(|p| {
            let length = hypot2(p[2] - p[0], (p[3] - p[1]) * aspect);
            if !p.iter().all(|v| v.is_finite())
                || (p[2] - p[0]).abs().max((p[3] - p[1]).abs()) > 2.0
                || p[0].max(p[2]) < -0.05
                || p[0].min(p[2]) > 1.05
                || p[1].max(p[3]) < -0.05
                || p[1].min(p[3]) > 1.05
                || length <= 0.0
            {
                return None;
            }
            Some(Line {
                p: [p[0], p[1], p[2], p[3]],
                length,
            })
        })
        .collect();
    lines.sort_by(|a, b| b.length.total_cmp(&a.length));
    let mut buckets: HashMap<(i32, i64), usize> = HashMap::new();
    let mut ordered: Vec<Vec<Vec<Line>>> = vec![];
    for line in lines {
        let p = line.p;
        let mut theta = ((p[3] - p[1]) * aspect).atan2(p[2] - p[0]);
        if theta < 0.0 {
            theta += std::f64::consts::PI;
        }
        if theta >= std::f64::consts::PI {
            theta -= std::f64::consts::PI;
        }
        let angle = (round(theta * 180.0 / std::f64::consts::PI) as i32) % 180;
        let offset = round(
            (-(p[0] + p[2]) / 2.0 * theta.sin() + (p[1] + p[3]) / 2.0 * aspect * theta.cos()).abs()
                / 0.0015,
        ) as i64;
        let key = (angle, offset);
        let find = |key: &(i32, i64)| -> Option<(usize, usize)> {
            let &bucket = buckets.get(key)?;
            ordered[bucket]
                .iter()
                .position(|g| collinear(g[0], line, aspect))
                .map(|g| (bucket, g))
        };
        let mut target = find(&key);
        for da in -1..=1 {
            for d in -1..=1 {
                if target.is_none() && (da != 0 || d != 0) {
                    target = find(&((angle + da + 180) % 180, offset + d));
                }
            }
        }
        if let Some((b, g)) = target {
            ordered[b][g].push(line);
        } else if let Some(&b) = buckets.get(&key) {
            ordered[b].push(vec![line]);
        } else {
            buckets.insert(key, ordered.len());
            ordered.push(vec![vec![line]]);
        }
    }
    let mut merged: Vec<Line> = vec![];
    for bucket in ordered {
        for group in bucket {
            let source = group[0];
            let p = source.p;
            let ux = (p[2] - p[0]) / source.length;
            let uy = (p[3] - p[1]) * aspect / source.length;
            let mut min = 0.0_f64;
            let mut max = source.length;
            for line in group {
                for i in [0, 2] {
                    let t = (line.p[i] - p[0]) * ux + (line.p[i + 1] - p[1]) * aspect * uy;
                    min = min.min(t);
                    max = max.max(t);
                }
            }
            if max - min < 0.008 {
                continue;
            }
            let p = if min == 0.0 && max == source.length {
                p
            } else {
                [
                    p[0] + ux * min,
                    p[1] + uy * min / aspect,
                    p[0] + ux * max,
                    p[1] + uy * max / aspect,
                ]
            };
            merged.push(Line {
                p,
                length: hypot2(p[2] - p[0], (p[3] - p[1]) * aspect),
            });
        }
    }
    merged.sort_by(|a, b| b.length.total_cmp(&a.length));
    Ok(merged.into_iter().take(4000).flat_map(|l| l.p).collect())
}

#[wasm_bindgen]
pub struct Compact {
    positions: Vec<f32>,
    normals: Vec<i16>,
    indices: Vec<u32>,
}
#[wasm_bindgen]
impl Compact {
    pub fn positions(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.positions)
    }
    pub fn normals(&mut self) -> Vec<i16> {
        std::mem::take(&mut self.normals)
    }
    pub fn indices(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.indices)
    }
}
#[wasm_bindgen]
pub fn compact(vertices: &[f32], indices: &[u32]) -> Result<Compact, JsError> {
    if vertices.len() % 6 != 0
        || indices.len() % 3 != 0
        || vertices.len() > 60_000_000
        || indices.len() > 30_000_000
    {
        return Err(JsError::new("Invalid model geometry"));
    }
    let count = vertices.len() / 6;
    let capacity = (count * 2).max(1).next_power_of_two();
    let mut slots = vec![0_u32; capacity];
    let mut remap = vec![0_u32; count];
    let mut out = Compact {
        positions: Vec::with_capacity(count * 3),
        normals: Vec::with_capacity(count * 3),
        indices: Vec::with_capacity(indices.len()),
    };
    for &original in indices {
        let original = original as usize;
        if original >= count {
            return Err(JsError::new("Invalid triangle indices"));
        }
        let mut target = remap[original];
        if target == 0 {
            let v = &vertices[original * 6..original * 6 + 6];
            if !v.iter().all(|n| n.is_finite()) {
                return Err(JsError::new("Non-finite geometry"));
            }
            let (nx, ny, nz) = (v[3] as f64, v[4] as f64, v[5] as f64);
            let length = hypot3(nx, ny, nz);
            let scale = 32767.0 / if length == 0.0 { 1.0 } else { length };
            let normals = [
                round(nx * scale) as i16,
                round(ny * scale) as i16,
                round(nz * scale) as i16,
            ];
            let mut hash = 2166136261_u32;
            for n in [
                v[0].to_bits(),
                v[1].to_bits(),
                v[2].to_bits(),
                normals[0] as i32 as u32,
                normals[1] as i32 as u32,
                normals[2] as i32 as u32,
            ] {
                hash = (hash ^ n).wrapping_mul(16777619);
            }
            hash ^= hash >> 16;
            let mut slot = hash as usize & (capacity - 1);
            loop {
                target = slots[slot];
                if target == 0 {
                    break;
                }
                let start = (target as usize - 1) * 3;
                if (0..3).all(|i| {
                    out.positions[start + i].to_bits() == v[i].to_bits()
                        && out.normals[start + i] == normals[i]
                }) {
                    break;
                }
                slot = (slot + 1) & (capacity - 1);
            }
            if target == 0 {
                target = (out.positions.len() / 3 + 1) as u32;
                slots[slot] = target;
                out.positions.extend_from_slice(&v[..3]);
                out.normals.extend(normals);
            }
            remap[original] = target;
        }
        out.indices.push(target - 1);
    }
    Ok(out)
}
