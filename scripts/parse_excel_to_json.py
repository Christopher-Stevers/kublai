import openpyxl
import json
import re
from pathlib import Path
from fractions import Fraction

# Path to the Excel file
file_path = Path(r"D:\Chris\Startups\kublai\src\server\api\routers\Material Catalogue-1.xlsx")
output_path = Path(r"D:\Chris\Startups\kublai\src\server\utils\material-catalogue.json")

def decimal_to_fraction_str(decimal):
    """Convert a decimal to a fraction string (e.g., 1.25 -> '1-1/4', 0.5 -> '1/2')"""
    if decimal == 0:
        return "0"
    
    # Convert to fraction with limited denominator
    frac = Fraction(decimal).limit_denominator(64)
    
    if frac.numerator == 0:
        return "0"
    
    whole = frac.numerator // frac.denominator
    remainder = frac.numerator % frac.denominator
    
    if whole == 0:
        # Pure fraction
        return f"{remainder}/{frac.denominator}"
    elif remainder == 0:
        # Whole number
        return f"{whole}"
    else:
        # Mixed number
        return f"{whole}-{remainder}/{frac.denominator}"

def parse_size_string(size_str):
    """Parse a size string like '1-1/4, 1-1/2, 2", 3", 4" x 3"' into decimal numbers
    
    For reducing sizes like '4" x 3"', we take the larger size.
    Returns a list of unique sizes.
    """
    if not size_str or size_str.strip() == "":
        return []
    
    sizes = []
    # Remove all inch symbols and extra whitespace
    cleaned = size_str.replace('"', '').replace("'", "")
    parts = [s.strip() for s in cleaned.split(",")]
    
    for part in parts:
        if not part:
            continue
        
        # Handle reducing sizes like "4 x 3" - take the first (larger) size
        if " x " in part or "x" in part:
            # Split by x and take the first part
            first_size = part.split("x")[0].strip()
            part = first_size
        
        # Handle mixed numbers like "1-1/4" or "1-1/2"
        if "-" in part and "/" in part:
            match = re.match(r'(\d+)-(\d+)/(\d+)', part)
            if match:
                whole = int(match.group(1))
                num = int(match.group(2))
                denom = int(match.group(3))
                sizes.append(whole + num / denom)
        # Handle fractions like "3/4" or "1/2"
        elif "/" in part:
            match = re.match(r'(\d+)/(\d+)', part)
            if match:
                num = int(match.group(1))
                denom = int(match.group(2))
                sizes.append(num / denom)
        # Handle whole numbers and decimals
        else:
            try:
                sizes.append(float(part))
            except ValueError:
                print(f"Warning: Could not parse size '{part}' from '{size_str}'")
    
    # Remove duplicates and sort
    return sorted(list(set(sizes)))

def extract_part_type(description):
    """Extract part type from description"""
    desc_lower = description.lower()
    
    type_keywords = {
        'elbow': ['elbow', '90°', '45°', '90 deg', '45 deg', '90deg', '45deg'],
        'tee': ['tee', 'sanitary tee', 'cleanout tee', 't-fitting'],
        'coupling': ['coupling', 'coupler'],
        'bushing': ['bushing', 'bush'],
        'wye': ['wye', 'y-fitting'],
        'cap': ['cap', 'end cap'],
        'flange': ['flange', 'closet flange'],
        'adapter': ['adapter', 'adaptor'],
        'union': ['union'],
        'plug': ['plug'],
        'nipple': ['nipple'],
        'trap_adapter': ['trap adapter', 'trap'],
        'pipe': ['pipe', 'tubing'],
        'valve': ['valve', 'ball valve', 'gate valve', 'check valve', 'stop valve'],
    }
    
    for part_type, keywords in type_keywords.items():
        for keyword in keywords:
            if keyword in desc_lower:
                return part_type
    
    return 'fitting'

def generate_synonyms(material, part_type, description):
    """Generate synonyms for a part - currently returns empty list"""
    # Synonyms are disabled for now - returning empty list
    return []

def map_category(excel_category):
    """Map Excel category to code category"""
    category_map = {
        'Fitting': 'Fittings',
        'Pipe': 'Pipe',
        'Valve': 'Valves',
    }
    return category_map.get(excel_category, 'Fittings')

def main():
    print("=" * 70)
    print("PARSING MATERIAL CATALOGUE TO JSON")
    print("=" * 70)
    
    # Load workbook
    print(f"\n[LOAD] Loading: {file_path}")
    wb = openpyxl.load_workbook(file_path)
    ws = wb['Sheet1']
    
    # Extract data
    parts = []
    row_count = 0
    
    print("\n[PROC] Processing rows...")
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not any(cell for cell in row):  # Skip empty rows
            continue
        
        material = str(row[0]).strip() if row[0] else ""
        size_str = str(row[1]).strip() if row[1] else ""
        description = str(row[2]).strip() if row[2] else ""
        category = str(row[3]).strip() if row[3] else "Fitting"
        
        if not material or not description:
            continue
        
        sizes = parse_size_string(size_str)
        part_type = extract_part_type(description)
        category_name = map_category(category)
        
        # Create a part for each size
        if not sizes:
            # No size - create one part
            synonyms = generate_synonyms(material, part_type, description)
            parts.append({
                "displayName": f"{description} ({material})",
                "description": f"{description} made of {material}",
                "material": material,
                "sizeNominal": 0,
                "sizeUnit": "in",
                "categoryName": category_name,
                "partType": part_type,
                "synonyms": synonyms
            })
        else:
            # Create separate part for each size with fraction display
            for size in sizes:
                size_display = decimal_to_fraction_str(size)
                synonyms = generate_synonyms(material, part_type, description)
                parts.append({
                    "displayName": f"{description} - {size_display}\" ({material})",
                    "description": f"{description} made of {material}, {size_display} inch",
                    "material": material,
                    "sizeNominal": size,
                    "sizeUnit": "in",
                    "categoryName": category_name,
                    "partType": part_type,
                    "synonyms": synonyms
                })
        
        row_count += 1
        if row_count % 20 == 0:
            print(f"   Processed {row_count} rows...")
    
    print(f"\n[DONE] Generated {len(parts)} part definitions from {row_count} rows")
    
    # Generate summary
    material_counts = {}
    category_counts = {}
    for part in parts:
        material_counts[part['material']] = material_counts.get(part['material'], 0) + 1
        category_counts[part['categoryName']] = category_counts.get(part['categoryName'], 0) + 1
    
    print("\n[SUMM] Summary by Material:")
    for mat, count in sorted(material_counts.items()):
        print(f"   {mat}: {count} parts")
    
    print("\n[SUMM] Summary by Category:")
    for cat, count in sorted(category_counts.items()):
        print(f"   {cat}: {count} parts")
    
    # Save to JSON
    print(f"\n[SAVE] Saving to: {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(parts, f, indent=2, ensure_ascii=False)
    
    print(f"[DONE] Successfully saved {len(parts)} parts to JSON")
    print("\nSample entries:")
    for i, part in enumerate(parts[:3], 1):
        print(f"\n{i}. {part['displayName']}")
        print(f"   Material: {part['material']}, Size: {part['sizeNominal']}, Type: {part['partType']}")
        print(f"   Synonyms: {', '.join(part['synonyms'][:5])}")

if __name__ == "__main__":
    main()
