import openpyxl
from collections import defaultdict

file_path = r"D:\Chris\Startups\kublai\src\server\api\routers\Material Catalogue-1.xlsx"

print("=" * 70)
print(f"DETAILED EXCEL FILE ANALYSIS: Material Catalogue-1.xlsx")
print("=" * 70)

# Load the workbook
wb = openpyxl.load_workbook(file_path)
ws = wb['Sheet1']

# Extract all data
data = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if any(cell for cell in row):  # Skip empty rows
        data.append(row)

print(f"\nTotal data rows: {len(data)}")

# Analyze each column
headers = ['Material', 'Size', 'Description', 'Category', 'Price']

print("\n" + "=" * 70)
print("COLUMN ANALYSIS")
print("=" * 70)

for col_idx, header in enumerate(headers):
    values = [str(row[col_idx]).strip() if row[col_idx] else '' for row in data]
    unique_values = sorted(set(v for v in values if v))
    
    print(f"\n{col_idx + 1}. {header}")
    print(f"   Unique values: {len(unique_values)}")
    
    if len(unique_values) <= 20:
        print(f"   All values:")
        for val in unique_values:
            count = values.count(val)
            print(f"      - {val[:60]} ({count} rows)")
    else:
        print(f"   Sample values (first 15):")
        for val in unique_values[:15]:
            count = values.count(val)
            print(f"      - {val[:60]} ({count} rows)")
        print(f"      ... and {len(unique_values) - 15} more unique values")

# Show material categories breakdown
print("\n" + "=" * 70)
print("MATERIAL TYPES BREAKDOWN")
print("=" * 70)

materials = defaultdict(list)
for row in data:
    material = str(row[0]).strip() if row[0] else 'Unknown'
    description = str(row[2]).strip() if row[2] else ''
    materials[material].append(description)

for material in sorted(materials.keys()):
    descriptions = materials[material]
    print(f"\n{material}: {len(descriptions)} items")
    unique_descs = sorted(set(descriptions))
    if len(unique_descs) <= 10:
        for desc in unique_descs:
            count = descriptions.count(desc)
            print(f"   - {desc} ({count}x)")
    else:
        print(f"   {len(unique_descs)} unique descriptions")
        for desc in unique_descs[:5]:
            count = descriptions.count(desc)
            print(f"   - {desc} ({count}x)")
        print(f"   ... and {len(unique_descs) - 5} more")

print("\n" + "=" * 70)
print("SUMMARY")
print("=" * 70)
print(f"This file contains a material catalogue with {len(data)} items.")
print(f"It includes {len(materials)} different material types.")
print(f"Columns: Material type, Size options, Description, Category, and Price")
print("\nMaterial types found:")
for material in sorted(materials.keys()):
    print(f"  - {material}: {len(materials[material])} items")
