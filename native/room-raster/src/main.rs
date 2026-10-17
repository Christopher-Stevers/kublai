#![forbid(unsafe_code)]

use std::io::{self, Read, Write};

const MAX_PIXELS: usize = 25_000_000;
const MAX_EDGE: usize = 8192;
const MAX_STEPS: usize = 16;
const MAX_RADIUS: usize = 256;

#[derive(Clone, Copy)]
struct Step {
    dilate: bool,
    radius: usize,
}

fn word(bytes: &[u8]) -> usize {
    u32::from_le_bytes(bytes.try_into().expect("four bytes")) as usize
}

// Matches the existing van Herk/Gil-Werman TypeScript filter, including its
// boundary padding. This pilot changes implementation, not room geometry.
fn axis(
    src: &[u8],
    out: &mut [u8],
    width: usize,
    height: usize,
    radius: usize,
    horizontal: bool,
    dilate: bool,
) {
    if radius == 0 {
        out.copy_from_slice(src);
        return;
    }
    let (lines, length) = if horizontal {
        (height, width)
    } else {
        (width, height)
    };
    let k = 2 * radius + 1;
    let pad = if dilate { 0 } else { 1 };
    let pick = |a: u8, b: u8| if dilate { a.max(b) } else { a.min(b) };
    let mut g = vec![0; length];
    let mut h = vec![0; length];
    for line in 0..lines {
        let at = |i: usize| {
            if horizontal {
                line * width + i
            } else {
                i * width + line
            }
        };
        for i in 0..length {
            let v = src[at(i)];
            g[i] = if i % k == 0 { v } else { pick(g[i - 1], v) };
        }
        for i in (0..length).rev() {
            let v = src[at(i)];
            h[i] = if i % k == k - 1 || i == length - 1 {
                v
            } else {
                pick(h[i + 1], v)
            };
        }
        for i in 0..length {
            let a = if i >= radius { h[i - radius] } else { pad };
            let b = if i + radius < length {
                g[i + radius]
            } else {
                pad
            };
            out[at(i)] = pick(a, b);
        }
    }
}

fn apply(mut data: Vec<u8>, width: usize, height: usize, steps: &[Step]) -> Vec<u8> {
    let mut scratch = vec![0; data.len()];
    for step in steps {
        axis(
            &data,
            &mut scratch,
            width,
            height,
            step.radius,
            true,
            step.dilate,
        );
        axis(
            &scratch,
            &mut data,
            width,
            height,
            step.radius,
            false,
            step.dilate,
        );
    }
    data
}

// Row-major, four-connected free-space labels; stable IDs match TypeScript.
fn components(data: &[u8], width: usize, height: usize) -> (Vec<u32>, Vec<(u32, bool)>) {
    let mut labels = vec![0_u32; data.len()];
    let mut sizes = vec![(0, false)];
    let mut stack = Vec::new();
    for start in 0..data.len() {
        if data[start] != 0 || labels[start] != 0 {
            continue;
        }
        let id = sizes.len() as u32;
        labels[start] = id;
        stack.push(start);
        let mut size = 0;
        let mut border = false;
        while let Some(p) = stack.pop() {
            size += 1;
            let x = p % width;
            let y = p / width;
            border |= x == 0 || y == 0 || x + 1 == width || y + 1 == height;
            let mut push = |q: usize| {
                if data[q] == 0 && labels[q] == 0 {
                    labels[q] = id;
                    stack.push(q);
                }
            };
            if x > 0 {
                push(p - 1);
            }
            if x + 1 < width {
                push(p + 1);
            }
            if y > 0 {
                push(p - width);
            }
            if y + 1 < height {
                push(p + width);
            }
        }
        sizes.push((size, border));
    }
    (labels, sizes)
}

fn run_components(
    input: &mut impl Read,
    output: &mut impl Write,
    header: &[u8; 16],
) -> Result<(), String> {
    let width = word(&header[4..8]);
    let height = word(&header[8..12]);
    let n = width.checked_mul(height).ok_or("dimensions overflow")?;
    if width == 0
        || height == 0
        || width > MAX_EDGE
        || height > MAX_EDGE
        || n > MAX_PIXELS
        || word(&header[12..16]) != 0
    {
        return Err("request exceeds bounds".into());
    }
    let mut data = vec![0; n];
    input.read_exact(&mut data).map_err(|_| "truncated mask")?;
    let mut extra = [0; 1];
    if input.read(&mut extra).map_err(|_| "input failure")? != 0 || data.iter().any(|v| *v > 1) {
        return Err("invalid mask".into());
    }
    let (labels, sizes) = components(&data, width, height);
    output
        .write_all(&header[..12])
        .map_err(|_| "output failure")?;
    output
        .write_all(&(sizes.len() as u32).to_le_bytes())
        .map_err(|_| "output failure")?;
    for label in labels {
        output
            .write_all(&label.to_le_bytes())
            .map_err(|_| "output failure")?;
    }
    for (size, border) in sizes {
        output
            .write_all(&size.to_le_bytes())
            .map_err(|_| "output failure")?;
        output
            .write_all(&(border as u32).to_le_bytes())
            .map_err(|_| "output failure")?;
    }
    output.flush().map_err(|_| "output failure")?;
    Ok(())
}

fn run(input: &mut impl Read, output: &mut impl Write) -> Result<(), String> {
    let mut header = [0_u8; 16];
    input
        .read_exact(&mut header)
        .map_err(|_| "truncated header")?;
    if &header[0..4] == b"FRC1" {
        return run_components(input, output, &header);
    }
    if &header[0..4] != b"FMR1" {
        return Err("unsupported protocol".into());
    }
    let width = word(&header[4..8]);
    let height = word(&header[8..12]);
    let count = word(&header[12..16]);
    let n = width.checked_mul(height).ok_or("dimensions overflow")?;
    if width == 0
        || height == 0
        || width > MAX_EDGE
        || height > MAX_EDGE
        || n > MAX_PIXELS
        || count == 0
        || count > MAX_STEPS
    {
        return Err("request exceeds bounds".into());
    }
    let mut steps = Vec::with_capacity(count);
    for _ in 0..count {
        let mut bytes = [0_u8; 8];
        input.read_exact(&mut bytes).map_err(|_| "truncated step")?;
        let kind = word(&bytes[0..4]);
        let radius = word(&bytes[4..8]);
        if kind > 1 || radius > MAX_RADIUS {
            return Err("invalid step".into());
        }
        steps.push(Step {
            dilate: kind == 1,
            radius,
        });
    }
    let mut data = vec![0; n];
    input.read_exact(&mut data).map_err(|_| "truncated mask")?;
    let mut extra = [0_u8; 1];
    if input.read(&mut extra).map_err(|_| "input failure")? != 0 {
        return Err("trailing input".into());
    }
    if data.iter().any(|v| *v > 1) {
        return Err("mask must be binary".into());
    }
    let result = apply(data, width, height, &steps);
    output
        .write_all(&header[..12])
        .map_err(|_| "output failure")?;
    output.write_all(&result).map_err(|_| "output failure")?;
    output.flush().map_err(|_| "output failure")?;
    Ok(())
}

fn main() {
    if let Err(error) = run(
        &mut io::stdin().lock(),
        &mut io::BufWriter::new(io::stdout().lock()),
    ) {
        eprintln!("room-raster: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(w: u32, h: u32, kind: u32, radius: u32, data: &[u8]) -> Vec<u8> {
        let mut bytes = b"FMR1".to_vec();
        for v in [w, h, 1, kind, radius] {
            bytes.extend(v.to_le_bytes());
        }
        bytes.extend(data);
        bytes
    }
    #[test]
    fn rejects_invalid_requests_before_computation() {
        for input in [
            request(0, 1, 0, 0, &[]),
            request(8193, 1, 0, 0, &[]),
            request(8192, 8192, 0, 0, &[]),
            request(1, 1, 2, 0, &[0]),
            request(1, 1, 0, 257, &[0]),
            request(1, 1, 0, 0, &[2]),
            request(1, 1, 0, 0, &[]),
            request(1, 1, 0, 0, &[0, 0]),
        ] {
            let mut output = Vec::new();
            assert!(run(&mut input.as_slice(), &mut output).is_err());
            assert!(output.is_empty());
        }
    }
    #[test]
    fn emits_exact_dimensions_and_zero_radius_identity() {
        let input = request(2, 2, 1, 0, &[1, 0, 0, 1]);
        let mut output = Vec::new();
        run(&mut input.as_slice(), &mut output).unwrap();
        assert_eq!(&output[..12], &input[..12]);
        assert_eq!(&output[12..], &[1, 0, 0, 1]);
    }
}
